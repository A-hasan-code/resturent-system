import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { businessDateOf, localIsoDay, parseDayStart } from "./businessDay";
import { useSocketEvent } from "./socket";

export type HotelStatus = {
  /** Server time from Settings. Only admin saves it. */
  closeTime: string;
  /** Current business day YYYY-MM-DD (dayStart → next dayStart). */
  businessDate?: string;
  dayStart?: string;
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
 * Prefers server hotel.businessDate; falls back to local clock + dayStart.
 */
export function useBusinessDay() {
  const { gate } = useHotelGate();
  if (gate?.businessDate) {
    return {
      businessDate: gate.businessDate,
      dayStart: gate.dayStart || gate.closeTime || "11:00",
    };
  }
  const start = parseDayStart(gate?.dayStart || gate?.closeTime);
  return {
    businessDate: businessDateOf(new Date(), start.h, start.m) || localIsoDay(),
    dayStart: start.label,
  };
}
