import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ExtraExpensePaidBy, HotelExpensePeriod, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../system/settings.service";
import { FinanceService } from "../finance/finance.service";
import { toNumber } from "../common/units";
import { businessWindow } from "../common/business-day";
import { CreateExpenseCategoryDto, CreateHotelExpenseDto, UpdateHotelExpenseDto } from "./expenses.dto";

const money2 = (n: number) => Math.round(n * 100) / 100;

function dayStamp(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`);
}

function localDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type LedgerSource = "MANUAL" | "PURCHASE" | "SUPPLIER_PAYMENT" | "PURCHASE_EXTRA" | "UNPAID_SUPPLIER";

export type PayStatus = "PAID" | "PARTIAL" | "UNPAID";

export type LedgerRow = {
  id: string;
  source: LedgerSource;
  spentOn: string;
  category: string | null;
  title: string;
  amount: number;
  /** Counts toward cash expense / net profit. Unpaid supplier bills do not. */
  inTotal: boolean;
  /** Set on supplier bills. Unpaid / partial stay out of the expense total. */
  payStatus: PayStatus | null;
  period: HotelExpensePeriod | "DAILY";
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  editable: boolean;
};

/** Inventory total + supplier-side extra (self-paid extra is not owed to the supplier). */
function supplierDue(p: {
  total: Prisma.Decimal;
  extraExpense?: Prisma.Decimal | null;
  extraExpensePaidBy?: ExtraExpensePaidBy | null;
}) {
  const extra = p.extraExpensePaidBy === ExtraExpensePaidBy.SUPPLIER ? toNumber(p.extraExpense ?? 0) : 0;
  return money2(toNumber(p.total) + extra);
}

function billBalance(p: {
  total: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  extraExpense?: Prisma.Decimal | null;
  extraExpensePaidBy?: ExtraExpensePaidBy | null;
}) {
  const due = supplierDue(p);
  const paid = toNumber(p.paidAmount);
  const balance = money2(Math.max(0, due - paid));
  const payStatus: PayStatus = balance <= 0.009 ? "PAID" : paid > 0.009 ? "PARTIAL" : "UNPAID";
  return { due, paid, balance, payStatus };
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly finance: FinanceService
  ) {}

  /** Inclusive business-day range → [from, to) using restaurant day-start. */
  private async businessRange(from: string, to: string) {
    const start = await this.settings.dayStart();
    const a = businessWindow(from, start.h, start.m);
    const b = businessWindow(to, start.h, start.m);
    return { start: a.from, end: b.to };
  }

  private row(e: {
    id: string;
    spentAt: Date;
    category: string | null;
    title: string;
    amount: Prisma.Decimal;
    period: HotelExpensePeriod;
    note: string | null;
    createdAt: Date;
    createdBy: { id: string; name: string } | null;
  }): LedgerRow {
    return {
      id: e.id,
      source: "MANUAL",
      spentOn: localDate(e.spentAt),
      category: e.category,
      title: e.title,
      amount: toNumber(e.amount),
      inTotal: true,
      payStatus: null,
      period: e.period,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
      createdBy: e.createdBy,
      editable: true,
    };
  }

  async listCategories() {
    const rows = await this.prisma.hotelExpenseCategory.findMany({ orderBy: { name: "asc" } });
    return rows.map((c) => ({ id: c.id, name: c.name }));
  }

  async createCategory(dto: CreateExpenseCategoryDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Category name required");
    try {
      const row = await this.prisma.hotelExpenseCategory.create({ data: { name } });
      return { id: row.id, name: row.name };
    } catch {
      throw new BadRequestException("This category already exists");
    }
  }

  async removeCategory(id: string) {
    try {
      await this.prisma.hotelExpenseCategory.delete({ where: { id } });
      return { ok: true };
    } catch {
      throw new NotFoundException("Category not found");
    }
  }

  private async rememberCategory(name: string | null) {
    if (!name) return;
    await this.prisma.hotelExpenseCategory.upsert({
      where: { name },
      create: { name },
      update: {},
    });
  }

  /** One-time style backfill: CASH / initial pays missing from SupplierPayment (note purchase:id). */
  private async syncPurchaseCashPayments() {
    const purchases = await this.prisma.purchase.findMany({
      where: { paidAmount: { gt: 0 }, voidedAt: null },
      select: {
        id: true,
        supplierId: true,
        paidAmount: true,
        purchasedAt: true,
        payKind: true,
        total: true,
        extraExpense: true,
        extraExpensePaidBy: true,
      },
    });
    if (!purchases.length) return;

    const existing = await this.prisma.supplierPayment.findMany({
      where: { note: { startsWith: "purchase:" } },
      select: { note: true },
    });
    const have = new Set(existing.map((p) => p.note));

    for (const p of purchases) {
      const key = `purchase:${p.id}`;
      if (have.has(key)) continue;
      // Only backfill the invoice-day cash for CASH bills (full due) or any bill whose
      // paidAmount has no other supplier payments yet for that exact purchase tag.
      const inv = toNumber(p.total);
      const extra =
        p.extraExpensePaidBy === ExtraExpensePaidBy.SUPPLIER ? toNumber(p.extraExpense ?? 0) : 0;
      const due = money2(inv + extra);
      const paid = toNumber(p.paidAmount);
      if (paid <= 0.009) continue;
      // Prefer initial cash: CASH => due; otherwise leave to SupplierPayment history
      // except when there are zero payments for this supplier (legacy cash-on-bill).
      const supplierPayCount = await this.prisma.supplierPayment.count({
        where: { supplierId: p.supplierId },
      });
      const amount =
        p.payKind === "CASH" ? due : supplierPayCount === 0 ? money2(Math.min(paid, due)) : 0;
      if (amount <= 0.009) continue;
      await this.prisma.supplierPayment.create({
        data: {
          supplierId: p.supplierId,
          amount,
          paidAt: p.purchasedAt,
          note: key,
          allocated: true,
        },
      });
      have.add(key);
    }
  }

  async periodTotals(from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException("Dates must be YYYY-MM-DD");
    }
    if (from > to) throw new BadRequestException("from must be on or before to");
    await this.syncPurchaseCashPayments();

    const { start, end } = await this.businessRange(from, to);

    const [manualAgg, paymentsAgg, selfExtra, paidOrders, purchases] = await Promise.all([
      this.prisma.hotelExpense.aggregate({
        where: { spentAt: { gte: start, lt: end } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.supplierPayment.aggregate({
        where: { paidAt: { gte: start, lt: end } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.purchase.findMany({
        where: {
          purchasedAt: { gte: start, lt: end },
          voidedAt: null,
          extraExpense: { gt: 0 },
          extraExpensePaidBy: ExtraExpensePaidBy.SELF,
        },
        select: { extraExpense: true },
      }),
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: start, lt: end },
          status: { not: "CANCELLED" },
          OR: [{ paymentStatus: "PAID" }, { creditCustomerId: { not: null } }],
        },
        select: { total: true, discountAmount: true },
      }),
      this.prisma.purchase.findMany({
        where: { purchasedAt: { gte: start, lt: end }, voidedAt: null },
        select: { total: true, paidAmount: true, extraExpense: true, extraExpensePaidBy: true },
      }),
    ]);

    const manualExpenses = money2(toNumber(manualAgg._sum.amount ?? 0));
    const supplierPaid = money2(toNumber(paymentsAgg._sum.amount ?? 0));
    const selfExtraTotal = money2(selfExtra.reduce((s, p) => s + toNumber(p.extraExpense), 0));
    const inventoryPurchased = money2(purchases.reduce((s, p) => s + toNumber(p.total), 0));
    const unpaidSupplierBills = money2(
      purchases.reduce((s, p) => s + billBalance(p).balance, 0)
    );
    const totalExpense = money2(manualExpenses + supplierPaid + selfExtraTotal);
    const sales = money2(
      paidOrders.reduce((s, o) => s + Math.max(0, toNumber(o.total) - toNumber(o.discountAmount)), 0)
    );
    const netProfit = money2(sales - totalExpense);

    return {
      from,
      to,
      sales,
      manualExpenses,
      supplierPaid,
      selfExtra: selfExtraTotal,
      inventoryPurchased,
      unpaidSupplierBills,
      inventoryPurchaseCount: purchases.length,
      supplierPaymentCount: paymentsAgg._count,
      manualCount: manualAgg._count,
      totalExpense,
      netProfit,
    };
  }

  async list(from: string, to: string, category?: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException("Dates must be YYYY-MM-DD");
    }
    if (from > to) throw new BadRequestException("from must be on or before to");
    await this.syncPurchaseCashPayments();

    const { start, end } = await this.businessRange(from, to);
    const cat = category?.trim();

    const [manual, payments, purchases] = await Promise.all([
      this.prisma.hotelExpense.findMany({
        where: {
          spentAt: { gte: start, lt: end },
          ...(cat ? { category: { equals: cat, mode: "insensitive" } } : {}),
        },
        orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }],
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.supplierPayment.findMany({
        where: { paidAt: { gte: start, lt: end } },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        include: { supplier: { select: { id: true, name: true } } },
      }),
      this.prisma.purchase.findMany({
        where: { purchasedAt: { gte: start, lt: end }, voidedAt: null },
        orderBy: [{ purchasedAt: "desc" }, { createdAt: "desc" }],
        include: {
          supplier: { select: { id: true, name: true } },
          lines: { select: { storeItem: { select: { name: true } }, quantity: true, amount: true } },
        },
      }),
    ]);

    const rows: LedgerRow[] = [];

    for (const e of manual) {
      rows.push(this.row(e));
    }

    for (const p of payments) {
      const isPurchasePay = p.note?.startsWith("purchase:") ?? false;
      const row: LedgerRow = {
        id: `pay:${p.id}`,
        source: "SUPPLIER_PAYMENT",
        spentOn: localDate(p.paidAt),
        category: "Supplier payment",
        title: isPurchasePay
          ? `Paid with purchase · ${p.supplier.name}`
          : `Supplier payment · ${p.supplier.name}`,
        amount: toNumber(p.amount),
        inTotal: true,
        payStatus: "PAID",
        period: "DAILY",
        note: p.note?.startsWith("purchase:") ? "Cash paid on inventory bill" : p.note,
        createdAt: p.createdAt.toISOString(),
        createdBy: null,
        editable: false,
      };
      if (!cat || (row.category ?? "").toLowerCase() === cat.toLowerCase()) rows.push(row);
    }

    for (const p of purchases) {
      const itemNames = p.lines
        .slice(0, 4)
        .map((l) => l.storeItem.name)
        .join(", ");
      const more = p.lines.length > 4 ? ` +${p.lines.length - 4}` : "";
      const { due, paid, balance, payStatus } = billBalance(p);
      // Paid cash is already a supplier-payment row (hotel expense).
      // Whatever is still owed stays a remaining unpaid supplier bill.
      if (balance > 0.009) {
        const unpaidRow: LedgerRow = {
          id: `due:${p.id}`,
          source: "UNPAID_SUPPLIER",
          spentOn: localDate(p.purchasedAt),
          category: "Unpaid supplier bill",
          title: `Unpaid · ${p.supplier.name}`,
          amount: balance,
          inTotal: false,
          payStatus,
          period: "DAILY",
          note:
            [
              payStatus === "PARTIAL" ? `Part paid ${paid} of ${due}` : `Bill ${due}`,
              itemNames + more,
              p.note,
            ]
              .filter(Boolean)
              .join(" · ") || null,
          createdAt: p.createdAt.toISOString(),
          createdBy: null,
          editable: false,
        };
        if (!cat || (unpaidRow.category ?? "").toLowerCase() === cat.toLowerCase()) {
          rows.push(unpaidRow);
        }
      }

      if (
        toNumber(p.extraExpense) > 0.009 &&
        p.extraExpensePaidBy === ExtraExpensePaidBy.SELF
      ) {
        const extraRow: LedgerRow = {
          id: `pex:${p.id}`,
          source: "PURCHASE_EXTRA",
          spentOn: localDate(p.purchasedAt),
          category: "Purchase extra",
          title: `Extra (self) · ${p.supplier.name}`,
          amount: toNumber(p.extraExpense),
          inTotal: true,
          payStatus: "PAID",
          period: "DAILY",
          note: p.extraExpenseNote,
          createdAt: p.createdAt.toISOString(),
          createdBy: null,
          editable: false,
        };
        if (!cat || (extraRow.category ?? "").toLowerCase() === cat.toLowerCase()) {
          rows.push(extraRow);
        }
      }
    }

    rows.sort((a, b) => {
      if (a.spentOn !== b.spentOn) return a.spentOn < b.spentOn ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });

    const totals = await this.periodTotals(from, to);
    const byCategory = new Map<string, number>();
    for (const r of rows) {
      if (!r.inTotal) continue;
      const key = r.category?.trim() || "—";
      byCategory.set(key, money2((byCategory.get(key) ?? 0) + r.amount));
    }

    let manualExpenses = totals.manualExpenses;
    let supplierPaid = totals.supplierPaid;
    let selfExtra = totals.selfExtra;
    let totalExpense = totals.totalExpense;
    if (cat) {
      manualExpenses = money2(rows.filter((r) => r.source === "MANUAL" && r.inTotal).reduce((s, r) => s + r.amount, 0));
      supplierPaid = money2(
        rows.filter((r) => r.source === "SUPPLIER_PAYMENT" && r.inTotal).reduce((s, r) => s + r.amount, 0)
      );
      selfExtra = money2(
        rows.filter((r) => r.source === "PURCHASE_EXTRA" && r.inTotal).reduce((s, r) => s + r.amount, 0)
      );
      totalExpense = money2(manualExpenses + supplierPaid + selfExtra);
    }

    const saved = await this.listCategories();
    const filterCats = [
      ...saved,
      { id: "sys-unpaid", name: "Unpaid supplier bill" },
      { id: "sys-supplier", name: "Supplier payment" },
      { id: "sys-extra", name: "Purchase extra" },
    ];
    // unique by name
    const catMap = new Map(filterCats.map((c) => [c.name.toLowerCase(), c]));

    return {
      from,
      to,
      rows,
      summary: {
        count: rows.length,
        total: totalExpense,
        manualExpenses,
        supplierPaid,
        selfExtra,
        inventoryPurchased: totals.inventoryPurchased,
        unpaidSupplierBills: totals.unpaidSupplierBills,
        sales: totals.sales,
        netProfit: money2(totals.sales - totalExpense),
        byCategory: [...byCategory.entries()]
          .map(([name, amount]) => ({ name, amount }))
          .sort((a, b) => b.amount - a.amount),
      },
      categories: [...catMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async create(dto: CreateHotelExpenseDto, userId: string) {
    const amount = money2(dto.amount);
    if (amount <= 0) throw new BadRequestException("Amount must be greater than zero");
    const title = dto.title.trim();
    if (!title) throw new BadRequestException("Title / name required");
    const category = dto.category?.trim() || null;
    const spentAt = dayStamp(dto.spentOn);
    await this.finance.assertNotLocked(spentAt);

    const created = await this.prisma.hotelExpense.create({
      data: {
        spentAt,
        category,
        title,
        amount,
        period: dto.period,
        note: dto.note?.trim() || null,
        createdById: userId,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    await this.rememberCategory(category);
    return this.row(created);
  }

  async update(id: string, dto: UpdateHotelExpenseDto) {
    const existing = await this.prisma.hotelExpense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Expense not found");
    await this.finance.assertNotLocked(existing.spentAt);

    if (dto.amount != null && dto.amount <= 0) {
      throw new BadRequestException("Amount must be greater than zero");
    }

    const nextCategory = dto.category !== undefined ? dto.category.trim() || null : undefined;
    const nextSpent = dto.spentOn ? dayStamp(dto.spentOn) : null;
    if (nextSpent) await this.finance.assertNotLocked(nextSpent);

    try {
      const updated = await this.prisma.hotelExpense.update({
        where: { id },
        data: {
          ...(nextSpent ? { spentAt: nextSpent } : {}),
          ...(nextCategory !== undefined ? { category: nextCategory } : {}),
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.amount != null ? { amount: money2(dto.amount) } : {}),
          ...(dto.period ? { period: dto.period } : {}),
          ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
        },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      if (nextCategory) await this.rememberCategory(nextCategory);
      return this.row(updated);
    } catch {
      throw new NotFoundException("Expense not found");
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.hotelExpense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Expense not found");
    await this.finance.assertNotLocked(existing.spentAt);
    try {
      await this.prisma.hotelExpense.delete({ where: { id } });
      return { ok: true };
    } catch {
      throw new NotFoundException("Expense not found");
    }
  }
}
