import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "./Modal";

/** Ask for the server's name (free text) before the kitchen slip is printed.
 *  Order-taker is always the signed-in user and is shown for clarity. */
export function PickServerModal({
  open,
  initialName,
  orderTakenBy,
  onClose,
  onPick,
}: {
  open: boolean;
  /** Pre-fill if the order already has a server name. */
  initialName?: string | null;
  /** Who took / is taking the order (shown as record, not editable). */
  orderTakenBy?: string | null;
  onClose: () => void;
  onPick: (name: string) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const t = useT();
  const [name, setName] = useState("");
  const takenBy = (orderTakenBy || user?.name || "").trim();

  useEffect(() => {
    if (!open) return;
    setName((initialName || "").trim());
  }, [open, initialName]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      toast.push(t("serve.pickRequired"), "err");
      return;
    }
    onPick(n);
  }

  return (
    <Modal open={open} title={t("serve.title")} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("serve.hint")}
        </p>

        {takenBy && (
          <div className="pay-summary" style={{ marginBottom: "0.75rem" }}>
            <span>{t("serve.orderTakenBy")}</span>
            <strong>{takenBy}</strong>
          </div>
        )}

        <div className="field">
          <label htmlFor="serve-name">{t("serve.name")}</label>
          <input
            id="serve-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("serve.namePh")}
            autoFocus
            autoComplete="off"
            maxLength={80}
            required
          />
        </div>
        <div className="form-footer">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn" disabled={!name.trim()}>
            {t("serve.continue")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
