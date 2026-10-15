import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, unitLabel } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { Modal } from "../components/Modal";
import { loadKitchenStations, type KitchenStationRow } from "../kitchenStations";
import { sanitizePlainText, sanitizeQty } from "../inputSanitize";

const PAGE_SIZE = 20;

type StockRow = {
  id: string;
  name: string;
  category: string;
  unit: string;
  storeOnHand: number;
  kitchenOnHand: number;
  ratePerUnit: number;
};

export function KitchenTransfer({
  canManage,
  onChanged,
}: {
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [stations, setStations] = useState<KitchenStationRow[]>([]);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [pickStation, setPickStation] = useState<string | null>(null);
  const [pendingLines, setPendingLines] = useState<{ storeItemId: string; quantity: number }[]>(
    []
  );

  async function loadStations() {
    setStations(await loadKitchenStations());
  }

  async function loadStock() {
    // Store-side view for issuing; kitchen on-hand shown as total across stations if API returns it.
    const list = await api<StockRow[]>("/store/kitchen/stock");
    setRows(list);
  }

  useEffect(() => {
    Promise.all([loadStations(), loadStock()]).catch((e) =>
      toast.push(e instanceof Error ? e.message : t("store.loadFailed"), "err")
    );
  }, []);

  const shown = useMemo(
    () => rows.filter((r) => matchesSearch(q, r.name, r.category, r.unit, unitLabel(r.unit))),
    [rows, q]
  );

  useEffect(() => {
    setPage(1);
  }, [q]);

  const pageRows = paginate(shown, page, PAGE_SIZE);

  const pendingSummary = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return pendingLines.map((l) => {
      const item = byId.get(l.storeItemId);
      return {
        name: item?.name || l.storeItemId,
        unit: item ? unitLabel(item.unit) : "",
        quantity: l.quantity,
      };
    });
  }, [pendingLines, rows]);

  function openAsk(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const lines = rows
      .map((r) => ({
        storeItemId: r.id,
        quantity: Math.max(0, Number(qty[r.id]) || 0),
      }))
      .filter((l) => l.quantity > 0);
    if (!lines.length) {
      toast.push(t("store.transferNeedQty"), "err");
      return;
    }
    setPendingLines(lines);
    setPickStation(null);
    setAskOpen(true);
  }

  async function confirmTransfer() {
    if (!pickStation) {
      toast.push(t("store.pickStationFirst"), "err");
      return;
    }
    setBusy(true);
    try {
      await api("/store/kitchen/transfer", {
        method: "POST",
        body: JSON.stringify({
          station: pickStation,
          lines: pendingLines,
          note: note.trim() || undefined,
        }),
      });
      setQty({});
      setNote("");
      setAskOpen(false);
      setPendingLines([]);
      setPickStation(null);
      await loadStock();
      const name = stations.find((s) => s.code === pickStation)?.name || pickStation;
      toast.push(`${t("store.transferOk")} → ${name}`, "ok");
      onChanged();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={openAsk}>
        <div style={{ marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>{t("store.tabKitchenTransfer")}</h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {t("store.kitchenTransferAskHint")}
          </p>
        </div>

        <div className="row" style={{ marginBottom: "0.7rem", gap: 12, alignItems: "center" }}>
          <SearchField value={q} onChange={setQ} placeholder={t("store.search")} />
          <input
            className="field-ctrl"
            style={{ maxWidth: "16rem" }}
            value={note}
            onChange={(e) => setNote(sanitizePlainText(e.target.value))}
            placeholder={t("store.transferNotePh")}
            disabled={!canManage}
          />
          {canManage && (
            <button className="btn" type="submit" disabled={busy}>
              {t("store.doTransfer")}
            </button>
          )}
        </div>

        <div className="panel panel-pad">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.item")}</th>
                  <th>{t("store.storeOnHand")}</th>
                  <th>{t("store.kitchenOnHand")}</th>
                  <th>{t("store.transferQty")}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      <div className="tiny muted">{r.category}</div>
                    </td>
                    <td className="nowrap">
                      {r.storeOnHand} {unitLabel(r.unit)}
                    </td>
                    <td className="nowrap">
                      {r.kitchenOnHand} {unitLabel(r.unit)}
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="field-ctrl sm"
                        value={qty[r.id] ?? ""}
                        disabled={!canManage || r.storeOnHand <= 0}
                        onChange={(e) =>
                          setQty((prev) => ({ ...prev, [r.id]: sanitizeQty(e.target.value) }))
                        }
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={shown.length} onChange={setPage} />
          {!shown.length && <div className="empty">{t("store.noItems")}</div>}
        </div>
      </form>

      <Modal
        open={askOpen}
        title={t("store.askStationTitle")}
        onClose={() => !busy && setAskOpen(false)}
        size="sm"
        dismissible={!busy}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          {t("store.askStationBody")}
        </p>
        {pendingSummary.length > 0 && (
          <div className="tiny muted" style={{ marginBottom: "0.75rem" }}>
            {pendingSummary.slice(0, 6).map((l) => (
              <div key={l.name}>
                {l.name}: {l.quantity} {l.unit}
              </div>
            ))}
            {pendingSummary.length > 6 ? (
              <div>+{pendingSummary.length - 6} more…</div>
            ) : null}
          </div>
        )}
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: "1rem" }}>
          {stations.map((s) => (
            <button
              key={s.code}
              type="button"
              className={`chip ${pickStation === s.code ? "active" : ""}`}
              onClick={() => setPickStation(s.code)}
              disabled={busy}
            >
              {s.name}
            </button>
          ))}
        </div>
        {!pickStation && (
          <p className="tiny" style={{ color: "var(--danger)", marginTop: 0 }}>
            {t("store.pickStationFirst")}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setAskOpen(false)}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !pickStation}
            onClick={() => void confirmTransfer()}
          >
            {busy ? t("common.saving") : t("store.confirmTransfer")}
          </button>
        </div>
      </Modal>
    </>
  );
}
