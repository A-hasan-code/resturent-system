import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useT, type MessageKey } from "../i18n";
import { useToast } from "../toast";
import { SearchField, matchesSearch } from "../components/SearchField";

type Row = {
  id: string;
  name: string;
  category: string;
  unit: string;
  onHand: number;
  rate: number;
  autoQty: number;
  extraQty: number;
  reason: string;
  value: number;
};

type Sheet = {
  businessDate: string;
  dayStart: string;
  saved: boolean;
  sales: number;
  stockUsedValue: number;
  profit: number;
  items: Row[];
};

const REASONS: { value: string; key: MessageKey }[] = [
  { value: "Wastage / spoilage", key: "store.outWastage" },
  { value: "Staff meal", key: "store.outStaff" },
  { value: "Other", key: "store.outOther" },
];

export function StoreDayUse({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const t = useT();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api<Sheet>("/store/day-use");
    setSheet(data);
    const qty: Record<string, string> = {};
    const why: Record<string, string> = {};
    for (const item of data.items) {
      qty[item.id] = item.extraQty ? String(item.extraQty) : "";
      why[item.id] = item.reason || REASONS[0].value;
    }
    setExtra(qty);
    setReason(why);
  }

  useEffect(() => {
    load().catch((e) => toast.push(e instanceof Error ? e.message : t("store.loadFailed"), "err"));
  }, []);

  const shown = useMemo(() => {
    if (!sheet) return [];
    return sheet.items.filter((i) => matchesSearch(q, i.name, i.category, i.unit));
  }, [sheet, q]);

  const preview = useMemo(() => {
    if (!sheet) return { used: 0, profit: 0 };
    const used = sheet.items.reduce((s, i) => {
      const extraQty = Math.max(0, Number(extra[i.id]) || 0);
      return s + (i.autoQty + extraQty) * i.rate;
    }, 0);
    return { used, profit: sheet.sales - used };
  }, [sheet, extra]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!sheet || !canManage) return;
    const lines = sheet.items
      .map((i) => ({
        storeItemId: i.id,
        extraQty: Math.max(0, Number(extra[i.id]) || 0),
        reason: reason[i.id] || REASONS[0].value,
      }))
      .filter((l) => l.extraQty > 0);
    setBusy(true);
    try {
      const data = await api<Sheet>("/store/day-use", {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
      setSheet(data);
      toast.push(t("store.daySaved"), "ok");
      onChanged();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.75rem",
          gap: "1rem",
        }}
      >
        <div style={{ flex: "1 1 16rem", minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{t("store.tabUsed")}</h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {t("store.dayUseHint")}
          </p>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto", marginLeft: "auto" }}>
          <div className="tiny muted">{t("store.dayDate")}</div>
          <strong>{sheet?.businessDate ?? "—"}</strong>
          <div className="tiny muted">
            {t("settings.dayStart")} {sheet?.dayStart ?? ""}
          </div>
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("audit.sales")}</span>
          <strong>{sheet ? money(sheet.sales) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("store.stockUsedToday")}</span>
          <strong>{money(preview.used)}</strong>
        </div>
        <div className="panel stat">
          <span>{t("store.dayProfit")}</span>
          <strong style={{ color: preview.profit >= 0 ? "var(--ok)" : "var(--danger)" }}>{money(preview.profit)}</strong>
        </div>
      </div>

      <div className="row" style={{ marginBottom: "0.7rem" }}>
        <SearchField value={q} onChange={setQ} placeholder={t("store.search")} />
      </div>

      <div className="panel panel-pad">
        <div className="table-wrap">
          <table className="day-use-table">
            <thead>
              <tr>
                <th>{t("common.item")}</th>
                <th>{t("store.onHand")}</th>
                <th>{t("store.billUsed")}</th>
                <th>{t("store.extraUsed")}</th>
                <th>{t("store.reason")}</th>
                <th>{t("common.value")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const extraQty = Math.max(0, Number(extra[i.id]) || 0);
                return (
                  <tr key={i.id}>
                    <td>
                      {i.name}
                      <div className="tiny muted">{i.category}</div>
                    </td>
                    <td className="nowrap">
                      {i.onHand} {unitLabel(i.unit)}
                    </td>
                    <td className="nowrap">
                      {i.autoQty} {unitLabel(i.unit)}
                    </td>
                    <td>
                      <input
                        type="number"
                        className="field-ctrl sm"
                        min={0}
                        step="0.001"
                        value={extra[i.id] ?? ""}
                        disabled={!canManage}
                        onChange={(e) => setExtra((prev) => ({ ...prev, [i.id]: e.target.value }))}
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <select
                        className="field-ctrl wide"
                        value={reason[i.id] || REASONS[0].value}
                        disabled={!canManage || extraQty <= 0}
                        onChange={(e) => setReason((prev) => ({ ...prev, [i.id]: e.target.value }))}
                      >
                        {REASONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {t(r.key)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="nowrap">{money((i.autoQty + extraQty) * i.rate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!shown.length && <div className="empty">{t("store.noItems")}</div>}
      </div>
      {canManage && (
        <div className="form-actions day-use-actions">
          <button className="btn" type="submit" disabled={busy || !sheet}>
            {busy ? t("common.saving") : t("store.saveDayUse")}
          </button>
        </div>
      )}
    </form>
  );
}
