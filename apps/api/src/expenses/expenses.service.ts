import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ExtraExpensePaidBy, HotelExpensePeriod, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { toNumber } from "../common/units";
import { CreateExpenseCategoryDto, CreateHotelExpenseDto, UpdateHotelExpenseDto } from "./expenses.dto";

const money2 = (n: number) => Math.round(n * 100) / 100;

function dayStamp(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`);
}

function dayRange(from: string, to: string) {
  return {
    start: new Date(`${from}T00:00:00`),
    end: new Date(`${to}T23:59:59.999`),
  };
}

function localDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type LedgerSource = "MANUAL" | "PURCHASE" | "SUPPLIER_PAYMENT" | "PURCHASE_EXTRA";

export type LedgerRow = {
  id: string;
  source: LedgerSource;
  spentOn: string;
  category: string | null;
  title: string;
  amount: number;
  /** Counts toward cash expense / net profit. Purchase invoice rows are false. */
  inTotal: boolean;
  period: HotelExpensePeriod | "DAILY";
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  editable: boolean;
};

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

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
      where: { paidAmount: { gt: 0 } },
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

    const { start, end } = dayRange(from, to);

    const [manualAgg, paymentsAgg, selfExtra, salesAgg, purchases] = await Promise.all([
      this.prisma.hotelExpense.aggregate({
        where: { spentAt: { gte: start, lte: end } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.supplierPayment.aggregate({
        where: { paidAt: { gte: start, lte: end } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.purchase.findMany({
        where: {
          purchasedAt: { gte: start, lte: end },
          extraExpense: { gt: 0 },
          extraExpensePaidBy: ExtraExpensePaidBy.SELF,
        },
        select: { extraExpense: true },
      }),
      this.prisma.order.aggregate({
        where: {
          paymentStatus: "PAID",
          status: { not: "CANCELLED" },
          updatedAt: { gte: start, lte: end },
        },
        _sum: { total: true },
      }),
      this.prisma.purchase.aggregate({
        where: { purchasedAt: { gte: start, lte: end } },
        _sum: { total: true },
        _count: true,
      }),
    ]);

    const manualExpenses = money2(toNumber(manualAgg._sum.amount ?? 0));
    const supplierPaid = money2(toNumber(paymentsAgg._sum.amount ?? 0));
    const selfExtraTotal = money2(selfExtra.reduce((s, p) => s + toNumber(p.extraExpense), 0));
    const inventoryPurchased = money2(toNumber(purchases._sum.total ?? 0));
    const totalExpense = money2(manualExpenses + supplierPaid + selfExtraTotal);
    const sales = money2(toNumber(salesAgg._sum.total ?? 0));
    const netProfit = money2(sales - totalExpense);

    return {
      from,
      to,
      sales,
      manualExpenses,
      supplierPaid,
      selfExtra: selfExtraTotal,
      inventoryPurchased,
      inventoryPurchaseCount: purchases._count,
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

    const { start, end } = dayRange(from, to);
    const cat = category?.trim();

    const [manual, payments, purchases] = await Promise.all([
      this.prisma.hotelExpense.findMany({
        where: {
          spentAt: { gte: start, lte: end },
          ...(cat ? { category: { equals: cat, mode: "insensitive" } } : {}),
        },
        orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }],
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.supplierPayment.findMany({
        where: { paidAt: { gte: start, lte: end } },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        include: { supplier: { select: { id: true, name: true } } },
      }),
      this.prisma.purchase.findMany({
        where: { purchasedAt: { gte: start, lte: end } },
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
      const purchaseRow: LedgerRow = {
        id: `pur:${p.id}`,
        source: "PURCHASE",
        spentOn: localDate(p.purchasedAt),
        category: "Inventory purchase",
        title: `Stock in · ${p.supplier.name}`,
        amount: toNumber(p.total),
        inTotal: false,
        period: "DAILY",
        note: [itemNames + more, p.note].filter(Boolean).join(" · ") || null,
        createdAt: p.createdAt.toISOString(),
        createdBy: null,
        editable: false,
      };
      if (!cat || (purchaseRow.category ?? "").toLowerCase() === cat.toLowerCase()) {
        rows.push(purchaseRow);
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

    const saved = await this.listCategories();
    const filterCats = [
      ...saved,
      { id: "sys-inventory", name: "Inventory purchase" },
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
        total: totals.totalExpense,
        manualExpenses: totals.manualExpenses,
        supplierPaid: totals.supplierPaid,
        selfExtra: totals.selfExtra,
        inventoryPurchased: totals.inventoryPurchased,
        sales: totals.sales,
        netProfit: totals.netProfit,
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

    const created = await this.prisma.hotelExpense.create({
      data: {
        spentAt: dayStamp(dto.spentOn),
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

    if (dto.amount != null && dto.amount <= 0) {
      throw new BadRequestException("Amount must be greater than zero");
    }

    const nextCategory = dto.category !== undefined ? dto.category.trim() || null : undefined;

    try {
      const updated = await this.prisma.hotelExpense.update({
        where: { id },
        data: {
          ...(dto.spentOn ? { spentAt: dayStamp(dto.spentOn) } : {}),
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
    try {
      await this.prisma.hotelExpense.delete({ where: { id } });
      return { ok: true };
    } catch {
      throw new NotFoundException("Expense not found");
    }
  }
}
