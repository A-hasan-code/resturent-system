import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useConfirm } from "./ConfirmModal";
import { useHotelGate, type HotelStatus } from "../hotel-gate";
import { useT } from "../i18n";
import { useToast } from "../toast";

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function HotelGatePanel() {
  const { user } = useAuth();
  const { gate, reload } = useHotelGate();
  const t = useT();
  const toast = useToast();
  const ask = useConfirm();
  const canManage = user?.roleCode === "ADMIN" || user?.roleCode === "SYSTEM_MANAGER";
  const [busy, setBusy] = useState(false);

  if (!canManage) return null;

  async function closeHotel() {
    const ok = await ask({
      title: t("hotel.closeTitle"),
      body: t("hotel.closeBody"),
      confirmLabel: t("hotel.closeBtn"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api("/system/hotel/close", { method: "POST", body: "{}" });
      toast.push(t("hotel.closedNow"), "ok");
      await reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("hotel.actionFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function openHotel() {
    const ok = await ask({
      title: t("hotel.openTitle"),
      body: t("hotel.openBody"),
      confirmLabel: t("hotel.openBtn"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api<HotelStatus>("/system/hotel/open", { method: "POST", body: "{}" });
      toast.push(t("hotel.openedNow"), "ok");
      await reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("hotel.actionFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const closed = !!gate?.manuallyClosed;
  const status = !gate ? "…" : closed ? t("hotel.statusClosed") : t("hotel.statusOpen");

  return (
    <section className={`hotel-bar${closed ? " is-closed" : " is-open"}`}>
      <div className="hotel-bar-copy">
        <div className="hotel-bar-title">
          <span className="hotel-dot" aria-hidden="true" />
          <span>{status}</span>
          <span className="hotel-bar-time">
            {t("hotel.closeTime")} <strong>{gate?.closeTime || "—"}</strong>
          </span>
        </div>
        {(gate?.closedBy || (gate && !closed && gate.openedBy)) && (
          <p className="hotel-bar-meta">
            {gate.closedBy && (
              <span>
                {t("hotel.closedBy", { name: gate.closedBy })}
                {gate.closedAt ? ` · ${clock(gate.closedAt)}` : ""}
              </span>
            )}
            {!closed && gate.openedBy && (
              <span>
                {t("hotel.openedBy", { name: gate.openedBy })}
                {gate.openedAt ? ` · ${clock(gate.openedAt)}` : ""}
              </span>
            )}
          </p>
        )}
      </div>
      {closed ? (
        <button type="button" className="btn ok" disabled={busy || !gate} onClick={() => void openHotel()}>
          {t("hotel.openBtn")}
        </button>
      ) : (
        <button type="button" className="btn danger" disabled={busy || !gate} onClick={() => void closeHotel()}>
          {t("hotel.closeBtn")}
        </button>
      )}
    </section>
  );
}
