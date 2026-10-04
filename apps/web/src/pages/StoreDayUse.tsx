import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useI18n, useT, type MessageKey } from "../i18n";
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
  today: string;
  isToday: boolean;
  dayStart: string;
  saved: boolean;
  canEdit: boolean;
  closedByName: string | null;
  closedAt: string | null;
  editedAt: string | null;
  editedByName: string | null;
  sales: number;
  stockUsedValue: number;
  profit: number;
  items: Row[];
};

type HistoryRow = {
  id: string;
  businessDate: string;
  stockUsedValue: number;
  sales: number;
  profit: number;
  closedByName: string | null;
  closedAt: string;
  editedAt: string | null;
  editedByName: string | null;
  lineCount: number;
};

const REASONS: { value: string; key: MessageKey }[] = [
  { value: "Wastage / spoilage", key: "store.outWastage" },
  { value: "Staff meal", key: "store.outStaff" },
  { value: "Other", key: "store.outOther" },
];

export function StoreDayUse({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const t = useT();
  const { ts } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.roleCode === "ADMIN";

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [viewDate, setViewDate] = useState<string | null>(null);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  function applySheet(data: Sheet) {
    setSheet(data);
    const qty: Record<string, string> = {};
    const why: Record<string, string> = {};
    for (const item of data.items) {
      qty[item.id] = item.extraQty ? String(item.extraQty) : "";
      why[item.id] = item.reason || REASONS[0].value;
    }
    setExtra(qty);
    setReason(why);
    setEditing(false);
  }

  async function loadHistory() {
    const list = await api<HistoryRow[]>("/store/day-use/history?limit=90");
    setHistory(list);
  }

  async function load(date?: string | null) {
    const path = date ? `/store/day-use?date=${date}` : "/store/day-use";
    const data = await api<Sheet>(path);
    applySheet(data);
    setViewDate(date && date !== data.today ? date : null);
  }

  function startEdit() {
    if (!sheet?.canEdit || !(canManage || isAdmin)) return;
    setEditing(true);
  }

  function cancelEdit() {
    if (!sheet) return;
    applySheet(sheet);
  }

  useEffect(() => {
    Promise.all([load(null), loadHistory()]).catch((e) =>
      toast.push(e instanceof Error ? e.message : t("store.loadFailed"), "err")
    );
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

  const isToday = sheet?.isToday !== false;
  const canStartEdit = !!sheet?.canEdit && (canManage || isAdmin);
  const editable = canStartEdit && editing;

  async function openDate(date: string) {
    try {
      await load(date);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.failed"), "err");
    }
  }

  async function backToToday() {
    try {
      await load(null);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.failed"), "err");
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!sheet || !editable || !isToday) return;
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
        body: JSON.stringify({
          businessDate: sheet.businessDate,
          lines,
        }),
      });
      applySheet(data);
      await loadHistory();
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
          {isToday ? (
            <div className="tiny" style={{ color: "var(--ok)", marginTop: 2 }}>
              {t("store.todayBadge")}
            </div>
          ) : (
            <div className="tiny muted" style={{ marginTop: 2 }}>
              {t("store.viewOnlyBadge")}
            </div>
          )}
          <div className="tiny muted">
            {t("settings.dayStart")} {sheet?.dayStart ?? ""}
          </div>
          {sheet?.saved && (
            <div className="tiny muted">
              {t("store.closedBy")}: {sheet.closedByName || "—"}
              {sheet.closedAt ? ` · ${ts(sheet.closedAt)}` : ""}
            </div>
          )}
          {sheet?.editedAt && (
            <div className="tiny muted">
              {t("store.editedBy")}: {sheet.editedByName || "—"} · {ts(sheet.editedAt)}
            </div>
          )}
        </div>
      </div>

      <div className="panel panel-pad" style={{ marginBottom: "0.85rem" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <strong>{t("store.dayHistory")}</strong>
            <div className="tiny muted">{t("store.dayHistoryHint")}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {viewDate && (
              <button type="button" className="btn ok sm" onClick={() => void backToToday()}>
                {t("store.backToToday")}
              </button>
            )}
            {canStartEdit && !editing && (
              <button type="button" className="btn sm" onClick={startEdit}>
                {sheet?.saved ? t("store.editClosing") : t("store.enterClosing")}
              </button>
            )}
          </div>
        </div>
        {history.length ? (
          <table style={{ marginTop: "0.6rem" }}>
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("store.closedBy")}</th>
                <th>{t("audit.sales")}</th>
                <th>{t("store.stockUsedToday")}</th>
                <th>{t("store.dayProfit")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const active = (viewDate || sheet?.businessDate) === h.businessDate;
                const todayRow = h.businessDate === sheet?.today;
                return (
                  <tr key={h.id} className={active ? "row-active" : undefined}>
                    <td>
                      <strong>{h.businessDate}</strong>
                      {todayRow && (
                        <div className="tiny" style={{ color: "var(--ok)" }}>
                          {t("store.todayBadge")}
                        </div>
                      )}
                    </td>
                    <td>
                      {h.closedByName || "—"}
                      <div className="tiny muted">{ts(h.closedAt)}</div>
                    </td>
                    <td>{money(h.sales)}</td>
                    <td>{money(h.stockUsedValue)}</td>
                    <td style={{ color: h.profit >= 0 ? "var(--ok)" : "var(--danger)" }}>
                      {money(h.profit)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`btn sm ${active ? "ok" : "ghost"}`}
                        onClick={() => void openDate(h.businessDate)}
                      >
                        {todayRow ? t("store.openToday") : t("store.viewReport")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: "0.75rem 0 0" }}>
            {t("store.dayHistoryEmpty")}
          </p>
        )}
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
          <strong style={{ color: preview.profit >= 0 ? "var(--ok)" : "var(--danger)" }}>
            {money(preview.profit)}
          </strong>
        </div>
      </div>

      {!isToday && (
        <div
          className="panel panel-pad"
          style={{
            marginBottom: "0.75rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--warn, #b08900) 8%, transparent)",
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            {t("store.dayPastReadOnly")}
          </p>
          <button type="button" className="btn ok sm" onClick={() => void backToToday()}>
            {t("store.backToToday")}
          </button>
        </div>
      )}

      {isToday && canStartEdit && !editing && (
        <div
          className="panel panel-pad"
          style={{
            marginBottom: "0.75rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            {sheet?.saved ? t("store.todaySavedHint") : t("store.todayEnterHint")}
          </p>
          <button type="button" className="btn" onClick={startEdit}>
            {sheet?.saved ? t("store.editClosing") : t("store.enterClosing")}
          </button>
        </div>
      )}

      <div className="row" style={{ marginBottom: "0.7rem", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
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
                        disabled={!editable}
                        onChange={(e) => setExtra((prev) => ({ ...prev, [i.id]: e.target.value }))}
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <select
                        className="field-ctrl wide"
                        value={reason[i.id] || REASONS[0].value}
                        disabled={!editable || extraQty <= 0}
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

        {editable && (
          <div className="form-actions day-use-actions">
            <button type="button" className="btn ghost" disabled={busy} onClick={cancelEdit}>
              {t("common.cancel")}
            </button>
            <button className="btn" type="submit" disabled={busy || !sheet}>
              {busy ? t("common.saving") : sheet?.saved ? t("store.updateClosing") : t("store.saveDayUse")}
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
