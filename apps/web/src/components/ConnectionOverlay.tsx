import { FormEvent, useEffect, useState } from "react";
import { useT } from "../i18n";
import { acquireScrollLock, releaseScrollLock } from "../scroll-lock";
import { BrandLoader } from "./BrandLoader";
import {
  connectManually,
  connStatus,
  offlineForMs,
  offlineSessionLimitMs,
  onConnStatus,
  reportLost,
  scanProgress,
  type ConnStatus,
} from "../server";

export function ConnectionOverlay() {
  const t = useT();
  const [status, setStatus] = useState<ConnStatus>(connStatus());
  const [detail, setDetail] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offlineSec, setOfflineSec] = useState(0);

  useEffect(() => {
    const off = onConnStatus(setStatus);
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (status === "ok") return;
    const timer = setInterval(() => {
      setDetail(scanProgress());
      const ms = offlineForMs();
      setOfflineSec(ms == null ? 0 : Math.floor(ms / 1000));
    }, 400);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status === "ok") return;
    acquireScrollLock();
    return () => releaseScrollLock();
  }, [status]);

  if (status === "ok") return null;

  async function onManual(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const ok = await connectManually(address);
    setBusy(false);
    if (!ok) setError(t("conn.notFound"));
  }

  return (
    <div className="conn-overlay" role="alertdialog" aria-live="assertive">
      <div className="conn-card">
        <BrandLoader label={status === "searching" ? t("conn.searchingTitle") : t("conn.lostTitle")} />
        <p className="muted" style={{ marginTop: "0.85rem" }}>
          {status === "searching" ? t("conn.searchingBody") : t("conn.lostBody")}
        </p>
        {detail && <p className="tiny muted">{detail}</p>}
        {offlineSec > 0 ? (
          <p className="tiny muted">
            {t("conn.offlineReloginHint", {
              m: Math.max(1, Math.ceil((offlineSessionLimitMs() - offlineSec * 1000) / 60000)),
            })}
          </p>
        ) : null}
        <div className="row" style={{ justifyContent: "center", marginTop: "0.75rem" }}>
          <button type="button" className="btn ghost sm" onClick={() => void reportLost()}>
            {t("conn.retryNow")}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setShowManual((v) => !v)}>
            {t("conn.enterAddress")}
          </button>
        </div>
        {showManual && (
          <form onSubmit={onManual} className="conn-manual">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t("conn.addressPh")}
              autoFocus
            />
            <button className="btn sm" type="submit" disabled={busy || !address.trim()}>
              {busy ? t("conn.checking") : t("conn.connect")}
            </button>
            {error && (
              <p className="tiny" style={{ color: "var(--danger)", width: "100%" }}>
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
