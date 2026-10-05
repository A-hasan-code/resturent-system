import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { serverPrint } from "../printing";
import { Modal } from "./Modal";
import { BrandLoader } from "./BrandLoader";
import { BillPreview, type BillOrder } from "./BillPreview";

export type KotTarget = {
  orderId: string;
  round?: number;
  /** True for a slip that was already printed once (adds the REPRINT banner). */
  reprint: boolean;
};

type KotPreview = {
  orderNo: number;
  billNo?: number;
  tableNo: string | null;
  partitionName?: string | null;
  tableName?: string | null;
  round: number | null;
  reprint?: boolean;
  station?: string | null;
  takenBy: string | null;
  servedBy?: string | null;
  time?: string;
  notes?: string | null;
  showOrderBy?: boolean;
  paperWidth?: number;
  items?: Array<{
    name: string;
    quantity: number;
    sellUnit: string;
    notes?: string | null;
    round?: number;
  }> | null;
  text: string;
};

/** Shows the kitchen slip in the same receipt design as print, then lets the user print or skip. */
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

  const order: BillOrder | null = preview
    ? {
        orderNo: preview.orderNo,
        billNo: preview.billNo ?? preview.orderNo,
        tableNo: preview.tableNo,
        tableName: preview.tableName,
        partitionName: preview.partitionName,
        paymentStatus: "UNPAID",
        total: 0,
        tipAmount: 0,
        paidAmount: 0,
        createdAt: preview.time,
        waiter: preview.takenBy,
        orderedBy: preview.takenBy
          ? { name: preview.takenBy.replace(/\s*\(.*\)$/, ""), roleName: preview.takenBy.match(/\(([^)]+)\)/)?.[1] || "" }
          : null,
        servedByName: preview.servedBy,
        items: (preview.items ?? []).map((i) => ({
          name: i.name,
          quantity: i.quantity,
          sellUnit: i.sellUnit,
          ratePerUnit: 0,
          amount: 0,
          notes: i.notes,
        })),
      }
    : null;

  const paperWidth = (preview?.paperWidth === 58 || preview?.paperWidth === 72 || preview?.paperWidth === 112
    ? preview.paperWidth
    : 80) as 58 | 72 | 80 | 112;

  return (
    <Modal open={!!target} title={title} onClose={onClose}>
      {!preview || !order ? (
        <div className="modal-scroll">
          <div className="empty">
            <BrandLoader compact label={t("kot.loading")} />
          </div>
        </div>
      ) : (
        <>
          <div className="modal-scroll">
            <BillPreview
              order={order}
              mode="kitchen"
              paperWidth={paperWidth}
              designOverride={{ showOrderBy: preview.showOrderBy !== false }}
              kotMeta={{
                round: preview.round,
                reprint: !!(target?.reprint || preview.reprint),
                station: preview.station,
                notes: preview.notes,
              }}
            />
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
