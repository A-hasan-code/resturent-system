import { FormEvent, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "./Modal";

type Tab = "password" | "pin";

export function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const t = useT();
  const [tab, setTab] = useState<Tab>("password");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  function close() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setPin("");
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (tab === "password" && next !== confirm) {
      toast.push(t("account.passwordMismatch"), "err");
      return;
    }
    setBusy(true);
    try {
      if (tab === "password") {
        await api("/auth/password", {
          method: "POST",
          body: JSON.stringify({ currentPassword: current, newPassword: next }),
        });
        toast.push(t("account.passwordChanged"), "ok");
      } else {
        await api("/auth/my-pin", { method: "POST", body: JSON.stringify({ currentPassword: current, pin }) });
        toast.push(t("account.pinSaved"), "ok");
      }
      close();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("account.saveFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={t("account.title")} onClose={close}>
      <div className="login-tabs" role="tablist">
        <button type="button" className={tab === "password" ? "active" : ""} onClick={() => setTab("password")}>
          {t("account.changePassword")}
        </button>
        <button type="button" className={tab === "pin" ? "active" : ""} onClick={() => setTab("pin")}>
          {t("account.setPin")}
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="field">
          <label>{t("account.currentPassword")}</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {tab === "password" ? (
          <>
            <div className="field">
              <label>{t("account.newPassword")}</label>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                placeholder={t("account.passwordHint")}
              />
            </div>
            <div className="field">
              <label>{t("account.repeatPassword")}</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
          </>
        ) : (
          <div className="field">
            <label>{t("account.newPin")}</label>
            <input
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              pattern="\d{4,6}"
              placeholder={t("account.pinHint")}
              autoComplete="off"
              required
            />
            <p className="tiny muted">{t("account.pinHelp")}</p>
          </div>
        )}
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
          <button className="btn ghost" type="button" onClick={close}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
