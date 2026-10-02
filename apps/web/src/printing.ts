import { useCallback, useState } from "react";
import { api, type User } from "./api";

type PrintResult = { queued: number; jobs: { id: string; status: string; error: string | null }[] };

type KotPrintOptions = { round?: number; reprint?: boolean };

/** Asks the server to print; the slip comes out of the printer attached to the server/LAN. */
export async function serverPrint(kind: "kot" | "bill", orderId: string, opts: KotPrintOptions = {}) {
  const res = await api<PrintResult>(`/orders/${orderId}/print-${kind}`, {
    method: "POST",
    body: JSON.stringify(kind === "kot" ? opts : {}),
  });
  const failed = res.jobs.find((j) => j.status === "FAILED");
  if (failed) throw new Error(failed.error || "Print failed");
  return res;
}

/**
 * Per-user, per-device choice: show the kitchen slip on screen before it is printed.
 * Waiters print straight away by default; managers and cashiers preview first.
 */
export function useKotPreviewPref(user: User | null) {
  const key = `kotPreview:${user?.id ?? ""}`;
  const [on, setOn] = useState(() => {
    const saved = localStorage.getItem(key);
    return saved == null ? !!user && user.roleCode !== "WAITER" : saved === "1";
  });
  const set = useCallback(
    (v: boolean) => {
      localStorage.setItem(key, v ? "1" : "0");
      setOn(v);
    },
    [key]
  );
  return [on, set] as const;
}

let audioCtx: AudioContext | null = null;

/** Short double beep + vibration for "order ready" style alerts. */
export function alertBeep() {
  try {
    navigator.vibrate?.([200, 100, 200]);
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    [0, 0.25].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.15);
    });
  } catch {
    /* audio not allowed until first tap */
  }
}
