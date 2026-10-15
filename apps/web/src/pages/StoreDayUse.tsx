import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useI18n, useT, type MessageKey } from "../i18n";
import { useToast } from "../toast";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { DateField } from "../components/DateField";
import { useShiftOpen } from "../hotel-gate";
import { printCountSheet } from "./closing-print";
import { sanitizeQty } from "../inputSanitize";

const PAGE_SIZE = 15;

type Row = {
  id: string;
  name: string;
  category: string;
  unit: string;
  onHand: number;
  rate: number;
  autoQty: number;
  transferredQty?: number;
  extraQty: number;
  usedQty?: number;
  leftoverQty?: number;
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
  const shiftOpen = useShiftOpen();

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [date, setDate] = useState("");
  const [viewDate, setViewDate] = useState<string | null>(null);
  const [used, setUsed] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [leftover, setLeftover] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [itemsPage, setItemsPage] = useState(1);

  function applySheet(data: Sheet) {
    setSheet(data);
    setDate(data.businessDate);
    const usedQty: Record<string, string> = {};
    const extraQty: Record<string, string> = {};
    const leftQty: Record<string, string> = {};
    const why: Record<string, string> = {};
    for (const item of data.items) {
      const u = item.usedQty ?? 0;
      const e = item.extraQty ?? 0;
      const left = item.leftoverQty ?? item.onHand;
      usedQty[item.id] = u ? String(u) : "";
      extraQty[item.id] = e ? String(e) : "";
      leftQty[item.id] = left || left === 0 ? String(left) : "";
      why[item.id] = item.reason || REASONS[0].value;
    }
    setUsed(usedQty);
    setExtra(extraQty);
    setLeftover(leftQty);
    setReason(why);
    setEditing(false);
  }

  async function loadHistory() {
    const list = await api<HistoryRow[]>("/store/day-use/history?limit=90");
    setHistory(list);
  }

  async function load(nextDate?: string | null) {
    const path = nextDate ? `/store/day-use?date=${nextDate}` : "/store/day-use";
    const data = await api<Sheet>(path);
    applySheet(data);
    setViewDate(nextDate && nextDate !== data.today ? nextDate : null);
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

  useEffect(() => {
    setHistoryPage(1);
  }, [viewDate, sheet?.businessDate]);

  useEffect(() => {
    setItemsPage(1);
  }, [q, viewDate, sheet?.businessDate]);

  const pageHistory = paginate(history, historyPage, PAGE_SIZE);
  const pageShown = paginate(shown, itemsPage, PAGE_SIZE);

  const preview = useMemo(() => {
    if (!sheet) return { used: 0, profit: 0 };
    const usedVal = sheet.items.reduce((s, i) => {
      const usedQty = Math.max(0, Number(used[i.id]) || 0);
      const extraQty = Math.max(0, Number(extra[i.id]) || 0);
      const transferred = i.transferredQty ?? i.autoQty;
      return s + (transferred + usedQty + extraQty) * i.rate;
    }, 0);
    return { used: usedVal, profit: sheet.sales - usedVal };
  }, [sheet, used, extra]);

  const isToday = sheet?.isToday !== false;
  // API sets canEdit for today (managers) or any day (admin). Admin may edit past even after shift end.
  const canStartEdit = !!sheet?.canEdit && (isAdmin || ((canManage || isAdmin) && shiftOpen));
  const editable = canStartEdit && editing;

  async function openDate(next: string) {
    try {
      setDate(next);
      await load(next);
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
    if (!sheet || !editable) return;
    const lines = sheet.items
      .map((i) => ({
        storeItemId: i.id,
        usedQty: Math.max(0, Number(used[i.id]) || 0),
        extraQty: Math.max(0, Number(extra[i.id]) || 0),
        leftoverQty: Math.max(0, Number(leftover[i.id]) || 0),
        reason: reason[i.id] || REASONS[0].value,
      }))
      .filter(
        (l) =>
          l.usedQty > 0 ||
          l.extraQty > 0 ||
          l.leftoverQty > 0 ||
          (sheet.items.find((i) => i.id === l.storeItemId)?.transferredQty ?? 0) !== 0 ||
          (sheet.items.find((i) => i.id === l.storeItemId)?.onHand ?? 0) !== 0
      );
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
      {!shiftOpen && <p className="muted tiny">{t("hotel.shiftEnded")}</p>}
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
          <h2 style={{ margin: 0 }}>{t("store.tabStoreClose")}</h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {t("store.storeCloseHint")}
          </p>
          <button
            type="button"
            className="btn ghost sm"
            style={{ marginTop: 8 }}
            disabled={!sheet}
            onClick={() => {
              if (!sheet) return;
              const ok = printCountSheet({
                title: t("store.tabStoreClose"),
                subtitle: t("store.countSheetHint"),
                dateLabel: `${t("store.dayDate")}: ${sheet.businessDate}`,
                columns: [
                  { key: "onHand", label: t("store.onHand") },
                  { key: "transferred", label: t("store.transferredToKitchen") },
                  { key: "remaining", label: t("store.countRemaining") },
                ],
                blankCols: ["remaining"],
                rows: sheet.items
                  .filter((i) => i.onHand > 0 || (i.transferredQty ?? i.autoQty) !== 0 || i.extraQty > 0)
                  .map((i) => ({
                    name: i.name,
                    category: i.category,
                    unit: unitLabel(i.unit),
                    values: {
                      onHand: i.onHand,
                      transferred: i.transferredQty ?? i.autoQty,
                    },
                  })),
              });
              if (!ok) toast.push(t("store.printBlocked"), "err");
            }}
          >
            {t("store.printCountSheet")}
          </button>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto", marginLeft: "auto" }}>
          <div className="field" style={{ margin: 0, textAlign: "left" }}>
            <label htmlFor="store-close-date" className="tiny muted">
              {t("store.dayDate")}
            </label>
            <div className="row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
              <DateField
                id="store-close-date"
                value={date || sheet?.businessDate || ""}
                max={sheet?.today}
                onChange={(v) => {
                  setDate(v);
                  setEditing(false);
                  void openDate(v);
                }}
              />
              {viewDate && (
                <button type="button" className="btn ok sm" onClick={() => void backToToday()}>
                  {t("store.backToToday")}
                </button>
              )}
            </div>
          </div>
          {isToday ? (
            <div className="tiny" style={{ color: "var(--ok)", marginTop: 2 }}>
              {t("store.todayBadge")}
            </div>
          ) : canStartEdit ? (
            <div className="tiny" style={{ color: "var(--warn, #b08900)", marginTop: 2 }}>
              {t("store.adminPastEditBadge")}
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
          <>
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
              {pageHistory.map((h) => {
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
          <Pagination
            page={historyPage}
            pageSize={PAGE_SIZE}
            total={history.length}
            onChange={setHistoryPage}
          />
          </>
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
          <span>{t("store.issuedToKitchen")}</span>
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
            {canStartEdit ? t("store.dayPastAdminEdit") : t("store.dayPastReadOnly")}
          </p>
          <div className="row" style={{ gap: 8 }}>
            {canStartEdit && !editing && (
              <button type="button" className="btn sm" onClick={startEdit}>
                {t("store.editClosing")}
              </button>
            )}
            <button type="button" className="btn ok sm" onClick={() => void backToToday()}>
              {t("store.backToToday")}
            </button>
          </div>
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
                <th>{t("store.transferredToKitchen")}</th>
                <th>{t("store.manualUsed")}</th>
                <th>{t("store.extraUsed")}</th>
                <th>{t("store.leftover")}</th>
                <th>{t("store.reason")}</th>
                <th>{t("common.value")}</th>
              </tr>
            </thead>
            <tbody>
              {pageShown.map((i) => {
                const usedQty = Math.max(0, Number(used[i.id]) || 0);
                const extraQty = Math.max(0, Number(extra[i.id]) || 0);
                const leftQty = Math.max(0, Number(leftover[i.id]) || 0);
                const transferred = i.transferredQty ?? i.autoQty;
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
                      {transferred} {unitLabel(i.unit)}
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="field-ctrl sm"
                        value={used[i.id] ?? ""}
                        disabled={!editable}
                        onChange={(e) =>
                          setUsed((prev) => ({ ...prev, [i.id]: sanitizeQty(e.target.value) }))
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="field-ctrl sm"
                        value={extra[i.id] ?? ""}
                        disabled={!editable}
                        onChange={(e) =>
                          setExtra((prev) => ({ ...prev, [i.id]: sanitizeQty(e.target.value) }))
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="field-ctrl sm"
                        value={leftover[i.id] ?? ""}
                        disabled={!editable}
                        onChange={(e) =>
                          setLeftover((prev) => ({
                            ...prev,
                            [i.id]: sanitizeQty(e.target.value),
                          }))
                        }
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <select
                        className="field-ctrl wide"
                        value={reason[i.id] || REASONS[0].value}
                        disabled={!editable || (usedQty <= 0 && extraQty <= 0 && leftQty <= 0)}
                        onChange={(e) => setReason((prev) => ({ ...prev, [i.id]: e.target.value }))}
                      >
                        {REASONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {t(r.key)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="nowrap">{money((transferred + usedQty + extraQty) * i.rate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={itemsPage} pageSize={PAGE_SIZE} total={shown.length} onChange={setItemsPage} />
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
