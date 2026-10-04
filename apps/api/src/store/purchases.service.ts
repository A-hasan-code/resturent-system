import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { toNumber } from "../common/units";
import { CreatePurchaseDto, CreateSupplierDto, SupplierPaymentDto, UpdateSupplierDto } from "./dto";

const money2 = (n: number) => Math.round(n * 100) / 100;

/** Local calendar day, matching how purchase timestamps are stored (noon local). */
function dayStamp(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`);
}

function dayRange(isoDate: string) {
  return {
    start: new Date(`${isoDate}T00:00:00`),
    end: new Date(`${isoDate}T23:59:59.999`),
  };
}

function localDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type LedgerPurchase = { total: Prisma.Decimal; paidAmount: Prisma.Decimal };
type LedgerPayment = { amount: Prisma.Decimal };

export function supplierBalance(purchases: LedgerPurchase[], payments: LedgerPayment[]) {
  const purchased = money2(purchases.reduce((s, p) => s + toNumber(p.total), 0));
  const paidOnBills = money2(purchases.reduce((s, p) => s + toNumber(p.paidAmount), 0));
  const paidLater = money2(payments.reduce((s, p) => s + toNumber(p.amount), 0));
  const paid = money2(paidOnBills + paidLater);
  return { purchased, paid, outstanding: money2(purchased - paid) };
}

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  async listSuppliers() {
    const rows = await this.prisma.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        purchases: { select: { total: true, paidAmount: true } },
        payments: { select: { amount: true } },
      },
    });
    return rows.map((s) => {
      const bal = supplierBalance(s.purchases, s.payments);
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        notes: s.notes,
        ...bal,
      };
    });
  }

  async createSupplier(dto: CreateSupplierDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Supplier name required");
    const row = await this.prisma.supplier.create({
      data: { name, phone: dto.phone?.trim() || null, notes: dto.notes?.trim() || null },
    });
    return { id: row.id, name: row.name, phone: row.phone, notes: row.notes, purchased: 0, paid: 0, outstanding: 0 };
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    try {
      const row = await this.prisma.supplier.update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name.trim() } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
      return { id: row.id, name: row.name, phone: row.phone, active: row.active };
    } catch {
      throw new NotFoundException("Supplier not found");
    }
  }

  async ledger(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: {
          orderBy: { purchasedAt: "desc" },
          include: {
            lines: { orderBy: { categoryName: "asc" }, include: { storeItem: { select: { name: true } } } },
          },
        },
        payments: { orderBy: { paidAt: "desc" } },
      },
    });
    if (!supplier) throw new NotFoundException("Supplier not found");
    const bal = supplierBalance(supplier.purchases, supplier.payments);
    return {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      notes: supplier.notes,
      ...bal,
      purchases: supplier.purchases.map((p) => ({
        id: p.id,
        purchasedOn: localDate(p.purchasedAt),
        payKind: p.payKind,
        total: toNumber(p.total),
        paidAmount: toNumber(p.paidAmount),
        balance: money2(toNumber(p.total) - toNumber(p.paidAmount)),
        note: p.note,
        lines: p.lines.map((l) => ({
          id: l.id,
          item: l.storeItem.name,
          category: l.categoryName,
          unit: l.unit,
          quantity: toNumber(l.quantity),
          ratePerUnit: toNumber(l.ratePerUnit),
          amount: toNumber(l.amount),
        })),
      })),
      payments: supplier.payments.map((p) => ({
        id: p.id,
        paidOn: localDate(p.paidAt),
        amount: toNumber(p.amount),
        note: p.note,
      })),
    };
  }

  async createPurchase(dto: CreatePurchaseDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier || !supplier.active) throw new NotFoundException("Supplier not found");

    const merged = new Map<string, { quantity: number; ratePerUnit: number }>();
    for (const line of dto.lines) {
      const prev = merged.get(line.storeItemId);
      merged.set(line.storeItemId, {
        quantity: (prev?.quantity ?? 0) + line.quantity,
        ratePerUnit: line.ratePerUnit,
      });
    }

    const items = await this.prisma.storeItem.findMany({
      where: { id: { in: [...merged.keys()] }, active: true },
      include: { category: true },
    });
    if (items.length !== merged.size) throw new BadRequestException("One or more items are not in inventory");

    const lineRows = items.map((item) => {
      const draft = merged.get(item.id)!;
      const quantity = Number(draft.quantity.toFixed(3));
      const rate = money2(draft.ratePerUnit);
      return {
        storeItemId: item.id,
        categoryName: item.category.name,
        unit: item.unit,
        quantity,
        ratePerUnit: rate,
        amount: money2(quantity * rate),
      };
    });
    const total = money2(lineRows.reduce((s, l) => s + l.amount, 0));
    if (total <= 0) throw new BadRequestException("Purchase total must be greater than zero");

    let paid = dto.payKind === "CASH" ? total : money2(dto.paidAmount ?? 0);
    if (paid < 0 || paid - total > 0.009) {
      throw new BadRequestException("Paid amount cannot be more than the bill");
    }
    paid = Math.min(paid, total);

    const purchasedAt = dayStamp(dto.purchasedOn);

    const purchase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          supplierId: supplier.id,
          purchasedAt,
          payKind: dto.payKind,
          paidAmount: paid,
          total,
          note: dto.note?.trim() || null,
          lines: { create: lineRows },
        },
        include: { lines: true },
      });
      for (const line of lineRows) {
        await tx.storeItem.update({
          where: { id: line.storeItemId },
          data: {
            quantityOnHand: { increment: line.quantity },
            ratePerUnit: line.ratePerUnit,
          },
        });
        await tx.stockMovement.create({
          data: {
            storeItemId: line.storeItemId,
            type: "IN",
            quantity: line.quantity,
            ratePerUnit: line.ratePerUnit,
            note: `Purchase · ${supplier.name}`,
            purchaseId: created.id,
          },
        });
      }
      return created;
    });

    return this.purchaseDto(purchase.id);
  }

  async paySupplier(id: string, dto: SupplierPaymentDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: { select: { total: true, paidAmount: true } },
        payments: { select: { amount: true } },
      },
    });
    if (!supplier || !supplier.active) throw new NotFoundException("Supplier not found");
    const bal = supplierBalance(supplier.purchases, supplier.payments);
    const amount = money2(dto.amount);
    if (amount - bal.outstanding > 0.009) {
      throw new BadRequestException(`Payment is more than outstanding (Rs ${bal.outstanding})`);
    }
    await this.prisma.supplierPayment.create({
      data: {
        supplierId: id,
        amount,
        paidAt: dayStamp(dto.paidOn || localDate(new Date())),
        note: dto.note?.trim() || null,
      },
    });
    return this.ledger(id);
  }

  async daily(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException("Date must be YYYY-MM-DD");
    const { start, end } = dayRange(date);
    const rows = await this.prisma.purchase.findMany({
      where: { purchasedAt: { gte: start, lte: end } },
      orderBy: { createdAt: "asc" },
      include: {
        supplier: { select: { id: true, name: true } },
        lines: { include: { storeItem: { select: { name: true } } } },
      },
    });
    const lines = rows.flatMap((p) =>
      p.lines.map((l) => ({
        id: l.id,
        purchaseId: p.id,
        supplier: p.supplier.name,
        payKind: p.payKind,
        item: l.storeItem.name,
        category: l.categoryName,
        unit: l.unit,
        quantity: toNumber(l.quantity),
        ratePerUnit: toNumber(l.ratePerUnit),
        amount: toNumber(l.amount),
      }))
    );
    const total = money2(lines.reduce((s, l) => s + l.amount, 0));
    return { date, purchaseCount: rows.length, lineCount: lines.length, total, lines };
  }

  async recentDates(limit = 45) {
    const rows = await this.prisma.purchase.findMany({
      select: { purchasedAt: true },
      orderBy: { purchasedAt: "desc" },
      take: 400,
    });
    const dates: string[] = [];
    for (const r of rows) {
      const d = localDate(r.purchasedAt);
      if (!dates.includes(d)) dates.push(d);
      if (dates.length >= limit) break;
    }
    return dates;
  }

  async recentPurchases(limit = 12) {
    const rows = await this.prisma.purchase.findMany({
      orderBy: { purchasedAt: "desc" },
      take: limit,
      include: { supplier: { select: { name: true } }, lines: true },
    });
    return rows.map((p) => ({
      id: p.id,
      purchasedOn: localDate(p.purchasedAt),
      supplier: p.supplier.name,
      payKind: p.payKind,
      total: toNumber(p.total),
      paidAmount: toNumber(p.paidAmount),
      outstanding: money2(toNumber(p.total) - toNumber(p.paidAmount)),
      lineCount: p.lines.length,
    }));
  }

  private async purchaseDto(id: string) {
    const p = await this.prisma.purchase.findUniqueOrThrow({
      where: { id },
      include: { supplier: true, lines: { include: { storeItem: true } } },
    });
    return {
      id: p.id,
      purchasedOn: localDate(p.purchasedAt),
      supplier: p.supplier.name,
      payKind: p.payKind,
      total: toNumber(p.total),
      paidAmount: toNumber(p.paidAmount),
      outstanding: money2(toNumber(p.total) - toNumber(p.paidAmount)),
      lines: p.lines.map((l) => ({
        item: l.storeItem.name,
        category: l.categoryName,
        unit: l.unit,
        quantity: toNumber(l.quantity),
        ratePerUnit: toNumber(l.ratePerUnit),
        amount: toNumber(l.amount),
      })),
    };
  }
}
