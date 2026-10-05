import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { serverPrint } from "../printing";
import { Modal } from "./Modal";
import { BrandLoader } from "./BrandLoader";
import { ThermalPreview } from "./ThermalPreview";

export type KotTarget = {
  orderId: string;
  round?: number;
  /** True for a slip that was already printed once (adds the REPRINT banner). */
  reprint: boolean;
};

type KotPreview = {
  orderNo: number;
  round: number | null;
  text: string;
  paperWidth?: number;
  logoUrl?: string | null;
};

/** Shows the kitchen slip exactly as the thermal printer will print it. */
export function KotPreviewModal({ target, onClose }: { target: KotTarget | null; onClose: () => void }) {
  const toast = useToast();
  const t = useT();
  const [preview, setPreview] = useState<KotPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    if (!target) return;
    const q = target.round ? `?round=${target.round}` : "";
    api<KotPreview>(`/orders/${target.orderId}/kot-preview${q}`)
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
      {!preview?.text ? (
        <div className="modal-scroll">
          <div className="empty">
            <BrandLoader compact label={t("kot.loading")} />
          </div>
        </div>
      ) : (
        <>
          <div className="modal-scroll">
            <ThermalPreview text={preview.text} paperWidth={preview.paperWidth} logoUrl={preview.logoUrl} />
            {!target?.reprint && (
              <p className="tiny muted" style={{ marginBottom: 0, marginTop: "0.75rem" }}>
                {t("kot.alreadyOnScreen")}
              </p>
            )}
          </div>
          <div className="form-footer">
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
              {target?.reprint ? t("common.close") : t("kot.doneNoPrint")}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void print()}>
              {busy ? t("kot.sending") : target?.reprint ? t("kot.reprint") : t("kot.print")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
