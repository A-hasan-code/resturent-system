import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { businessDateOf, localIsoDay, parseDayStart } from "./businessDay";
import { useSocketEvent } from "./socket";

export type HotelStatus = {
  /** @deprecated alias of dayStart — kept for older clients */
  closeTime: string;
  /** Current business day YYYY-MM-DD (open → close shift). */
  businessDate?: string;
  dayStart?: string;
  /** Shift end HH:mm (next morning if overnight, e.g. 03:00). */
  dayClose?: string;
  manuallyClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  openedAt: string | null;
  openedBy: string | null;
  acceptingOrders: boolean;
  /** False when hotel is closed — shift ended (no close / expenses / inventory close). */
  shiftOpen?: boolean;
};

type HotelGateValue = {
  gate: HotelStatus | null;
  reload: () => Promise<void>;
};

const HotelGateContext = createContext<HotelGateValue | null>(null);

export function HotelGateProvider({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<HotelStatus | null>(null);

  async function reload() {
    try {
      setGate(await api<HotelStatus>("/system/hotel"));
    } catch {
      /* banner stays on the last known status */
    }
  }

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 20000);
    return () => clearInterval(timer);
  }, []);

  useSocketEvent<HotelStatus>("hotel.status", (next) => setGate(next));

  return <HotelGateContext.Provider value={{ gate, reload }}>{children}</HotelGateContext.Provider>;
}

export function useHotelGate() {
  const ctx = useContext(HotelGateContext);
  if (!ctx) throw new Error("HotelGateProvider missing");
  return ctx;
}

/** True while hotel is open (shift live). Defaults true if status not loaded yet. */
export function useShiftOpen() {
  const { gate } = useHotelGate();
  if (!gate) return true;
  if (typeof gate.shiftOpen === "boolean") return gate.shiftOpen;
  return gate.acceptingOrders;
}

/**
 * Current restaurant business day for cash/history pickers.
 * Prefers server hotel.businessDate; falls back to local clock + open/close shift.
 */
export function useBusinessDay() {
  const { gate } = useHotelGate();
  const dayStart = gate?.dayStart || gate?.closeTime || "11:00";
  const dayClose = gate?.dayClose || "03:00";
  if (gate?.businessDate) {
    return { businessDate: gate.businessDate, dayStart, dayClose };
  }
  const open = parseDayStart(dayStart);
  const close = parseDayStart(dayClose);
  return {
    businessDate:
      businessDateOf(new Date(), open.h, open.m, close.h, close.m) || localIsoDay(),
    dayStart: open.label,
    dayClose: close.label,
  };
}
