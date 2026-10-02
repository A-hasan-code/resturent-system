import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "./settings.service";
import { toNumber } from "../common/units";

/** How guest tips are split among staff. */
export type TipSplit = "ORDER_TAKER" | "SERVER" | "SPLIT_50" | "POOL";

export type PrintBillOpts = {
  showOrderBy: boolean;
  showServedBy: boolean;
  showCashier: boolean;
  showTip: boolean;
  footer: string;
};

export type PrintKotOpts = {
  showOrderBy: boolean;
  footer: string;
};

const TIP_SPLITS = new Set<TipSplit>(["ORDER_TAKER", "SERVER", "SPLIT_50", "POOL"]);

@Injectable()
export class TipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService
  ) {}

  async tipSplit(): Promise<TipSplit> {
    const v = (await this.settings.get("tip.split", "ORDER_TAKER")).toUpperCase();
    // SERVER / SPLIT_50 kept for old settings — tips go to order-taker (server is free-text only).
    if (v === "POOL") return "POOL";
    return "ORDER_TAKER";
  }

  async printBillOpts(): Promise<PrintBillOpts> {
    const s = await this.settings.getMany("print.bill.");
    return {
      showOrderBy: s["print.bill.showOrderBy"] !== "0",
      showServedBy: s["print.bill.showServedBy"] !== "0",
      showCashier: s["print.bill.showCashier"] !== "0",
      showTip: s["print.bill.showTip"] !== "0",
      footer: (s["print.bill.footer"] || "Thank you - Come again!").trim(),
    };
  }

  async printKotOpts(): Promise<PrintKotOpts> {
    const s = await this.settings.getMany("print.kot.");
    return {
      showOrderBy: s["print.kot.showOrderBy"] !== "0",
      footer: (s["print.kot.footer"] || "").trim(),
    };
  }

  /**
   * Allocate tip among staff and write TipShare rows.
   * Call inside a transaction after updating order.tipAmount.
   */
  async allocate(
    tx: Prisma.TransactionClient,
    opts: {
      orderId: string;
      tip: number;
      orderTakerId: string | null;
    }
  ) {
    const tip = Math.round(opts.tip * 100) / 100;
    if (!(tip > 0)) return;

    await tx.tipShare.deleteMany({ where: { orderId: opts.orderId } });

    const split = await this.tipSplit();
    const shares: Array<{ userId: string; amount: number; kind: string }> = [];

    const taker = opts.orderTakerId;
    // Served-by is free text (not a user), so tip always lands on the order-taker / pool.
    if ((split === "ORDER_TAKER" || split === "SERVER" || split === "SPLIT_50") && taker) {
      shares.push({
        userId: taker,
        amount: tip,
        kind: split === "SERVER" ? "SERVER" : "ORDER_TAKER",
      });
    } else if (split === "POOL") {
      const floor = await tx.user.findMany({
        where: { active: true, role: { code: { in: ["WAITER", "MANAGER"] } } },
        select: { id: true },
      });
      if (floor.length) {
        const each = Math.floor((tip * 100) / floor.length) / 100;
        let left = tip;
        floor.forEach((u, i) => {
          const amount = i === floor.length - 1 ? Math.round(left * 100) / 100 : each;
          left = Math.round((left - amount) * 100) / 100;
          shares.push({ userId: u.id, amount, kind: "POOL" });
        });
      } else if (taker) {
        shares.push({ userId: taker, amount: tip, kind: "ORDER_TAKER" });
      }
    }

    if (!shares.length && taker) {
      shares.push({ userId: taker, amount: tip, kind: "ORDER_TAKER" });
    }

    for (const s of shares) {
      if (!(s.amount > 0)) continue;
      await tx.tipShare.create({
        data: { orderId: opts.orderId, userId: s.userId, amount: s.amount, kind: s.kind },
      });
    }
  }

  async tipsTodayForUser(userId: string, start: Date) {
    const agg = await this.prisma.tipShare.aggregate({
      where: { userId, createdAt: { gte: start } },
      _sum: { amount: true },
      _count: true,
    });
    return { amount: toNumber(agg._sum.amount ?? 0), shares: agg._count };
  }

  async tipsTodayTotal(start: Date) {
    const agg = await this.prisma.tipShare.aggregate({
      where: { createdAt: { gte: start } },
      _sum: { amount: true },
    });
    return toNumber(agg._sum.amount ?? 0);
  }

  async tipBoard(start: Date) {
    const rows = await this.prisma.tipShare.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: start } },
      _sum: { amount: true },
      _count: true,
    });
    if (!rows.length) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, name: true, role: { select: { code: true, name: true } } },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows
      .map((r) => {
        const u = byId.get(r.userId);
        return {
          userId: r.userId,
          name: u?.name ?? "—",
          roleCode: u?.role.code ?? "",
          roleName: u?.role.name ?? "",
          tip: toNumber(r._sum.amount ?? 0),
          shares: r._count,
        };
      })
      .sort((a, b) => b.tip - a.tip);
  }
}
