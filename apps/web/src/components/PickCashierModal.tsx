import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "./Modal";

export type CashierOption = { id: string; name: string; roleCode: string; roleName: string };

/** Pick which cashier will take the bill for a new order (supervisor flow). */
export function PickCashierModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (cashierId: string) => void;
}) {
  const toast = useToast();
  const t = useT();
  const [list, setList] = useState<CashierOption[]>([]);
  const [picked, setPicked] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked("");
    setLoading(true);
    api<CashierOption[]>("/payments/cashiers")
      .then((rows) => {
        setList(rows);
        if (rows.length === 1) setPicked(rows[0]!.id);
      })
      .catch((e) => toast.push(e instanceof Error ? e.message : t("cashier.none"), "err"))
      .finally(() => setLoading(false));
  }, [open, toast, t]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) {
      toast.push(t("cashier.pickRequired"), "err");
      return;
    }
    onPick(picked);
  }

  return (
    <Modal open={open} title={t("cashier.title")} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-scroll">
          <p className="muted" style={{ marginTop: 0 }}>
            {t("cashier.hint")}
          </p>
          {loading ? (
            <div className="empty">{t("common.loading")}</div>
          ) : !list.length ? (
            <div className="empty">{t("cashier.none")}</div>
          ) : (
            <div className="staff-grid" style={{ marginTop: "0.5rem" }}>
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`staff-btn ${picked === c.id ? "active" : ""}`}
                  onClick={() => setPicked(c.id)}
                >
                  <strong>{c.name}</strong>
                  <span className="tiny muted">{c.roleName || c.roleCode}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="form-footer">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn" disabled={!picked || loading}>
            {t("cashier.continue")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
