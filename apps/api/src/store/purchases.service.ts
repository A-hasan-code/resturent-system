import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ExtraExpensePaidBy, Prisma } from "@prisma/client";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { PrismaService } from "../prisma/prisma.service";
import { toNumber } from "../common/units";
import { dataDir } from "../config/env";
import { SettingsService } from "../system/settings.service";
import { CreatePurchaseDto, CreateSupplierDto, SupplierPaymentDto, UpdateSupplierDto } from "./dto";
import { renderSupplierLedgerPdf } from "./supplier-pdf";

const BILL_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const BILL_MAX = 5 * 1024 * 1024;

const money2 = (n: number) => Math.round(n * 100) / 100;

/** Inventory total + supplier-side extra expense (self-paid extra is excluded). */
function supplierDue(p: {
  total: Prisma.Decimal | number;
  extraExpense?: Prisma.Decimal | number | null;
  extraExpensePaidBy?: ExtraExpensePaidBy | null;
}) {
  const inv = typeof p.total === "number" ? p.total : toNumber(p.total);
  const extra =
    p.extraExpensePaidBy === ExtraExpensePaidBy.SUPPLIER
      ? typeof p.extraExpense === "number"
        ? p.extraExpense
        : toNumber(p.extraExpense ?? 0)
      : 0;
  return money2(inv + extra);
}

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

type LedgerPurchase = {
  total: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  extraExpense?: Prisma.Decimal | null;
  extraExpensePaidBy?: ExtraExpensePaidBy | null;
};

/** Account paid is stored on each bill (invoice day + later account payments allocated FIFO). */
export function supplierBalance(purchases: (LedgerPurchase & { voidedAt?: Date | null })[]) {
  const live = purchases.filter((p) => !p.voidedAt);
  const purchased = money2(live.reduce((s, p) => s + supplierDue(p), 0));
  const paid = money2(live.reduce((s, p) => s + toNumber(p.paidAmount), 0));
  return { purchased, paid, outstanding: money2(purchased - paid) };
}

type Tx = Prisma.TransactionClient;

/** Apply unallocated account payments onto oldest open bills first. */
async function allocateUnappliedPayments(tx: Tx, supplierId: string) {
  const pending = await tx.supplierPayment.findMany({
    where: { supplierId, allocated: false },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
  });
  if (!pending.length) return;

  for (const pay of pending) {
    const purchases = await tx.purchase.findMany({
      where: { supplierId, voidedAt: null },
      orderBy: [{ purchasedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        total: true,
        paidAmount: true,
        extraExpense: true,
        extraExpensePaidBy: true,
      },
    });

    let left = money2(toNumber(pay.amount));
    for (const p of purchases) {
      if (left <= 0.009) break;
      const due = supplierDue(p);
      const already = toNumber(p.paidAmount);
      const gap = money2(due - already);
      if (gap <= 0.009) continue;
      const use = Math.min(gap, left);
      await tx.purchase.update({
        where: { id: p.id },
        data: { paidAmount: money2(already + use) },
      });
      left = money2(left - use);
    }

    await tx.supplierPayment.update({
      where: { id: pay.id },
      data: { allocated: true },
    });
  }
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  billsDir() {
    return dataDir("purchase-bills");
  }

  async listSuppliers() {
    const ids = (
      await this.prisma.supplier.findMany({
        where: { active: true },
        select: { id: true },
      })
    ).map((s) => s.id);
    for (const id of ids) {
      await this.prisma.$transaction((tx) => allocateUnappliedPayments(tx, id));
    }

    const rows = await this.prisma.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        purchases: { select: { total: true, paidAmount: true, extraExpense: true, extraExpensePaidBy: true, voidedAt: true } },
      },
    });
    return rows.map((s) => {
      const bal = supplierBalance(s.purchases);
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        supplyOf: s.supplyOf,
        brand: s.brand,
        address: s.address,
        notes: s.notes,
        ...bal,
      };
    });
  }

  async createSupplier(dto: CreateSupplierDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Supplier name required");
    const row = await this.prisma.supplier.create({
      data: {
        name,
        phone: dto.phone?.trim() || null,
        supplyOf: dto.supplyOf?.trim() || null,
        brand: dto.brand?.trim() || null,
        address: dto.address?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      supplyOf: row.supplyOf,
      brand: row.brand,
      address: row.address,
      notes: row.notes,
      purchased: 0,
      paid: 0,
      outstanding: 0,
    };
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    try {
      const row = await this.prisma.supplier.update({
        where: { id },
        data: {
          ...(dto.name != null ? { name: dto.name.trim() } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
          ...(dto.supplyOf !== undefined ? { supplyOf: dto.supplyOf.trim() || null } : {}),
          ...(dto.brand !== undefined ? { brand: dto.brand.trim() || null } : {}),
          ...(dto.address !== undefined ? { address: dto.address.trim() || null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        supplyOf: row.supplyOf,
        brand: row.brand,
        address: row.address,
        active: row.active,
      };
    } catch {
      throw new NotFoundException("Supplier not found");
    }
  }

  async ledger(id: string) {
    await this.prisma.$transaction((tx) => allocateUnappliedPayments(tx, id));

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
    const bal = supplierBalance(supplier.purchases);
    return {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      supplyOf: supplier.supplyOf,
      brand: supplier.brand,
      address: supplier.address,
      notes: supplier.notes,
      ...bal,
      purchases: supplier.purchases.map((p) => {
        const due = supplierDue(p);
        const paidAmount = toNumber(p.paidAmount);
        const voided = !!p.voidedAt;
        return {
          id: p.id,
          purchasedOn: localDate(p.purchasedAt),
          payKind: p.payKind,
          total: toNumber(p.total),
          extraExpense: toNumber(p.extraExpense),
          extraExpenseNote: p.extraExpenseNote,
          extraExpensePaidBy: p.extraExpensePaidBy,
          paidAmount,
          balance: voided ? 0 : money2(due - paidAmount),
          note: p.note,
          voidedAt: p.voidedAt,
          voidNote: p.voidNote,
          hasBillImage: !!p.billImagePath,
          lines: p.lines.map((l) => ({
            id: l.id,
            item: l.storeItem.name,
            category: l.categoryName,
            unit: l.unit,
            quantity: toNumber(l.quantity),
            ratePerUnit: toNumber(l.ratePerUnit),
            amount: toNumber(l.amount),
          })),
        };
      }),
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

    const extraExpense = money2(dto.extraExpense ?? 0);
    let extraExpenseNote = dto.extraExpenseNote?.trim() || null;
    let extraExpensePaidBy: ExtraExpensePaidBy | null = dto.extraExpensePaidBy ?? null;
    if (extraExpense > 0) {
      if (!extraExpenseNote) throw new BadRequestException("Extra expense needs a reason (e.g. travel)");
      if (!extraExpensePaidBy) {
        throw new BadRequestException("Say if extra expense was paid to supplier or self-paid");
      }
    } else {
      extraExpenseNote = null;
      extraExpensePaidBy = null;
    }

    const due = supplierDue({
      total,
      extraExpense,
      extraExpensePaidBy,
    });

    let paid = dto.payKind === "CASH" ? due : money2(dto.paidAmount ?? 0);
    if (paid < 0 || paid - due > 0.009) {
      throw new BadRequestException("Paid amount cannot be more than the supplier bill");
    }
    paid = Math.min(paid, due);

    const purchasedAt = dayStamp(dto.purchasedOn);

    const purchase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          supplierId: supplier.id,
          purchasedAt,
          payKind: dto.payKind,
          paidAmount: paid,
          total,
          extraExpense,
          extraExpenseNote,
          extraExpensePaidBy,
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
      // Record cash paid with the bill so Hotel Expenses / profit use one cash ledger (SupplierPayment).
      if (paid > 0.009) {
        await tx.supplierPayment.create({
          data: {
            supplierId: supplier.id,
            amount: paid,
            paidAt: purchasedAt,
            note: `purchase:${created.id}`,
            allocated: true,
          },
        });
      }
      return created;
    });

    return this.purchaseDto(purchase.id);
  }

  /** Reverse stock IN and drop bill from supplier balance. Cash return is handled offline. */
  async voidPurchase(id: string, note?: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        lines: true,
        supplier: { select: { id: true, name: true, active: true } },
      },
    });
    if (!purchase) throw new NotFoundException("Purchase not found");
    if (purchase.voidedAt) throw new BadRequestException("Purchase already voided");

    await this.prisma.$transaction(async (tx) => {
      for (const line of purchase.lines) {
        const item = await tx.storeItem.findUniqueOrThrow({ where: { id: line.storeItemId } });
        const onHand = toNumber(item.quantityOnHand);
        const qty = toNumber(line.quantity);
        if (qty - onHand > 0.0001) {
          throw new BadRequestException(
            `Cannot void — not enough ${item.name} left in stock (have ${onHand} ${item.unit}, need ${qty})`
          );
        }
        await tx.storeItem.update({
          where: { id: line.storeItemId },
          data: { quantityOnHand: { decrement: qty } },
        });
        await tx.stockMovement.create({
          data: {
            storeItemId: line.storeItemId,
            type: "OUT",
            quantity: -qty,
            ratePerUnit: line.ratePerUnit,
            note: `Void purchase · ${purchase.supplier.name}`,
            purchaseId: purchase.id,
          },
        });
      }

      // Unlink the bill's cash payment record so supplier paid total stays consistent.
      if (toNumber(purchase.paidAmount) > 0.009) {
        await tx.supplierPayment.deleteMany({
          where: {
            supplierId: purchase.supplierId,
            note: `purchase:${purchase.id}`,
            allocated: true,
          },
        });
      }

      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          voidedAt: new Date(),
          voidNote: (note || "Voided").trim().slice(0, 200),
          paidAmount: 0,
        },
      });
    });

    await this.prisma.$transaction((tx) => allocateUnappliedPayments(tx, purchase.supplierId));
    return this.purchaseDto(id);
  }

  async paySupplier(id: string, dto: SupplierPaymentDto) {
    await this.prisma.$transaction((tx) => allocateUnappliedPayments(tx, id));

    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: { select: { total: true, paidAmount: true, extraExpense: true, extraExpensePaidBy: true, voidedAt: true } },
      },
    });
    if (!supplier || !supplier.active) throw new NotFoundException("Supplier not found");
    const bal = supplierBalance(supplier.purchases);
    const amount = money2(dto.amount);
    if (amount <= 0) throw new BadRequestException("Payment must be greater than zero");
    if (amount - bal.outstanding > 0.009) {
      throw new BadRequestException(`Payment is more than outstanding (Rs ${bal.outstanding})`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.supplierPayment.create({
        data: {
          supplierId: id,
          amount,
          paidAt: dayStamp(dto.paidOn || localDate(new Date())),
          note: dto.note?.trim() || null,
          allocated: false,
        },
      });
      await allocateUnappliedPayments(tx, id);
    });

    return this.ledger(id);
  }

  async ledgerPdf(id: string) {
    const ledger = await this.ledger(id);
    const hotel = await this.settings.restaurant();
    const pdf = await renderSupplierLedgerPdf(ledger, hotel);
    const safe = ledger.name.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").slice(0, 40) || "supplier";
    return { filename: `supplier-${safe}.pdf`, body: pdf };
  }

  async saveBillImage(id: string, file: { originalname: string; buffer: Buffer; mimetype: string; size: number }) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id }, select: { id: true, billImagePath: true } });
    if (!purchase) throw new NotFoundException("Purchase not found");
    if (!file?.buffer?.length) throw new BadRequestException("No image uploaded");
    if (file.size > BILL_MAX) throw new BadRequestException("Bill image must be under 5 MB");
    const ext = extname(file.originalname || "").toLowerCase() || mimeExt(file.mimetype);
    if (!BILL_EXTS.has(ext)) throw new BadRequestException("Use PNG, JPG or WEBP");

    const dir = this.billsDir();
    mkdirSync(dir, { recursive: true });
    this.removeBillFiles(purchase.id, purchase.billImagePath);
    const name = `${purchase.id}${ext}`;
    writeFileSync(join(dir, name), file.buffer);
    await this.prisma.purchase.update({ where: { id }, data: { billImagePath: name } });
    return { id, hasBillImage: true };
  }

  async billImage(id: string) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id }, select: { billImagePath: true } });
    if (!purchase) throw new NotFoundException("Purchase not found");
    if (!purchase.billImagePath) throw new NotFoundException("No bill image for this purchase");
    const path = join(this.billsDir(), purchase.billImagePath);
    if (!existsSync(path)) throw new NotFoundException("Bill image file missing");
    const ext = extname(purchase.billImagePath).toLowerCase();
    return {
      path,
      filename: purchase.billImagePath,
      contentType: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg",
    };
  }

  private removeBillFiles(purchaseId: string, stored?: string | null) {
    const dir = this.billsDir();
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (f === stored || f.startsWith(`${purchaseId}.`)) {
        try {
          unlinkSync(join(dir, f));
        } catch {
          /* ignore */
        }
      }
    }
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
    const inventoryTotal = money2(
      rows.filter((p) => !p.voidedAt).flatMap((p) => p.lines).reduce((s, l) => s + toNumber(l.amount), 0)
    );
    const extras = rows
      .filter((p) => !p.voidedAt && toNumber(p.extraExpense) > 0)
      .map((p) => ({
        purchaseId: p.id,
        supplier: p.supplier.name,
        amount: toNumber(p.extraExpense),
        note: p.extraExpenseNote,
        paidBy: p.extraExpensePaidBy,
      }));
    const extraTotal = money2(extras.reduce((s, e) => s + e.amount, 0));
    const lines = rows.flatMap((p) =>
      p.lines.map((l) => ({
        id: l.id,
        purchaseId: p.id,
        supplier: p.supplier.name,
        payKind: p.payKind,
        voided: !!p.voidedAt,
        item: l.storeItem.name,
        category: l.categoryName,
        unit: l.unit,
        quantity: toNumber(l.quantity),
        ratePerUnit: toNumber(l.ratePerUnit),
        amount: toNumber(l.amount),
      }))
    );
    return {
      date,
      purchaseCount: rows.filter((p) => !p.voidedAt).length,
      lineCount: lines.filter((l) => !l.voided).length,
      total: inventoryTotal,
      extraExpenseTotal: extraTotal,
      extras,
      lines,
    };
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
    return rows.map((p) => {
      const paidAmount = toNumber(p.paidAmount);
      const due = supplierDue(p);
      const voided = !!p.voidedAt;
      return {
        id: p.id,
        purchasedOn: localDate(p.purchasedAt),
        supplier: p.supplier.name,
        payKind: p.payKind,
        total: toNumber(p.total),
        extraExpense: toNumber(p.extraExpense),
        extraExpenseNote: p.extraExpenseNote,
        extraExpensePaidBy: p.extraExpensePaidBy,
        paidAmount,
        outstanding: voided ? 0 : money2(due - paidAmount),
        lineCount: p.lines.length,
        hasBillImage: !!p.billImagePath,
        voided,
        voidNote: p.voidNote,
      };
    });
  }

  private async purchaseDto(id: string) {
    const p = await this.prisma.purchase.findUniqueOrThrow({
      where: { id },
      include: { supplier: true, lines: { include: { storeItem: true } } },
    });
    const paidAmount = toNumber(p.paidAmount);
    const due = supplierDue(p);
    const voided = !!p.voidedAt;
    return {
      id: p.id,
      purchasedOn: localDate(p.purchasedAt),
      supplier: p.supplier.name,
      payKind: p.payKind,
      total: toNumber(p.total),
      extraExpense: toNumber(p.extraExpense),
      extraExpenseNote: p.extraExpenseNote,
      extraExpensePaidBy: p.extraExpensePaidBy,
      paidAmount,
      outstanding: voided ? 0 : money2(due - paidAmount),
      hasBillImage: !!p.billImagePath,
      voided,
      voidNote: p.voidNote,
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

function mimeExt(mime: string) {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  return "";
}
