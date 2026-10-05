import { FormEvent, useEffect, useState } from "react";
import { useT } from "../i18n";
import { acquireScrollLock, releaseScrollLock } from "../scroll-lock";
import { BrandLoader } from "./BrandLoader";
import { connectManually, connStatus, onConnStatus, reportLost, scanProgress, type ConnStatus } from "../server";

export function ConnectionOverlay() {
  const t = useT();
  const [status, setStatus] = useState<ConnStatus>(connStatus());
  const [detail, setDetail] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const off = onConnStatus(setStatus);
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (status === "ok") return;
    const timer = setInterval(() => setDetail(scanProgress()), 400);
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
