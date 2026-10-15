import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { HotelExpensePeriod, Prisma, WorkerLedgerKind, WorkerPayType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FinanceService } from "../finance/finance.service";
import { SettingsService } from "../system/settings.service";
import { toNumber } from "../common/units";
import { businessQueryRange } from "../common/business-day";
import {
  CreateLedgerEntryDto,
  CreateSalaryPaymentDto,
  CreateWorkerDto,
  GiveAdvanceDto,
  UpdateLedgerEntryDto,
  UpdateSalaryPaymentDto,
  UpdateWorkerDto,
} from "./dto";

const money2 = (n: number) => Math.round(n * 100) / 100;
const SALARY_CATEGORY = "Salary";
const ADVANCE_CATEGORY = "Salary advance";
const OTHER_CATEGORY = "Worker other";

const MANUAL_KINDS: WorkerLedgerKind[] = [
  WorkerLedgerKind.SALARY_CREDIT,
  WorkerLedgerKind.ADVANCE,
  WorkerLedgerKind.OTHER_DEBIT,
  WorkerLedgerKind.OPENING_PAYABLE,
  WorkerLedgerKind.OPENING_ADVANCE,
];

function dayStamp(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`);
}

function localDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Credit kinds increase جمع (hotel owes worker). */
function isCreditKind(kind: WorkerLedgerKind): boolean {
  return (
    kind === WorkerLedgerKind.OPENING_PAYABLE ||
    kind === WorkerLedgerKind.SALARY_CREDIT ||
    kind === WorkerLedgerKind.RECOVERY
  );
}

/** Signed delta: + = toward جمع, − = toward بنام. */
function signedDelta(kind: WorkerLedgerKind, amount: number): number {
  return isCreditKind(kind) ? amount : -amount;
}

function defaultDetail(kind: WorkerLedgerKind, note: string | null): string {
  const n = note?.trim();
  if (n) return n;
  switch (kind) {
    case WorkerLedgerKind.OPENING_PAYABLE:
    case WorkerLedgerKind.OPENING_ADVANCE:
      return "Opening Balance";
    case WorkerLedgerKind.SALARY_CREDIT:
      return "Salary credit";
    case WorkerLedgerKind.ADVANCE:
      return "Net Cash";
    case WorkerLedgerKind.OTHER_DEBIT:
      return "Other";
    case WorkerLedgerKind.RECOVERY:
      return "Recovered from salary";
    case WorkerLedgerKind.SETTLE_PAYABLE:
      return "Dena settled";
    default:
      return kind;
  }
}

function statusOf(balance: number): "JAMA" | "BANAM" | "ZERO" {
  if (balance > 0.009) return "JAMA";
  if (balance < -0.009) return "BANAM";
  return "ZERO";
}

type PartyBalances = {
  balance: number;
  status: "JAMA" | "BANAM" | "ZERO";
  openingAdvance: number;
  openingPayable: number;
  advancesGiven: number;
  salaryCredits: number;
  otherDebits: number;
  recovered: number;
  payableSettled: number;
  /** Legacy aliases for older UI. */
  advanceRemaining: number;
  payableRemaining: number;
};

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly settings: SettingsService
  ) {}

  private async businessRange(from: string, to: string) {
    const start = await this.settings.dayStart();
    const range = businessQueryRange(from, to, start.h, start.m);
    return { start: range.gte, end: range.lt };
  }

  private emptyBalances(): PartyBalances {
    return {
      balance: 0,
      status: "ZERO",
      openingAdvance: 0,
      openingPayable: 0,
      advancesGiven: 0,
      salaryCredits: 0,
      otherDebits: 0,
      recovered: 0,
      payableSettled: 0,
      advanceRemaining: 0,
      payableRemaining: 0,
    };
  }

  private balancesFromEntries(
    entries: { kind: WorkerLedgerKind; amount: Prisma.Decimal }[]
  ): PartyBalances {
    const b = this.emptyBalances();
    let signed = 0;
    for (const e of entries) {
      const amt = toNumber(e.amount);
      signed = money2(signed + signedDelta(e.kind, amt));
      if (e.kind === "OPENING_ADVANCE") b.openingAdvance = money2(b.openingAdvance + amt);
      else if (e.kind === "OPENING_PAYABLE") b.openingPayable = money2(b.openingPayable + amt);
      else if (e.kind === "ADVANCE") b.advancesGiven = money2(b.advancesGiven + amt);
      else if (e.kind === "SALARY_CREDIT") b.salaryCredits = money2(b.salaryCredits + amt);
      else if (e.kind === "OTHER_DEBIT") b.otherDebits = money2(b.otherDebits + amt);
      else if (e.kind === "RECOVERY") b.recovered = money2(b.recovered + amt);
      else if (e.kind === "SETTLE_PAYABLE") b.payableSettled = money2(b.payableSettled + amt);
    }
    b.balance = signed;
    b.status = statusOf(signed);
    // Legacy split view (best-effort)
    b.advanceRemaining = money2(Math.max(0, -Math.min(0, signed)));
    b.payableRemaining = money2(Math.max(0, signed));
    return b;
  }

  private async balancesMap(workerIds: string[]): Promise<Map<string, PartyBalances>> {
    const map = new Map<string, PartyBalances>();
    for (const id of workerIds) map.set(id, this.emptyBalances());
    if (!workerIds.length) return map;

    const entries = await this.prisma.workerLedgerEntry.findMany({
      where: { workerId: { in: workerIds } },
      select: { workerId: true, kind: true, amount: true },
    });
    const byWorker = new Map<string, { kind: WorkerLedgerKind; amount: Prisma.Decimal }[]>();
    for (const e of entries) {
      const list = byWorker.get(e.workerId) ?? [];
      list.push(e);
      byWorker.set(e.workerId, list);
    }
    for (const id of workerIds) {
      map.set(id, this.balancesFromEntries(byWorker.get(id) ?? []));
    }
    return map;
  }

  private async syncOpening(
    tx: Prisma.TransactionClient,
    workerId: string,
    openingAdvance: number,
    openingPayable: number,
    userId?: string
  ) {
    const today = dayStamp(localDate(new Date()));
    await tx.workerLedgerEntry.deleteMany({
      where: {
        workerId,
        kind: { in: [WorkerLedgerKind.OPENING_ADVANCE, WorkerLedgerKind.OPENING_PAYABLE] },
      },
    });
    if (openingAdvance > 0) {
      await tx.workerLedgerEntry.create({
        data: {
          workerId,
          kind: WorkerLedgerKind.OPENING_ADVANCE,
          amount: money2(openingAdvance),
          entryOn: today,
          note: "Opening Balance",
          createdById: userId ?? null,
        },
      });
    }
    if (openingPayable > 0) {
      await tx.workerLedgerEntry.create({
        data: {
          workerId,
          kind: WorkerLedgerKind.OPENING_PAYABLE,
          amount: money2(openingPayable),
          entryOn: today,
          note: "Opening Balance",
          createdById: userId ?? null,
        },
      });
    }
  }

  private workerRow(
    w: {
      id: string;
      name: string;
      jobTitle: string | null;
      phone: string | null;
      payType: WorkerPayType;
      rate: Prisma.Decimal;
      active: boolean;
      note: string | null;
      createdAt: Date;
      updatedAt: Date;
      _count?: { payments: number; ledger: number };
    },
    bal: PartyBalances
  ) {
    return {
      id: w.id,
      name: w.name,
      jobTitle: w.jobTitle,
      phone: w.phone,
      payType: w.payType,
      rate: toNumber(w.rate),
      active: w.active,
      note: w.note,
      paymentCount: w._count?.payments ?? 0,
      ledgerCount: w._count?.ledger ?? 0,
      balance: bal.balance,
      status: bal.status,
      openingAdvance: bal.openingAdvance,
      openingPayable: bal.openingPayable,
      advancesGiven: bal.advancesGiven,
      salaryCredits: bal.salaryCredits,
      otherDebits: bal.otherDebits,
      recovered: bal.recovered,
      payableSettled: bal.payableSettled,
      advanceRemaining: bal.advanceRemaining,
      payableRemaining: bal.payableRemaining,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    };
  }

  private paymentRow(p: {
    id: string;
    paidOn: Date;
    amount: Prisma.Decimal;
    advanceRecovered: Prisma.Decimal;
    payableSettled: Prisma.Decimal;
    period: HotelExpensePeriod;
    note: string | null;
    hotelExpenseId: string | null;
    createdAt: Date;
    worker: { id: string; name: string; jobTitle: string | null; payType: WorkerPayType };
    createdBy: { id: string; name: string } | null;
  }) {
    const amount = toNumber(p.amount);
    const advanceRecovered = toNumber(p.advanceRecovered);
    const payableSettled = toNumber(p.payableSettled);
    const cashPaid = money2(amount - advanceRecovered + payableSettled);
    return {
      id: p.id,
      paidOn: localDate(p.paidOn),
      amount,
      advanceRecovered,
      payableSettled,
      cashPaid: cashPaid < 0 ? 0 : cashPaid,
      period: p.period,
      note: p.note,
      hotelExpenseId: p.hotelExpenseId,
      createdAt: p.createdAt.toISOString(),
      worker: {
        id: p.worker.id,
        name: p.worker.name,
        jobTitle: p.worker.jobTitle,
        payType: p.worker.payType,
      },
      createdBy: p.createdBy,
    };
  }

  async listWorkers(includeInactive = false) {
    const rows = await this.prisma.worker.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { active: true }),
      },
      include: { _count: { select: { payments: true, ledger: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    const bals = await this.balancesMap(rows.map((w) => w.id));
    return rows.map((w) => this.workerRow(w, bals.get(w.id) ?? this.emptyBalances()));
  }

  async createWorker(dto: CreateWorkerDto, userId?: string) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("Worker name required");
    const openingAdvance = money2(dto.openingAdvance ?? 0);
    const openingPayable = money2(dto.openingPayable ?? 0);

    const created = await this.prisma.$transaction(async (tx) => {
      const w = await tx.worker.create({
        data: {
          name,
          jobTitle: dto.jobTitle?.trim() || null,
          phone: dto.phone?.trim() || null,
          payType: dto.payType,
          rate: money2(dto.rate ?? 0),
          note: dto.note?.trim() || null,
          active: dto.active ?? true,
        },
      });
      await this.syncOpening(tx, w.id, openingAdvance, openingPayable, userId);
      return tx.worker.findUniqueOrThrow({
        where: { id: w.id },
        include: { _count: { select: { payments: true, ledger: true } } },
      });
    });

    const bals = await this.balancesMap([created.id]);
    return this.workerRow(created, bals.get(created.id) ?? this.emptyBalances());
  }

  async updateWorker(id: string, dto: UpdateWorkerDto, userId?: string) {
    const existing = await this.prisma.worker.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException("Worker not found");

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.worker.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle.trim() || null } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
          ...(dto.payType ? { payType: dto.payType } : {}),
          ...(dto.rate != null ? { rate: money2(dto.rate) } : {}),
          ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
      if (dto.openingAdvance !== undefined || dto.openingPayable !== undefined) {
        const bals = this.balancesFromEntries(
          await tx.workerLedgerEntry.findMany({
            where: { workerId: id },
            select: { kind: true, amount: true },
          })
        );
        const nextAdv = dto.openingAdvance !== undefined ? money2(dto.openingAdvance) : bals.openingAdvance;
        const nextPay = dto.openingPayable !== undefined ? money2(dto.openingPayable) : bals.openingPayable;
        await this.syncOpening(tx, id, nextAdv, nextPay, userId);
      }
      return tx.worker.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { payments: true, ledger: true } } },
      });
    });

    const bals = await this.balancesMap([id]);
    return this.workerRow(updated, bals.get(id) ?? this.emptyBalances());
  }

  async removeWorker(id: string) {
    const existing = await this.prisma.worker.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { payments: true, ledger: true } } },
    });
    if (!existing) throw new NotFoundException("Worker not found");

    if (existing._count.payments > 0 || existing._count.ledger > 0) {
      await this.prisma.worker.update({
        where: { id },
        data: { active: false, deletedAt: new Date() },
      });
      return { ok: true, softDeleted: true };
    }

    await this.prisma.worker.delete({ where: { id } });
    return { ok: true, softDeleted: false };
  }

  async listPayments(from: string, to: string, workerId?: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException("from/to must be YYYY-MM-DD");
    }
    const { start, end } = await this.businessRange(from, to);
    const rows = await this.prisma.workerSalaryPayment.findMany({
      where: {
        paidOn: { gte: start, lt: end },
        ...(workerId ? { workerId } : {}),
      },
      include: {
        worker: { select: { id: true, name: true, jobTitle: true, payType: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
    });

    const payments = rows.map((p) => this.paymentRow(p));
    const total = money2(payments.reduce((s, p) => s + p.amount, 0));
    const cashTotal = money2(payments.reduce((s, p) => s + p.cashPaid, 0));
    const recoveredTotal = money2(payments.reduce((s, p) => s + p.advanceRecovered, 0));
    const dailyTotal = money2(payments.filter((p) => p.period === "DAILY").reduce((s, p) => s + p.amount, 0));
    const monthlyTotal = money2(
      payments.filter((p) => p.period === "MONTHLY").reduce((s, p) => s + p.amount, 0)
    );

    const byWorkerMap = new Map<string, { workerId: string; name: string; amount: number; count: number }>();
    for (const p of payments) {
      const cur = byWorkerMap.get(p.worker.id) ?? {
        workerId: p.worker.id,
        name: p.worker.name,
        amount: 0,
        count: 0,
      };
      cur.amount = money2(cur.amount + p.amount);
      cur.count += 1;
      byWorkerMap.set(p.worker.id, cur);
    }

    const byDayMap = new Map<string, { date: string; amount: number; count: number }>();
    for (const p of payments) {
      const cur = byDayMap.get(p.paidOn) ?? { date: p.paidOn, amount: 0, count: 0 };
      cur.amount = money2(cur.amount + p.amount);
      cur.count += 1;
      byDayMap.set(p.paidOn, cur);
    }

    return {
      from,
      to,
      payments,
      summary: {
        count: payments.length,
        total,
        cashTotal,
        recoveredTotal,
        dailyTotal,
        monthlyTotal,
        byWorker: [...byWorkerMap.values()].sort((a, b) => b.amount - a.amount),
        byDay: [...byDayMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
      },
    };
  }

  private async rememberCategory(tx: Prisma.TransactionClient, name: string) {
    await tx.hotelExpenseCategory.upsert({
      where: { name },
      create: { name },
      update: {},
    });
  }

  private expenseMeta(kind: WorkerLedgerKind, workerName: string, note: string | null) {
    if (kind === WorkerLedgerKind.ADVANCE) {
      return {
        category: ADVANCE_CATEGORY,
        title: workerName,
        note: note ? `Net Cash · ${workerName} · ${note}` : `Net Cash · ${workerName}`,
      };
    }
    if (kind === WorkerLedgerKind.OTHER_DEBIT) {
      return {
        category: OTHER_CATEGORY,
        title: note?.trim() || workerName,
        note: note ? `${note} · ${workerName}` : workerName,
      };
    }
    return null;
  }

  async listLedger(workerId: string) {
    const worker = await this.prisma.worker.findFirst({
      where: { id: workerId, deletedAt: null },
    });
    if (!worker) throw new NotFoundException("Worker not found");

    const rows = await this.prisma.workerLedgerEntry.findMany({
      where: { workerId },
      orderBy: [{ entryOn: "asc" }, { createdAt: "asc" }],
      include: { createdBy: { select: { id: true, name: true } } },
    });

    let running = 0;
    const lines = rows.map((e) => {
      const amount = toNumber(e.amount);
      const credit = isCreditKind(e.kind) ? amount : 0;
      const debit = isCreditKind(e.kind) ? 0 : amount;
      running = money2(running + credit - debit);
      return {
        id: e.id,
        kind: e.kind,
        entryOn: localDate(e.entryOn),
        detail: defaultDetail(e.kind, e.note),
        note: e.note,
        debit: debit || 0,
        credit: credit || 0,
        balance: running,
        status: statusOf(running),
        hotelExpenseId: e.hotelExpenseId,
        salaryPaymentId: e.salaryPaymentId,
        editable: MANUAL_KINDS.includes(e.kind) && !e.salaryPaymentId,
        createdBy: e.createdBy,
        createdAt: e.createdAt.toISOString(),
      };
    });

    const bals = this.balancesFromEntries(rows);
    return {
      worker: {
        id: worker.id,
        name: worker.name,
        jobTitle: worker.jobTitle,
        phone: worker.phone,
        payType: worker.payType,
        rate: toNumber(worker.rate),
        active: worker.active,
        note: worker.note,
      },
      balance: bals.balance,
      status: bals.status,
      balances: bals,
      lines,
    };
  }

  async addLedgerEntry(workerId: string, dto: CreateLedgerEntryDto, userId: string) {
    await this.settings.assertHotelOpen();
    const amount = money2(dto.amount);
    if (amount <= 0) throw new BadRequestException("Amount must be greater than zero");

    const worker = await this.prisma.worker.findFirst({
      where: { id: workerId, deletedAt: null },
    });
    if (!worker) throw new NotFoundException("Worker not found");
    if (!worker.active) throw new BadRequestException("Worker is inactive");

    const entryOn = dayStamp(dto.entryOn);
    await this.finance.assertNotLocked(entryOn);
    const note = dto.note?.trim() || null;

    // Pay salary in cash: salary credit + net cash (expense) — not kept on books
    if (dto.kind === "SALARY_CASH") {
      const creditNote = note || "Salary credit";
      const cashNote = note ? `Salary paid (cash) · ${note}` : "Salary paid (cash)";
      await this.prisma.$transaction(async (tx) => {
        await tx.workerLedgerEntry.create({
          data: {
            workerId,
            kind: WorkerLedgerKind.SALARY_CREDIT,
            amount,
            entryOn,
            note: creditNote,
            createdById: userId,
          },
        });
        const expense = await tx.hotelExpense.create({
          data: {
            spentAt: entryOn,
            category: SALARY_CATEGORY,
            title: worker.name,
            amount,
            period: HotelExpensePeriod.DAILY,
            note: `${cashNote} · ${worker.name}`,
            createdById: userId,
          },
        });
        await this.rememberCategory(tx, SALARY_CATEGORY);
        await tx.workerLedgerEntry.create({
          data: {
            workerId,
            kind: WorkerLedgerKind.ADVANCE,
            amount,
            entryOn,
            note: cashNote,
            hotelExpenseId: expense.id,
            createdById: userId,
          },
        });
      });
      return this.listLedger(workerId);
    }

    const kind = dto.kind as WorkerLedgerKind;
    if (!MANUAL_KINDS.includes(kind)) {
      throw new BadRequestException("Invalid ledger kind");
    }

    // Opening kinds: replace existing opening of that side
    if (kind === WorkerLedgerKind.OPENING_PAYABLE || kind === WorkerLedgerKind.OPENING_ADVANCE) {
      await this.prisma.$transaction(async (tx) => {
        await tx.workerLedgerEntry.deleteMany({
          where: { workerId, kind },
        });
        await tx.workerLedgerEntry.create({
          data: {
            workerId,
            kind,
            amount,
            entryOn,
            note: note || "Opening Balance",
            createdById: userId,
          },
        });
      });
      return this.listLedger(workerId);
    }

    const exp = this.expenseMeta(kind, worker.name, note);

    await this.prisma.$transaction(async (tx) => {
      let hotelExpenseId: string | null = null;
      if (exp) {
        const expense = await tx.hotelExpense.create({
          data: {
            spentAt: entryOn,
            category: exp.category,
            title: exp.title,
            amount,
            period: HotelExpensePeriod.DAILY,
            note: exp.note,
            createdById: userId,
          },
        });
        hotelExpenseId = expense.id;
        await this.rememberCategory(tx, exp.category);
      }

      await tx.workerLedgerEntry.create({
        data: {
          workerId,
          kind,
          amount,
          entryOn,
          note,
          hotelExpenseId,
          createdById: userId,
        },
      });
    });

    return this.listLedger(workerId);
  }

  async updateLedgerEntry(entryId: string, dto: UpdateLedgerEntryDto) {
    await this.settings.assertHotelOpen();
    const existing = await this.prisma.workerLedgerEntry.findUnique({ where: { id: entryId } });
    if (!existing) throw new NotFoundException("Ledger entry not found");
    if (!MANUAL_KINDS.includes(existing.kind) || existing.salaryPaymentId) {
      throw new BadRequestException("This ledger line cannot be edited");
    }
    await this.finance.assertNotLocked(existing.entryOn);

    const entryOn = dto.entryOn ? dayStamp(dto.entryOn) : existing.entryOn;
    if (dto.entryOn) await this.finance.assertNotLocked(entryOn);
    const amount = dto.amount != null ? money2(dto.amount) : toNumber(existing.amount);
    if (amount <= 0) throw new BadRequestException("Amount must be greater than zero");
    const note = dto.note !== undefined ? dto.note.trim() || null : existing.note;

    const worker = await this.prisma.worker.findFirst({
      where: { id: existing.workerId, deletedAt: null },
    });
    if (!worker) throw new NotFoundException("Worker not found");

    const exp = this.expenseMeta(existing.kind, worker.name, note);

    await this.prisma.$transaction(async (tx) => {
      let hotelExpenseId = existing.hotelExpenseId;
      if (exp) {
        if (hotelExpenseId) {
          await tx.hotelExpense.update({
            where: { id: hotelExpenseId },
            data: {
              spentAt: entryOn,
              category: exp.category,
              title: exp.title,
              amount,
              note: exp.note,
            },
          });
        } else {
          const expense = await tx.hotelExpense.create({
            data: {
              spentAt: entryOn,
              category: exp.category,
              title: exp.title,
              amount,
              period: HotelExpensePeriod.DAILY,
              note: exp.note,
              createdById: existing.createdById,
            },
          });
          hotelExpenseId = expense.id;
          await this.rememberCategory(tx, exp.category);
        }
      }

      await tx.workerLedgerEntry.update({
        where: { id: entryId },
        data: { entryOn, amount, note, hotelExpenseId },
      });
    });

    return this.listLedger(existing.workerId);
  }

  async deleteLedgerEntry(entryId: string) {
    await this.settings.assertHotelOpen();
    const existing = await this.prisma.workerLedgerEntry.findUnique({ where: { id: entryId } });
    if (!existing) throw new NotFoundException("Ledger entry not found");
    if (!MANUAL_KINDS.includes(existing.kind) || existing.salaryPaymentId) {
      throw new BadRequestException("This ledger line cannot be deleted");
    }
    await this.finance.assertNotLocked(existing.entryOn);

    await this.prisma.$transaction(async (tx) => {
      if (existing.hotelExpenseId) {
        await tx.workerLedgerEntry.update({
          where: { id: entryId },
          data: { hotelExpenseId: null },
        });
        await tx.hotelExpense.delete({ where: { id: existing.hotelExpenseId } }).catch(() => null);
      }
      await tx.workerLedgerEntry.delete({ where: { id: entryId } });
    });

    return this.listLedger(existing.workerId);
  }

  private async syncPaymentLedger(
    tx: Prisma.TransactionClient,
    paymentId: string,
    workerId: string,
    paidOn: Date,
    advanceRecovered: number,
    payableSettled: number,
    userId: string | null
  ) {
    await tx.workerLedgerEntry.deleteMany({
      where: {
        salaryPaymentId: paymentId,
        kind: { in: [WorkerLedgerKind.RECOVERY, WorkerLedgerKind.SETTLE_PAYABLE] },
      },
    });
    if (advanceRecovered > 0) {
      await tx.workerLedgerEntry.create({
        data: {
          workerId,
          kind: WorkerLedgerKind.RECOVERY,
          amount: advanceRecovered,
          entryOn: paidOn,
          note: "Recovered from salary",
          salaryPaymentId: paymentId,
          createdById: userId,
        },
      });
    }
    if (payableSettled > 0) {
      await tx.workerLedgerEntry.create({
        data: {
          workerId,
          kind: WorkerLedgerKind.SETTLE_PAYABLE,
          amount: payableSettled,
          entryOn: paidOn,
          note: "Settled opening payable",
          salaryPaymentId: paymentId,
          createdById: userId,
        },
      });
    }
  }

  private assertPayAmounts(
    amount: number,
    advanceRecovered: number,
    payableSettled: number,
    advanceRemaining: number,
    payableRemaining: number
  ) {
    if (amount < 0 || advanceRecovered < 0 || payableSettled < 0) {
      throw new BadRequestException("Amounts cannot be negative");
    }
    if (amount + advanceRecovered + payableSettled <= 0.009) {
      throw new BadRequestException("Enter salary, advance recovery, or dena settle amount");
    }
    if (advanceRecovered > advanceRemaining + 0.001) {
      throw new BadRequestException(
        `Advance recovery cannot exceed remaining lena ${advanceRemaining}`
      );
    }
    if (payableSettled > payableRemaining + 0.001) {
      throw new BadRequestException(
        `Dena settle cannot exceed remaining dena ${payableRemaining}`
      );
    }
    const cashPaid = money2(amount - advanceRecovered + payableSettled);
    if (cashPaid < -0.001) {
      throw new BadRequestException(
        `Salary + dena settle must cover advance recovery (need at least ${money2(
          advanceRecovered - payableSettled
        )} salary)`
      );
    }
    return cashPaid;
  }

  async paySalary(dto: CreateSalaryPaymentDto, userId: string) {
    await this.settings.assertHotelOpen();
    const amount = money2(dto.amount);

    const worker = await this.prisma.worker.findFirst({
      where: { id: dto.workerId, deletedAt: null },
    });
    if (!worker) throw new NotFoundException("Worker not found");
    if (!worker.active) throw new BadRequestException("Worker is inactive");

    const paidOn = dayStamp(dto.paidOn);
    await this.finance.assertNotLocked(paidOn);

    const bals = (await this.balancesMap([worker.id])).get(worker.id) ?? this.emptyBalances();
    const advanceRecovered =
      dto.advanceRecovered !== undefined
        ? money2(dto.advanceRecovered)
        : money2(Math.min(amount, bals.advanceRemaining));
    const payableSettled = money2(dto.payableSettled ?? 0);
    const cashPaid = this.assertPayAmounts(
      amount,
      advanceRecovered,
      payableSettled,
      bals.advanceRemaining,
      bals.payableRemaining
    );
    const note = dto.note?.trim() || null;
    const parts = [`Salary · ${worker.name}`];
    if (advanceRecovered > 0) parts.push(`recover ${advanceRecovered}`);
    if (payableSettled > 0) parts.push(`settle dena ${payableSettled}`);
    if (note) parts.push(note);
    const expenseNote = parts.join(" · ");

    const created = await this.prisma.$transaction(async (tx) => {
      let hotelExpenseId: string | null = null;
      if (cashPaid > 0.009) {
        const expense = await tx.hotelExpense.create({
          data: {
            spentAt: paidOn,
            category: SALARY_CATEGORY,
            title: worker.name,
            amount: cashPaid,
            period: dto.period,
            note: expenseNote,
            createdById: userId,
          },
        });
        hotelExpenseId = expense.id;
        await this.rememberCategory(tx, SALARY_CATEGORY);
      }

      const payment = await tx.workerSalaryPayment.create({
        data: {
          workerId: worker.id,
          paidOn,
          amount,
          advanceRecovered,
          payableSettled,
          period: dto.period,
          note,
          hotelExpenseId,
          createdById: userId,
        },
        include: {
          worker: { select: { id: true, name: true, jobTitle: true, payType: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });

      await this.syncPaymentLedger(
        tx,
        payment.id,
        worker.id,
        paidOn,
        advanceRecovered,
        payableSettled,
        userId
      );
      return payment;
    });

    return this.paymentRow(created);
  }

  async updatePayment(id: string, dto: UpdateSalaryPaymentDto) {
    await this.settings.assertHotelOpen();
    const existing = await this.prisma.workerSalaryPayment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Salary payment not found");
    await this.finance.assertNotLocked(existing.paidOn);

    const workerId = dto.workerId ?? existing.workerId;
    const worker = await this.prisma.worker.findFirst({
      where: { id: workerId, deletedAt: null },
    });
    if (!worker) throw new NotFoundException("Worker not found");

    const paidOn = dto.paidOn ? dayStamp(dto.paidOn) : existing.paidOn;
    if (dto.paidOn) await this.finance.assertNotLocked(paidOn);

    const amount = dto.amount != null ? money2(dto.amount) : toNumber(existing.amount);
    const period = dto.period ?? existing.period;
    const note = dto.note !== undefined ? dto.note.trim() || null : existing.note;

    const bals = (await this.balancesMap([worker.id])).get(worker.id) ?? this.emptyBalances();
    const oldRec = toNumber(existing.advanceRecovered);
    const oldSet = toNumber(existing.payableSettled);
    const availAdv = money2(bals.advanceRemaining + (existing.workerId === worker.id ? oldRec : 0));
    const availPay = money2(bals.payableRemaining + (existing.workerId === worker.id ? oldSet : 0));

    const advanceRecovered =
      dto.advanceRecovered !== undefined ? money2(dto.advanceRecovered) : oldRec;
    const payableSettled = dto.payableSettled !== undefined ? money2(dto.payableSettled) : oldSet;

    const cashPaid = this.assertPayAmounts(
      amount,
      advanceRecovered,
      payableSettled,
      availAdv,
      availPay
    );
    const parts = [`Salary · ${worker.name}`];
    if (advanceRecovered > 0) parts.push(`recover ${advanceRecovered}`);
    if (payableSettled > 0) parts.push(`settle dena ${payableSettled}`);
    if (note) parts.push(note);
    const expenseNote = parts.join(" · ");

    const updated = await this.prisma.$transaction(async (tx) => {
      let hotelExpenseId = existing.hotelExpenseId;
      if (cashPaid > 0.009) {
        if (hotelExpenseId) {
          await tx.hotelExpense.update({
            where: { id: hotelExpenseId },
            data: {
              spentAt: paidOn,
              title: worker.name,
              amount: cashPaid,
              period,
              note: expenseNote,
              category: SALARY_CATEGORY,
            },
          });
        } else {
          const expense = await tx.hotelExpense.create({
            data: {
              spentAt: paidOn,
              category: SALARY_CATEGORY,
              title: worker.name,
              amount: cashPaid,
              period,
              note: expenseNote,
              createdById: existing.createdById,
            },
          });
          hotelExpenseId = expense.id;
          await this.rememberCategory(tx, SALARY_CATEGORY);
        }
      } else if (hotelExpenseId) {
        await tx.workerSalaryPayment.update({
          where: { id },
          data: { hotelExpenseId: null },
        });
        await tx.hotelExpense.delete({ where: { id: hotelExpenseId } });
        hotelExpenseId = null;
      }

      const payment = await tx.workerSalaryPayment.update({
        where: { id },
        data: {
          workerId: worker.id,
          paidOn,
          amount,
          advanceRecovered,
          payableSettled,
          period,
          note,
          hotelExpenseId,
        },
        include: {
          worker: { select: { id: true, name: true, jobTitle: true, payType: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });

      await this.syncPaymentLedger(
        tx,
        payment.id,
        worker.id,
        paidOn,
        advanceRecovered,
        payableSettled,
        existing.createdById
      );
      return payment;
    });

    return this.paymentRow(updated);
  }

  async giveAdvance(dto: GiveAdvanceDto, userId: string) {
    return this.addLedgerEntry(
      dto.workerId,
      {
        kind: WorkerLedgerKind.ADVANCE,
        entryOn: dto.paidOn,
        amount: dto.amount,
        note: dto.note,
      },
      userId
    );
  }
}
