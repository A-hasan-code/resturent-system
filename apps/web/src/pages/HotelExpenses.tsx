import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, money } from "../api";
import { useAuth } from "../auth";
import { Modal } from "../components/Modal";
import { useConfirm } from "../components/ConfirmModal";
import { DateField } from "../components/DateField";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { downloadExcelCsv } from "../csv";
import { useT } from "../i18n";
import { useToast } from "../toast";

type Period = "DAILY" | "MONTHLY";
type Source = "MANUAL" | "PURCHASE" | "SUPPLIER_PAYMENT" | "PURCHASE_EXTRA" | "UNPAID_SUPPLIER";
type PayStatus = "PAID" | "PARTIAL" | "UNPAID";
type RangeMode = "daily" | "monthly" | "yearly";

type ExpenseRow = {
  id: string;
  source: Source;
  spentOn: string;
  category: string | null;
  title: string;
  amount: number;
  inTotal: boolean;
  payStatus: PayStatus | null;
  period: Period | "DAILY";
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  editable: boolean;
};

type CatRow = { id: string; name: string };

type Result = {
  from: string;
  to: string;
  rows: ExpenseRow[];
  summary: {
    count: number;
    total: number;
    manualExpenses: number;
    supplierPaid: number;
    selfExtra: number;
    inventoryPurchased: number;
    unpaidSupplierBills: number;
    sales: number;
    netProfit: number;
    byCategory: { name: string; amount: number }[];
  };
  categories: CatRow[];
};

const PAGE_SIZE = 20;

function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthRange(d = new Date()) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = new Date(y, m + 1, 0);
  return { from, to: isoDay(last) };
}

function yearRange(d = new Date()) {
  const y = d.getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

function sourceLabel(source: Source, t: (k: any) => string) {
  if (source === "UNPAID_SUPPLIER") return t("expense.srcUnpaid");
  if (source === "PURCHASE") return t("expense.srcPurchase");
  if (source === "SUPPLIER_PAYMENT") return t("expense.srcPayment");
  if (source === "PURCHASE_EXTRA") return t("expense.srcExtra");
  return t("expense.srcManual");
}

function badgeKind(r: ExpenseRow) {
  if (r.source === "UNPAID_SUPPLIER" || r.payStatus === "UNPAID") return "unpaid";
  if (r.payStatus === "PARTIAL") return "pending";
  if (r.source === "SUPPLIER_PAYMENT" || r.source === "PURCHASE_EXTRA" || r.payStatus === "PAID") return "paid";
  return "ready";
}

function categoryLabel(name: string | null | undefined, t: (k: any) => string) {
  const key = (name ?? "").trim().toLowerCase();
  if (key === "unpaid supplier bill") return t("expense.catUnpaid");
  if (key === "supplier payment") return t("expense.catPayment");
  if (key === "purchase extra") return t("expense.catExtra");
  return name || "";
}

function displayTitle(r: ExpenseRow, t: (k: any) => string) {
  const split = r.title.indexOf(" · ");
  const name = split >= 0 ? r.title.slice(split + 3) : "";
  if (r.source === "UNPAID_SUPPLIER") return name ? `${t("expense.srcUnpaid")} · ${name}` : t("expense.srcUnpaid");
  if (r.source === "SUPPLIER_PAYMENT") {
    const prefix = r.title.startsWith("Paid with purchase")
      ? t("expense.titlePaidWithPurchase")
      : t("expense.titleSupplierPayment");
    return name ? `${prefix} · ${name}` : prefix;
  }
  if (r.source === "PURCHASE_EXTRA") return name ? `${t("expense.titleExtra")} · ${name}` : t("expense.titleExtra");
  return r.title;
}

export function HotelExpensesPage() {
  const t = useT();
  const toast = useToast();
  const { can } = useAuth();
  const confirm = useConfirm();
  const canManage = can("expense.manage");
  const month = monthRange();
  const [rangeMode, setRangeMode] = useState<RangeMode>("monthly");
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(month.to);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [edit, setEdit] = useState<ExpenseRow | null>(null);
  const [newCatName, setNewCatName] = useState("");

  const [spentOn, setSpentOn] = useState(isoDay(new Date()));
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<Period>("MONTHLY");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ from, to });
    if (categoryFilter) params.set("category", categoryFilter);
    try {
      setData(await api<Result>(`/expenses?${params}`));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("expense.loadFailed"), "err");
    }
  }, [from, to, categoryFilter, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => setPage(1), [from, to, categoryFilter, q]);

  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter((r) =>
        matchesSearch(q, r.category, r.title, r.note, r.createdBy?.name, r.spentOn, r.source)
      ),
    [data, q]
  );
  const pageRows = paginate(rows, page, PAGE_SIZE);
  const savedCategories = data?.categories ?? [];

  function applyRange(mode: RangeMode) {
    setRangeMode(mode);
    if (mode === "daily") {
      const d = isoDay(new Date());
      setFrom(d);
      setTo(d);
    } else if (mode === "monthly") {
      const r = monthRange();
      setFrom(r.from);
      setTo(r.to);
    } else {
      const r = yearRange();
      setFrom(r.from);
      setTo(r.to);
    }
  }

  function resetForm() {
    setSpentOn(isoDay(new Date()));
    setCategory("");
    setTitle("");
    setAmount("");
    setPeriod("MONTHLY");
    setNote("");
    setEdit(null);
  }

  function openAdd() {
    resetForm();
    setAddOpen(true);
  }

  function openEdit(row: ExpenseRow) {
    if (!row.editable) return;
    setEdit(row);
    setSpentOn(row.spentOn);
    setCategory(row.category || "");
    setTitle(row.title);
    setAmount(String(row.amount));
    setPeriod(row.period === "MONTHLY" ? "MONTHLY" : "DAILY");
    setNote(row.note || "");
    setAddOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !spentOn) return;
    const amt = Number(amount);
    if (!(amt > 0)) {
      toast.push(t("expense.badAmount"), "err");
      return;
    }
    setBusy(true);
    try {
      const body = {
        spentOn,
        category: category.trim() || undefined,
        title: title.trim(),
        amount: amt,
        period,
        note: note.trim() || undefined,
      };
      if (edit) {
        await api(`/expenses/${edit.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...body, category: category.trim() }),
        });
        toast.push(t("expense.updated"), "ok");
      } else {
        await api("/expenses", { method: "POST", body: JSON.stringify(body) });
        toast.push(t("expense.added"), "ok");
      }
      setAddOpen(false);
      resetForm();
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: ExpenseRow) {
    if (!row.editable) return;
    const ok = await confirm({
      title: t("expense.deleteTitle"),
      body: `${row.category || "—"} · ${row.title} · ${money(row.amount)}`,
      confirmLabel: t("common.remove"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/expenses/${row.id}`, { method: "DELETE" });
      toast.push(t("expense.deleted"), "ok");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    const name = newCatName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api("/expenses/categories", { method: "POST", body: JSON.stringify({ name }) });
      setNewCatName("");
      toast.push(t("expense.categoryAdded"), "ok");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(cat: CatRow) {
    if (cat.id.startsWith("sys-")) return;
    const ok = await confirm({
      title: t("expense.categoryDeleteTitle"),
      body: cat.name,
      confirmLabel: t("common.remove"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/expenses/categories/${cat.id}`, { method: "DELETE" });
      if (categoryFilter === cat.name) setCategoryFilter("");
      toast.push(t("expense.categoryDeleted"), "ok");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  function exportSheet() {
    if (!rows.length) {
      toast.push(t("expense.noRows"), "err");
      return;
    }
    downloadExcelCsv(
      `hotel-expenses-${from}-to-${to}.csv`,
      rows.map((r) => ({
        Date: r.spentOn,
        Source: r.source === "UNPAID_SUPPLIER" ? "UNPAID" : r.source,
        Category: r.category || "",
        Title: r.title,
        Amount: r.amount,
        PayStatus: r.payStatus || (r.inTotal ? "PAID" : "UNPAID"),
        InTotal: r.inTotal ? "yes" : "no",
        Note: r.note || "",
        AddedBy: r.createdBy?.name || "",
      }))
    );
    toast.push(t("expense.excelOk"), "ok");
  }

  const s = data?.summary;
  const customCategories = savedCategories.filter((c) => !c.id.startsWith("sys-"));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("expense.title")}</h1>
          <p>{t("expense.hint")}</p>
        </div>
        <div className="row page-head-actions">
          <button type="button" className="btn ghost" onClick={exportSheet}>
            {t("common.excel")}
          </button>
          {canManage && (
            <button type="button" className="btn ghost" onClick={() => setCatsOpen(true)}>
              {t("expense.manageCategories")}
            </button>
          )}
          {canManage && (
            <button type="button" className="btn" onClick={openAdd}>
              + {t("expense.add")}
            </button>
          )}
        </div>
      </div>

      <div className="panel panel-pad filter-panel">
        <div className="filter-bar">
          <div className="seg">
            <button type="button" className={rangeMode === "daily" ? "active" : ""} onClick={() => applyRange("daily")}>
              {t("expense.rangeDaily")}
            </button>
            <button
              type="button"
              className={rangeMode === "monthly" ? "active" : ""}
              onClick={() => applyRange("monthly")}
            >
              {t("expense.rangeMonthly")}
            </button>
            <button
              type="button"
              className={rangeMode === "yearly" ? "active" : ""}
              onClick={() => applyRange("yearly")}
            >
              {t("expense.rangeYearly")}
            </button>
          </div>
          <div className="field">
            <label htmlFor="expense-from">{t("expense.from")}</label>
            <DateField
              id="expense-from"
              value={from}
              max={to || undefined}
              onChange={(v) => {
                setRangeMode("daily");
                setFrom(v);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="expense-to">{t("expense.to")}</label>
            <DateField
              id="expense-to"
              value={to}
              min={from || undefined}
              onChange={(v) => {
                setRangeMode("daily");
                setTo(v);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="expense-cat">{t("expense.category")}</label>
            <select id="expense-cat" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">{t("expense.allCategories")}</option>
              {savedCategories.map((c) => (
                <option key={c.id} value={c.name}>
                  {categoryLabel(c.name, t)}
                </option>
              ))}
            </select>
          </div>
          <SearchField value={q} onChange={setQ} placeholder={t("expense.searchPh")} />
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("expense.sales")}</span>
          <strong>{money(s?.sales ?? 0)}</strong>
        </div>
        <div className="panel stat">
          <span>{t("expense.supplierPaid")}</span>
          <strong>{money(s?.supplierPaid ?? 0)}</strong>
          <span className="tiny muted">{t("expense.supplierPaidHint")}</span>
        </div>
        <div className="panel stat">
          <span>{t("expense.manualTotal")}</span>
          <strong>{money(s?.manualExpenses ?? 0)}</strong>
        </div>
        <div className="panel stat">
          <span>{t("expense.total")}</span>
          <strong>{money(s?.total ?? 0)}</strong>
          <span className="tiny muted">{t("expense.totalHint")}</span>
        </div>
        <div className={`panel stat ${(s?.netProfit ?? 0) < 0 ? "alert-low" : ""}`}>
          <span>{(s?.netProfit ?? 0) < 0 ? t("expense.netLoss") : t("expense.netProfit")}</span>
          <strong style={{ color: (s?.netProfit ?? 0) >= 0 ? "var(--ok)" : "var(--danger)" }}>
            {(s?.netProfit ?? 0) < 0 ? (
              <>
                {t("expense.lossTag")} · {money(Math.abs(s?.netProfit ?? 0))}
              </>
            ) : (
              <>
                {t("expense.profitTag")} · {money(s?.netProfit ?? 0)}
              </>
            )}
          </strong>
          <span className="tiny muted">
            {(s?.netProfit ?? 0) < 0 ? t("expense.netLossHint") : t("expense.netProfitHint")}
          </span>
        </div>
        <div className="panel stat">
          <span>{t("expense.inventoryPurchased")}</span>
          <strong>{money(s?.inventoryPurchased ?? 0)}</strong>
          <span className="tiny muted">{t("expense.inventoryPurchasedHint")}</span>
        </div>
        <div className={`panel stat ${(s?.unpaidSupplierBills ?? 0) > 0 ? "alert-low" : ""}`}>
          <span>{t("expense.unpaidSupplier")}</span>
          <strong style={{ color: (s?.unpaidSupplierBills ?? 0) > 0 ? "var(--danger)" : undefined }}>
            {money(s?.unpaidSupplierBills ?? 0)}
          </strong>
          <span className="tiny muted">{t("expense.unpaidSupplierHint")}</span>
        </div>
      </div>

      {(s?.byCategory.length ?? 0) > 0 && (
        <div className="chips" style={{ marginTop: "0.65rem" }}>
          {s!.byCategory.map((c) => (
            <button
              key={c.name}
              type="button"
              className={`chip ${categoryFilter === c.name ? "active" : ""}`}
              onClick={() => setCategoryFilter(categoryFilter === c.name ? "" : c.name)}
            >
              {categoryLabel(c.name, t)} · {money(c.amount)}
            </button>
          ))}
        </div>
      )}

      <div className="panel panel-pad">
        {!rows.length && <div className="empty">{t("expense.noRows")}</div>}
        {rows.length > 0 && (
          <div className="table-wrap wide">
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("expense.source")}</th>
                  <th>{t("expense.category")}</th>
                  <th>{t("expense.detail")}</th>
                  <th>{t("store.amount")}</th>
                  <th>{t("expense.note")}</th>
                  <th>{t("expense.addedBy")}</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.spentOn}</td>
                    <td>
                      <span className={`badge ${badgeKind(r)}`}>{sourceLabel(r.source, t)}</span>
                    </td>
                    <td>{r.category ? <span className="badge">{categoryLabel(r.category, t)}</span> : "—"}</td>
                    <td>
                      <strong>{displayTitle(r, t)}</strong>
                      {r.source === "UNPAID_SUPPLIER" && (
                        <div className="tiny muted">{t("expense.invoiceOnly")}</div>
                      )}
                    </td>
                    <td>
                      <strong style={r.inTotal ? undefined : { color: "var(--danger)" }}>{money(r.amount)}</strong>
                    </td>
                    <td className="tiny muted">{r.note || "—"}</td>
                    <td className="tiny muted">{r.createdBy?.name || "—"}</td>
                    {canManage && (
                      <td>
                        {r.editable ? (
                          <div className="row">
                            <button type="button" className="btn ghost sm" onClick={() => openEdit(r)}>
                              {t("common.edit")}
                            </button>
                            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void remove(r)}>
                              {t("common.remove")}
                            </button>
                          </div>
                        ) : (
                          <span className="tiny muted">{t("expense.readOnly")}</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} />
      </div>

      <Modal
        open={addOpen}
        title={edit ? t("expense.editTitle") : t("expense.addTitle")}
        onClose={() => {
          if (!busy) {
            setAddOpen(false);
            resetForm();
          }
        }}
        size="md"
      >
        <form onSubmit={save}>
          <div className="modal-scroll">
            <div className="grid-2">
              <div className="field">
                <label htmlFor="expense-spent-on">{t("common.date")}</label>
                <DateField id="expense-spent-on" value={spentOn} onChange={setSpentOn} />
              </div>
              <div className="field">
                <label htmlFor="expense-period">{t("expense.period")}</label>
                <select
                  id="expense-period"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as Period)}
                >
                  <option value="DAILY">{t("expense.periodDaily")}</option>
                  <option value="MONTHLY">{t("expense.periodMonthly")}</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>{t("expense.detail")}</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("expense.detailPh")}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label>{t("expense.category")}</label>
              <input
                list="expense-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t("expense.categoryPh")}
              />
              <p className="tiny muted" style={{ margin: "0.25rem 0 0" }}>
                {t("expense.categoryFreeHint")}
              </p>
              <datalist id="expense-categories">
                {savedCategories
                  .filter((c) => !c.id.startsWith("sys-"))
                  .map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
              </datalist>
              {savedCategories.filter((c) => !c.id.startsWith("sys-")).length > 0 && (
                <div className="chips" style={{ marginTop: "0.4rem" }}>
                  {savedCategories
                    .filter((c) => !c.id.startsWith("sys-"))
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`chip ${category === c.name ? "active" : ""}`}
                        onClick={() => setCategory(c.name)}
                      >
                        {c.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="field">
              <label>{t("store.amount")}</label>
              <input
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>{t("expense.note")}</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("expense.notePh")} />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setAddOpen(false);
                resetForm();
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={catsOpen}
        title={t("expense.manageCategories")}
        onClose={() => {
          if (!busy) {
            setCatsOpen(false);
            setNewCatName("");
          }
        }}
        size="sm"
      >
        <div className="expense-cats">
          <p className="expense-cats-hint muted tiny">{t("expense.manageCategoriesHint")}</p>
          {canManage && (
            <form className="expense-cats-add" onSubmit={addCategory}>
              <div className="field">
                <label htmlFor="expense-new-cat">{t("expense.newCategory")}</label>
                <input
                  id="expense-new-cat"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder={t("expense.categoryPh")}
                  autoComplete="off"
                />
              </div>
              <button className="btn sm" type="submit" disabled={busy || !newCatName.trim()}>
                {t("expense.saveCategory")}
              </button>
            </form>
          )}
          {!customCategories.length ? (
            <div className="expense-cats-empty">{t("expense.noCategories")}</div>
          ) : (
            <ul className="expense-cats-list">
              {customCategories.map((c) => (
                <li key={c.id} className="expense-cats-item">
                  <strong>{c.name}</strong>
                  {canManage && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => void removeCategory(c)}
                    >
                      {t("common.remove")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}
