import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { defaultPrepMinutes, targetPrepMinutes } from "./kitchen-timing";

const TICK_MS = 15_000;
const PENDING_ALERT_MS = 60_000;

@Injectable()
export class KitchenAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("KitchenAlerts");
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.checkPending();
      await this.checkLate();
    } catch (e) {
      this.log.warn(e instanceof Error ? e.message : "kitchen alert tick failed");
    } finally {
      this.running = false;
    }
  }

  private async checkPending() {
    const cutoff = new Date(Date.now() - PENDING_ALERT_MS);
    const rows = await this.prisma.order.findMany({
      where: {
        status: "PENDING",
        tableId: { not: null },
        pendingAlertedAt: null,
        pendingAt: { lte: cutoff },
        items: { some: { lineKind: "MENU" } },
      },
      select: {
        id: true,
        orderNo: true,
        tableNo: true,
        status: true,
        paymentStatus: true,
        waiterId: true,
        assignedCashierId: true,
        pendingAt: true,
      },
      take: 40,
    });

    for (const o of rows) {
      const waitSec = Math.max(60, Math.floor((Date.now() - o.pendingAt.getTime()) / 1000));
      await this.prisma.order.update({
        where: { id: o.id },
        data: { pendingAlertedAt: new Date() },
      });
      this.realtime.orderPendingSlow({
        id: o.id,
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        status: o.status,
        paymentStatus: o.paymentStatus,
        waiterId: o.waiterId,
        assignedCashierId: o.assignedCashierId,
        waitSeconds: waitSec,
      });
    }
  }

  private async checkLate() {
    const rows = await this.prisma.order.findMany({
      where: {
        status: "PREPARING",
        tableId: { not: null },
        lateAlertedAt: null,
        preparingAt: { not: null },
        items: { some: { lineKind: "MENU" } },
      },
      select: {
        id: true,
        orderNo: true,
        tableNo: true,
        status: true,
        paymentStatus: true,
        waiterId: true,
        assignedCashierId: true,
        preparingAt: true,
        items: {
          where: { lineKind: "MENU" },
          select: {
            name: true,
            menuItem: {
              select: {
                kitchenStation: true,
                recipe: { select: { prepMinutes: true } },
              },
            },
          },
        },
      },
      take: 40,
    });

    const now = Date.now();
    for (const o of rows) {
      if (!o.preparingAt) continue;
      const targetMin = targetPrepMinutes(
        o.items.map((i) => ({
          kitchenStation: i.menuItem?.kitchenStation ?? null,
          prepMinutes: i.menuItem?.recipe?.prepMinutes ?? null,
        }))
      );
      const elapsedMs = now - o.preparingAt.getTime();
      const targetMs = (targetMin || defaultPrepMinutes(null)) * 60_000;
      if (elapsedMs < targetMs) continue;

      const lateByMinutes = Math.max(1, Math.floor((elapsedMs - targetMs) / 60_000));
      await this.prisma.order.update({
        where: { id: o.id },
        data: { lateAlertedAt: new Date() },
      });
      this.realtime.orderPrepLate({
        id: o.id,
        orderNo: o.orderNo,
        tableNo: o.tableNo,
        status: o.status,
        paymentStatus: o.paymentStatus,
        waiterId: o.waiterId,
        assignedCashierId: o.assignedCashierId,
        targetMinutes: targetMin,
        lateByMinutes,
        elapsedMinutes: Math.floor(elapsedMs / 60_000),
      });
    }
  }
}
