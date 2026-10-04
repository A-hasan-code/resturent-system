import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";

export type PurchaseItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  ratePerUnit: number;
  quantityOnHand: number;
};

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  purchased: number;
  paid: number;
  outstanding: number;
};

type RecentBill = {
  id: string;
  purchasedOn: string;
  supplier: string;
  payKind: "CASH" | "CREDIT";
  total: number;
  paidAmount: number;
  outstanding: number;
  lineCount: number;
};

type DailyLine = {
  id: string;
  supplier: string;
  payKind: string;
  item: string;
  category: string;
  unit: string;
  quantity: number;
  ratePerUnit: number;
  amount: number;
};

type Ledger = SupplierRow & {
  notes: string | null;
  purchases: {
    id: string;
    purchasedOn: string;
    payKind: string;
    total: number;
    paidAmount: number;
    lines: { id: string; item: string; category: string; unit: string; quantity: number; ratePerUnit: number; amount: number }[];
  }[];
  payments: { id: string; paidOn: string; amount: number; note: string | null }[];
};

type DraftLine = { itemId: string; qty: string; rate: string };

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function StorePurchasing({
  view,
  items,
  canManage,
  onChanged,
}: {
  view: "buy" | "suppliers" | "daily";
  items: PurchaseItem[];
  canManage: boolean;
  onChanged: () => void;
}) {
  if (view === "buy") return <BuyView items={items} canManage={canManage} onChanged={onChanged} />;
  if (view === "suppliers") return <SuppliersView canManage={canManage} />;
  return <DailyView />;
}

function BuyView({
  items,
  canManage,
  onChanged,
}: {
  items: PurchaseItem[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [recent, setRecent] = useState<RecentBill[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [date, setDate] = useState(todayIso);
  const [payKind, setPayKind] = useState<"CASH" | "CREDIT">("CASH");
  const [paidNow, setPaidNow] = useState("");
  const [note, setNote] = useState("");
  const [pick, setPick] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [s, r] = await Promise.all([
      api<SupplierRow[]>("/store/suppliers"),
      api<RecentBill[]>("/store/purchases/recent"),
    ]);
    setSuppliers(s);
    setRecent(r);
    setSupplierId((cur) => cur || s[0]?.id || "");
  }

  useEffect(() => {
    load().catch((e) => toast.push(e instanceof Error ? e.message : t("store.loadFailed"), "err"));
  }, []);

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0),
    [lines]
  );
  const paid = payKind === "CASH" ? total : Math.min(total, Math.max(0, Number(paidNow) || 0));
  const due = Math.max(0, total - paid);

  function addLine(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setLines((prev) => {
      if (prev.some((l) => l.itemId === itemId)) return prev;
      return [...prev, { itemId, qty: "", rate: String(item.ratePerUnit || "") }];
    });
    setPick("");
  }

  async function createSupplier(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const row = await api<SupplierRow>("/store/suppliers", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), phone: newPhone.trim() || undefined }),
      });
      setNewName("");
      setNewPhone("");
      setAddingSupplier(false);
      setSupplierId(row.id);
      toast.push(t("store.supplierAdded"), "ok");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      toast.push(t("store.pickSupplier"), "err");
      return;
    }
    const payload = lines
      .map((l) => ({ storeItemId: l.itemId, quantity: Number(l.qty), ratePerUnit: Number(l.rate) }))
      .filter((l) => l.quantity > 0 && l.ratePerUnit >= 0);
    if (!payload.length) {
      toast.push(t("store.noLines"), "err");
      return;
    }
    setBusy(true);
    try {
      await api("/store/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          purchasedOn: date,
          payKind,
          paidAmount: payKind === "CREDIT" ? paid : undefined,
          note: note.trim() || undefined,
          lines: payload,
        }),
      });
      toast.push(t("store.purchaseSaved"), "ok");
      setLines([]);
      setNote("");
      setPaidNow("");
      setPayKind("CASH");
      await load();
      onChanged();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="purchase-layout">
      {canManage && (
        <form className="panel panel-pad" onSubmit={save}>
          <h2 className="settings-h" style={{ marginTop: 0 }}>
            {t("store.newPurchase")}
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {t("store.purchaseHint")}
          </p>

          <div className="grid-2">
            <div className="field">
              <label>{t("store.supplier")}</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="">{t("store.pickSupplier")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.outstanding > 0 ? ` · ${t("store.outstanding")} ${money(s.outstanding)}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t("common.date")}</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>

          {!addingSupplier ? (
            <button type="button" className="btn ghost sm" onClick={() => setAddingSupplier(true)}>
              + {t("store.newSupplier")}
            </button>
          ) : (
            <div className="grid-2" style={{ marginTop: "0.6rem" }}>
              <div className="field">
                <label>{t("store.supplierName")}</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void createSupplier(e);
                    }
                  }}
                />
              </div>
              <div className="field">
                <label>{t("store.phone")}</label>
                <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              </div>
              <div className="row">
                <button type="button" className="btn sm" disabled={busy} onClick={(e) => void createSupplier(e)}>
                  {t("common.save")}
                </button>
                <button type="button" className="btn ghost sm" onClick={() => setAddingSupplier(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}

          <div className="chips" style={{ marginTop: "0.8rem" }}>
            <button type="button" className={`chip ${payKind === "CASH" ? "active" : ""}`} onClick={() => setPayKind("CASH")}>
              {t("store.payCash")}
            </button>
            <button type="button" className={`chip ${payKind === "CREDIT" ? "active" : ""}`} onClick={() => setPayKind("CREDIT")}>
              {t("store.payCredit")}
            </button>
          </div>
          {payKind === "CREDIT" && (
            <div className="field" style={{ marginTop: "0.6rem", maxWidth: 220 }}>
              <label>{t("store.paidNow")}</label>
              <input type="number" min={0} step="0.01" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} placeholder="0" />
            </div>
          )}

          <div className="row" style={{ marginTop: "0.9rem", gap: "0.5rem" }}>
            <select value={pick} onChange={(e) => addLine(e.target.value)} style={{ flex: 1 }}>
              <option value="">{t("store.addLine")}</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.category} · {i.name} · {money(i.ratePerUnit)}/{unitLabel(i.unit)}
                </option>
              ))}
            </select>
          </div>

          {lines.length > 0 && (
            <table style={{ marginTop: "0.75rem" }}>
              <thead>
                <tr>
                  <th>{t("common.item")}</th>
                  <th>{t("store.quantity")}</th>
                  <th>{t("common.rate")}</th>
                  <th>{t("common.amount")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const item = items.find((i) => i.id === l.itemId);
                  const amount = (Number(l.qty) || 0) * (Number(l.rate) || 0);
                  return (
                    <tr key={l.itemId}>
                      <td>
                        {item?.name}
                        <div className="tiny muted">
                          {item?.category} · {unitLabel(item?.unit || "")}
                        </div>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          value={l.qty}
                          onChange={(e) =>
                            setLines((prev) => prev.map((p) => (p.itemId === l.itemId ? { ...p, qty: e.target.value } : p)))
                          }
                          style={{ width: 90 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={l.rate}
                          onChange={(e) =>
                            setLines((prev) => prev.map((p) => (p.itemId === l.itemId ? { ...p, rate: e.target.value } : p)))
                          }
                          style={{ width: 100 }}
                        />
                      </td>
                      <td>{money(amount)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => setLines((prev) => prev.filter((p) => p.itemId !== l.itemId))}
                        >
                          {t("common.remove")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="field" style={{ marginTop: "0.75rem" }}>
            <label>{t("store.note")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("store.notePh")} />
          </div>

          <div className="stats" style={{ marginTop: "0.5rem" }}>
            <div className="panel stat">
              <span>{t("store.billTotal")}</span>
              <strong>{money(total)}</strong>
            </div>
            <div className="panel stat">
              <span>{t("store.paid")}</span>
              <strong>{money(paid)}</strong>
            </div>
            <div className="panel stat">
              <span>{t("store.stillDue")}</span>
              <strong>{money(due)}</strong>
            </div>
          </div>

          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || !lines.length}>
              {busy ? t("common.saving") : t("store.savePurchase")}
            </button>
          </div>
        </form>
      )}

      <div className="panel panel-pad">
        <h3 style={{ marginTop: 0 }}>{t("store.recentBills")}</h3>
        {!recent.length && <div className="empty">{t("store.noPurchases")}</div>}
        {recent.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("store.supplier")}</th>
                <th>{t("common.items")}</th>
                <th>{t("store.billTotal")}</th>
                <th>{t("store.paid")}</th>
                <th>{t("store.stillDue")}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((b) => (
                <tr key={b.id}>
                  <td>{b.purchasedOn}</td>
                  <td>{b.supplier}</td>
                  <td>{b.lineCount}</td>
                  <td>{money(b.total)}</td>
                  <td>{money(b.paidAmount)}</td>
                  <td>{b.outstanding > 0 ? <span className="badge unpaid">{money(b.outstanding)}</span> : money(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SuppliersView({ canManage }: { canManage: boolean }) {
  const t = useT();
  const toast = useToast();
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [payFor, setPayFor] = useState<SupplierRow | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setRows(await api<SupplierRow[]>("/store/suppliers"));
  }

  useEffect(() => {
    load().catch((e) => toast.push(e instanceof Error ? e.message : t("store.loadFailed"), "err"));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api("/store/suppliers", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || undefined }),
      });
      setName("");
      setPhone("");
      toast.push(t("store.supplierAdded"), "ok");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function openLedger(id: string) {
    try {
      setLedger(await api<Ledger>(`/store/suppliers/${id}/ledger`));
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    }
  }

  async function pay(e: FormEvent) {
    e.preventDefault();
    if (!payFor) return;
    setBusy(true);
    try {
      const next = await api<Ledger>(`/store/suppliers/${payFor.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), paidOn, note: note.trim() || undefined }),
      });
      toast.push(t("store.paymentSaved"), "ok");
      setPayFor(null);
      setAmount("");
      setNote("");
      if (ledger?.id === next.id) setLedger(next);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const purchased = rows.reduce((s, r) => s + r.purchased, 0);
  const outstanding = rows.reduce((s, r) => s + r.outstanding, 0);

  return (
    <div>
      <div className="stats">
        <div className="panel stat">
          <span>{t("store.tabSuppliers")}</span>
          <strong>{rows.length}</strong>
        </div>
        <div className="panel stat">
          <span>{t("store.purchased")}</span>
          <strong>{money(purchased)}</strong>
        </div>
        <div className="panel stat">
          <span>{t("store.outstanding")}</span>
          <strong>{money(outstanding)}</strong>
        </div>
      </div>

      {canManage && (
        <form className="panel panel-pad row" onSubmit={add} style={{ gap: "0.6rem", alignItems: "end", marginBottom: "0.8rem" }}>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label>{t("store.supplierName")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label>{t("store.phone")}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            + {t("store.newSupplier")}
          </button>
        </form>
      )}

      <div className="panel panel-pad">
        {!rows.length && <div className="empty">{t("store.noSuppliers")}</div>}
        {rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("store.phone")}</th>
                <th>{t("store.purchased")}</th>
                <th>{t("store.paid")}</th>
                <th>{t("store.outstanding")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.phone || "—"}</td>
                  <td>{money(s.purchased)}</td>
                  <td>{money(s.paid)}</td>
                  <td>{s.outstanding > 0 ? <span className="badge unpaid">{money(s.outstanding)}</span> : money(0)}</td>
                  <td>
                    <div className="row">
                      <button type="button" className="btn ghost sm" onClick={() => void openLedger(s.id)}>
                        {t("store.ledger")}
                      </button>
                      {canManage && s.outstanding > 0 && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setPayFor(s);
                            setAmount(String(s.outstanding));
                            setPaidOn(todayIso());
                            setNote("");
                          }}
                        >
                          {t("store.recordPayment")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {ledger && (
        <div className="panel panel-pad" style={{ marginTop: "0.8rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              {t("store.ledgerTitle")} · {ledger.name}
            </h3>
            <button type="button" className="btn ghost sm" onClick={() => setLedger(null)}>
              {t("common.close")}
            </button>
          </div>
          <p className="muted">
            {t("store.purchased")} {money(ledger.purchased)} · {t("store.paid")} {money(ledger.paid)} · {t("store.outstanding")}{" "}
            {money(ledger.outstanding)}
          </p>
          <h4>{t("store.bills")}</h4>
          {ledger.purchases.map((p) => (
            <div key={p.id} style={{ marginBottom: "0.8rem" }}>
              <strong>
                {p.purchasedOn} · {money(p.total)} · {p.payKind === "CASH" ? t("store.payCash") : t("store.payCredit")}
              </strong>
              <table>
                <tbody>
                  {p.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.item}</td>
                      <td>
                        <span className="badge">{l.category}</span>
                      </td>
                      <td>
                        {l.quantity} {unitLabel(l.unit)}
                      </td>
                      <td>
                        {money(l.ratePerUnit)}/{unitLabel(l.unit)}
                      </td>
                      <td>{money(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <h4>{t("store.payments")}</h4>
          {!ledger.payments.length && <div className="tiny muted">—</div>}
          {ledger.payments.map((p) => (
            <div key={p.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                {p.paidOn}
                {p.note ? <span className="tiny muted"> · {p.note}</span> : null}
              </span>
              <strong>{money(p.amount)}</strong>
            </div>
          ))}
        </div>
      )}

      {payFor && (
        <form className="panel panel-pad" onSubmit={pay} style={{ marginTop: "0.8rem" }}>
          <h3 style={{ marginTop: 0 }}>
            {t("store.recordPayment")} · {payFor.name}
          </h3>
          <p className="muted">
            {t("store.outstanding")} {money(payFor.outstanding)}
          </p>
          <div className="grid-2">
            <div className="field">
              <label>{t("store.amount")}</label>
              <input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label>{t("common.date")}</label>
              <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
            </div>
          </div>
          <div className="field">
            <label>{t("store.note")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
            <button type="button" className="btn ghost" onClick={() => setPayFor(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function DailyView() {
  const t = useT();
  const toast = useToast();
  const [date, setDate] = useState(todayIso);
  const [dates, setDates] = useState<string[]>([]);
  const [lines, setLines] = useState<DailyLine[]>([]);
  const [total, setTotal] = useState(0);

  async function load(d: string) {
    const [report, days] = await Promise.all([
      api<{ total: number; lines: DailyLine[] }>(`/store/purchases?date=${d}`),
      api<string[]>("/store/purchases/dates"),
    ]);
    setLines(report.lines);
    setTotal(report.total);
    setDates(days);
  }

  useEffect(() => {
    load(date).catch((e) => toast.push(e instanceof Error ? e.message : t("store.loadFailed"), "err"));
  }, [date]);

  return (
    <div>
      <div className="row" style={{ marginBottom: "0.7rem", gap: "0.6rem", alignItems: "center" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <strong>
          {t("store.billTotal")} {money(total)}
        </strong>
      </div>
      <div className="chips" style={{ marginBottom: "0.7rem" }}>
        {dates.map((d) => (
          <button key={d} type="button" className={`chip ${d === date ? "active" : ""}`} onClick={() => setDate(d)}>
            {d}
          </button>
        ))}
      </div>
      <div className="panel panel-pad">
        {!lines.length && <div className="empty">{t("store.noPurchases")}</div>}
        {lines.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{t("store.supplier")}</th>
                <th>{t("common.item")}</th>
                <th>{t("common.category")}</th>
                <th>{t("store.quantity")}</th>
                <th>{t("common.rate")}</th>
                <th>{t("common.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.supplier}</td>
                  <td>{l.item}</td>
                  <td>
                    <span className="badge">{l.category}</span>
                  </td>
                  <td>
                    {l.quantity} {unitLabel(l.unit)}
                  </td>
                  <td>
                    {money(l.ratePerUnit)}/{unitLabel(l.unit)}
                  </td>
                  <td>{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
