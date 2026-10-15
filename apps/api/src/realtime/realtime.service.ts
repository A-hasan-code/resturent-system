import { Injectable } from "@nestjs/common";
import { RealtimeGateway, ROOM } from "./realtime.gateway";

export type OrderEvent = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  tableId?: string | null;
  status: string;
  paymentStatus?: string;
  waiterId?: string | null;
  assignedCashierId?: string | null;
  kitchenHold?: boolean;
};

@Injectable()
export class RealtimeService {
  constructor(private readonly gw: RealtimeGateway) {}

  orderChanged(o: OrderEvent, reason: string) {
    this.gw.emit(ROOM.all, "orders.changed", { ...o, reason });
    // Takeaway (no table) belongs to Main Cashier — do not ping kitchen board.
    const toKitchen =
      !!o.tableId &&
      !o.kitchenHold &&
      reason !== "reservation-hold" &&
      (reason === "created" ||
        reason === "items-added" ||
        reason === "cancelled" ||
        reason === "reversed" ||
        reason === "edited");
    if (toKitchen) {
      this.gw.emit(ROOM.kitchen, "kitchen.new", { ...o, reason });
    }
    if ((o.status === "READY" || o.status === "SERVED") && reason === "status") {
      const rooms = [ROOM.cashier];
      if (o.status === "READY") rooms.push(ROOM.floor);
      if (o.waiterId) rooms.push(ROOM.user(o.waiterId));
      this.gw.emit(rooms, o.status === "READY" ? "order.ready" : "order.served", o);
    }
  }

  /** PENDING longer than 1 minute without Start — kitchen + cashiers + system manager (bill.view). */
  orderPendingSlow(o: OrderEvent & { waitSeconds: number }) {
    this.gw.emit([ROOM.kitchen, ROOM.cashier], "kitchen.pending.slow", o);
  }

  /** PREPARING past recipe target prep time. */
  orderPrepLate(
    o: OrderEvent & { targetMinutes: number; lateByMinutes: number; elapsedMinutes: number }
  ) {
    this.gw.emit([ROOM.kitchen, ROOM.cashier], "kitchen.prep.late", o);
  }

  billRequested(o: OrderEvent & { waiter?: string | null }) {
    this.gw.emit(ROOM.cashier, "bill.requested", o);
  }

  paymentsChanged() {
    this.gw.emit(ROOM.cashier, "payments.changed", {});
  }

  cashHandover(
    cashierId: string,
    p: { id: string; amount: number; orderNo: number; tableNo: string | null; from: string }
  ) {
    this.gw.emit(ROOM.user(cashierId), "cash.handover", p);
  }

  cashConfirmed(collectorId: string, p: { id: string; amount: number; orderNo: number; by: string }) {
    this.gw.emit(ROOM.user(collectorId), "cash.confirmed", p);
  }

  hotelStatus(status: unknown) {
    this.gw.emit(ROOM.all, "hotel.status", status);
  }

  printResult(
    job: { id: string; type: string; status: string; error?: string | null; printer?: string | null; orderNo?: number | null },
    requestedById?: string | null
  ) {
    if (job.status === "DONE") {
      if (requestedById) this.gw.emit(ROOM.user(requestedById), "print.done", job);
      return;
    }
    const rooms = [ROOM.print];
    if (requestedById) rooms.push(ROOM.user(requestedById));
    this.gw.emit(rooms, "print.failed", job);
  }
}
