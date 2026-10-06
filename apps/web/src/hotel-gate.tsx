import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useSocketEvent } from "./socket";

export type HotelStatus = {
  /** Server time from Settings. Only admin saves it. */
  closeTime: string;
  manuallyClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  openedAt: string | null;
  openedBy: string | null;
  acceptingOrders: boolean;
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
