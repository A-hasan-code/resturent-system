import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { serverPrint } from "../printing";
import { Modal } from "./Modal";
import { BrandLoader } from "./BrandLoader";

export type KotTarget = {
  orderId: string;
  round?: number;
  /** True for a slip that was already printed once (adds the REPRINT banner). */
  reprint: boolean;
};

type Preview = { orderNo: number; tableNo: string | null; round: number | null; takenBy: string | null; text: string };

/** Shows the kitchen slip exactly as the thermal printer will print it, then lets the user print it or skip. */
export function KotPreviewModal({ target, onClose }: { target: KotTarget | null; onClose: () => void }) {
  const toast = useToast();
  const t = useT();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    if (!target) return;
    const q = target.round ? `?round=${target.round}` : "";
    api<Preview>(`/orders/${target.orderId}/kot-preview${q}`)
      .then(setPreview)
      .catch((e) => {
        toast.push(e instanceof Error ? e.message : t("kot.previewFailed"), "err");
        onClose();
      });
  }, [target, toast, onClose, t]);

  async function print() {
    if (!target) return;
    setBusy(true);
    try {
      await serverPrint("kot", target.orderId, { round: target.round, reprint: target.reprint });
      toast.push(target.reprint ? t("kot.reprinting") : t("kot.sent"), "ok");
      onClose();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const title = preview
    ? `${t("kot.title")} · #${preview.orderNo}${preview.round ? ` · ${t("kot.round", { n: preview.round })}` : ""}`
    : t("kot.title");

  return (
    <Modal open={!!target} title={title} onClose={onClose}>
      {!preview ? (
        <div className="empty">
          <BrandLoader compact label={t("kot.loading")} />
        </div>
      ) : (
        <>
          <pre className="print-preview kot-preview">{preview.text}</pre>
          <div className="row" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void print()}>
              {busy ? t("kot.sending") : target?.reprint ? t("kot.reprint") : t("kot.print")}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
              {target?.reprint ? t("common.close") : t("kot.doneNoPrint")}
            </button>
          </div>
          {!target?.reprint && (
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              {t("kot.alreadyOnScreen")}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
