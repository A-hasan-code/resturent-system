import { Injectable } from "@nestjs/common";
import { RealtimeGateway, ROOM } from "./realtime.gateway";

export type OrderEvent = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  status: string;
  paymentStatus?: string;
  waiterId?: string | null;
};

@Injectable()
export class RealtimeService {
  constructor(private readonly gw: RealtimeGateway) {}

  orderChanged(o: OrderEvent, reason: string) {
    this.gw.emit(ROOM.all, "orders.changed", { ...o, reason });
    if (reason === "created" || reason === "items-added") {
      this.gw.emit(ROOM.kitchen, "kitchen.new", { ...o, reason });
    }
    if (o.status === "READY" && reason === "status") {
      const rooms = [ROOM.cashier];
      if (o.waiterId) rooms.push(ROOM.user(o.waiterId));
      this.gw.emit(rooms, "order.ready", o);
    }
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
