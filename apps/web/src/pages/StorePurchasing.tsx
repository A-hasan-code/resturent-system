import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { Modal } from "../components/Modal";
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
  supplyOf: string | null;
  brand: string | null;
  address: string | null;
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
  extraExpense: number;
  extraExpenseNote: string | null;
  extraExpensePaidBy: "SUPPLIER" | "SELF" | null;
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
    extraExpense: number;
    extraExpenseNote: string | null;
    extraExpensePaidBy: "SUPPLIER" | "SELF" | null;
    paidAmount: number;
    balance: number;
    note: string | null;
    lines: { id: string; item: string; category: string; unit: string; quantity: number; ratePerUnit: number; amount: number }[];
  }[];
  payments: { id: string; paidOn: string; amount: number; note: string | null }[];
};

type DraftLine = { itemId: string; qty: string; rate: string };

type Cat = { id: string; code: string; name: string };

const UNITS = ["KG", "G", "L", "ML", "PCS"] as const;

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
  const [categories, setCategories] = useState<Cat[]>([]);
  const [extraItems, setExtraItems] = useState<PurchaseItem[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newSupplyOf, setNewSupplyOf] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [date, setDate] = useState(todayIso);
  const [payKind, setPayKind] = useState<"CASH" | "CREDIT">("CASH");
  const [paidNow, setPaidNow] = useState("");
  const [note, setNote] = useState("");
  const [extraExpense, setExtraExpense] = useState("");
  const [extraNote, setExtraNote] = useState("");
  const [extraPaidBy, setExtraPaidBy] = useState<"SUPPLIER" | "SELF">("SELF");
  const [lineMode, setLineMode] = useState<"existing" | "new">("existing");
  const [filterCat, setFilterCat] = useState("");
  const [pick, setPick] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemCat, setNewItemCat] = useState("");
  const [newItemUnit, setNewItemUnit] = useState<string>("KG");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);

  const allItems = useMemo(() => {
    const map = new Map<string, PurchaseItem>();
    for (const i of items) map.set(i.id, i);
    for (const i of extraItems) if (!map.has(i.id)) map.set(i.id, i);
    return [...map.values()];
  }, [items, extraItems]);

  const categoryNames = useMemo(() => {
    const set = new Set<string>();
    for (const i of allItems) if (i.category) set.add(i.category);
    for (const c of categories) set.add(c.name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allItems, categories]);

  const filteredItems = useMemo(
    () => (filterCat ? allItems.filter((i) => i.category === filterCat) : allItems),
    [allItems, filterCat]
  );

  async function load() {
    const [s, r, cats] = await Promise.all([
      api<SupplierRow[]>("/store/suppliers"),
      api<RecentBill[]>("/store/purchases/recent"),
      api<Cat[]>("/store/categories"),
    ]);
    setSuppliers(s);
    setRecent(r);
    setCategories(cats);
    setSupplierId((cur) => cur || s[0]?.id || "");
    setNewItemCat((cur) => cur || cats[0]?.id || "");
  }

  useEffect(() => {
    load().catch((e) => toast.push(e instanceof Error ? e.message : t("store.loadFailed"), "err"));
  }, []);

  const inventoryTotal = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0),
    [lines]
  );
  const extraAmt = Math.max(0, Number(extraExpense) || 0);
  const supplierExtra = extraAmt > 0 && extraPaidBy === "SUPPLIER" ? extraAmt : 0;
  const supplierDue = inventoryTotal + supplierExtra;
  const paid = payKind === "CASH" ? supplierDue : Math.min(supplierDue, Math.max(0, Number(paidNow) || 0));
  const credit = Math.max(0, supplierDue - paid);

  function addLine(itemId: string, catalog = allItems) {
    const item = catalog.find((i) => i.id === itemId);
    if (!item) return;
    setLines((prev) => {
      if (prev.some((l) => l.itemId === itemId)) return prev;
      return [...prev, { itemId, qty: "", rate: String(item.ratePerUnit || "") }];
    });
    setPick("");
  }

  async function addNewItemLine() {
    const name = newItemName.trim();
    if (!name) {
      toast.push(t("store.newItemNameRequired"), "err");
      return;
    }
    if (!newItemCat) {
      toast.push(t("store.pickCategory"), "err");
      return;
    }
    setBusy(true);
    try {
      const created = await api<{
        id: string;
        name: string;
        unit: string;
        ratePerUnit: number | string;
        quantityOnHand: number | string;
      }>("/store/items", {
        method: "POST",
        body: JSON.stringify({
          name,
          categoryId: newItemCat,
          unit: newItemUnit,
          quantityOnHand: 0,
          ratePerUnit: 0,
        }),
      });
      const catName = categories.find((c) => c.id === newItemCat)?.name || "";
      const row: PurchaseItem = {
        id: created.id,
        name: created.name,
        category: catName,
        unit: created.unit,
        ratePerUnit: Number(created.ratePerUnit) || 0,
        quantityOnHand: Number(created.quantityOnHand) || 0,
      };
      setExtraItems((prev) => [...prev.filter((p) => p.id !== row.id), row]);
      addLine(row.id, [...allItems, row]);
      setNewItemName("");
      toast.push(t("store.itemAdded"), "ok");
      onChanged();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("store.addFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) || null;

  async function createSupplier(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const row = await api<SupplierRow>("/store/suppliers", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          phone: newPhone.trim() || undefined,
          supplyOf: newSupplyOf.trim() || undefined,
          brand: newBrand.trim() || undefined,
          address: newAddress.trim() || undefined,
        }),
      });
      setNewName("");
      setNewPhone("");
      setNewSupplyOf("");
      setNewBrand("");
      setNewAddress("");
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
    if (extraAmt > 0 && !extraNote.trim()) {
      toast.push(t("store.extraExpenseReasonRequired"), "err");
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
          extraExpense: extraAmt > 0 ? extraAmt : undefined,
          extraExpenseNote: extraAmt > 0 ? extraNote.trim() : undefined,
          extraExpensePaidBy: extraAmt > 0 ? extraPaidBy : undefined,
          note: note.trim() || undefined,
          lines: payload,
        }),
      });
      toast.push(t("store.purchaseSaved"), "ok");
      setLines([]);
      setNote("");
      setPaidNow("");
      setPayKind("CASH");
      setExtraExpense("");
      setExtraNote("");
      setExtraPaidBy("SELF");
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
                    {s.supplyOf ? ` · ${s.supplyOf}` : ""}
                    {s.brand ? ` · ${s.brand}` : ""}
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

          {selectedSupplier && (
            <div className="panel" style={{ marginTop: "0.65rem", padding: "0.7rem 0.85rem" }}>
              <strong>{selectedSupplier.name}</strong>
              <SupplierMeta
                phone={selectedSupplier.phone}
                supplyOf={selectedSupplier.supplyOf}
                brand={selectedSupplier.brand}
                address={selectedSupplier.address}
              />
            </div>
          )}

          <button
            type="button"
            className="btn ghost sm"
            style={{ marginTop: "0.55rem" }}
            onClick={() => {
              setNewName("");
              setNewPhone("");
              setNewSupplyOf("");
              setNewBrand("");
              setNewAddress("");
              setAddingSupplier(true);
            }}
          >
            + {t("store.newSupplier")}
          </button>

          <Modal
            open={addingSupplier}
            title={t("store.newSupplier")}
            onClose={() => {
              if (!busy) setAddingSupplier(false);
            }}
            size="md"
          >
            <form onSubmit={(e) => void createSupplier(e)}>
              <div className="modal-scroll">
                <div className="field">
                  <label>{t("store.supplierName")}</label>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus />
                </div>
                <div className="field">
                  <label>{t("store.supplierSupplyOf")}</label>
                  <input
                    value={newSupplyOf}
                    onChange={(e) => setNewSupplyOf(e.target.value)}
                    placeholder={t("store.supplierSupplyOfPh")}
                  />
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>{t("store.supplierBrand")}</label>
                    <input
                      value={newBrand}
                      onChange={(e) => setNewBrand(e.target.value)}
                      placeholder={t("store.supplierBrandPh")}
                    />
                  </div>
                  <div className="field">
                    <label>{t("store.phone")}</label>
                    <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label>{t("store.supplierAddress")}</label>
                  <input
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder={t("store.supplierAddressPh")}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn" type="submit" disabled={busy || !newName.trim()}>
                  {busy ? t("common.saving") : t("common.save")}
                </button>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setAddingSupplier(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          </Modal>

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

          <div className="chips" style={{ marginTop: "0.9rem" }}>
            <button
              type="button"
              className={`chip ${lineMode === "existing" ? "active" : ""}`}
              onClick={() => setLineMode("existing")}
            >
              {t("store.lineExisting")}
            </button>
            <button
              type="button"
              className={`chip ${lineMode === "new" ? "active" : ""}`}
              onClick={() => setLineMode("new")}
            >
              {t("store.lineNew")}
            </button>
          </div>

          {lineMode === "existing" ? (
            <div className="grid-2" style={{ marginTop: "0.6rem" }}>
              <div className="field">
                <label>{t("common.category")}</label>
                <select
                  value={filterCat}
                  onChange={(e) => {
                    setFilterCat(e.target.value);
                    setPick("");
                  }}
                >
                  <option value="">{t("store.allCategories")}</option>
                  {categoryNames.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t("common.item")}</label>
                <select value={pick} onChange={(e) => addLine(e.target.value)}>
                  <option value="">{t("store.addLine")}</option>
                  {filteredItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · {money(i.ratePerUnit)}/{unitLabel(i.unit)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: "0.6rem" }}>
              <p className="muted tiny" style={{ marginTop: 0 }}>
                {t("store.newItemHint")}
              </p>
              <div className="grid-2">
                <div className="field">
                  <label>{t("common.category")}</label>
                  <select value={newItemCat} onChange={(e) => setNewItemCat(e.target.value)} required>
                    <option value="">{t("store.pickCategory")}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{t("common.unit")}</label>
                  <select value={newItemUnit} onChange={(e) => setNewItemUnit(e.target.value)}>
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {unitLabel(u)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="row" style={{ gap: "0.5rem", alignItems: "flex-end" }}>
                <div className="field" style={{ flex: 1, margin: 0 }}>
                  <label>{t("common.name")}</label>
                  <input
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder={t("store.newItemNamePh")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addNewItemLine();
                      }
                    }}
                  />
                </div>
                <button type="button" className="btn sm" disabled={busy} onClick={() => void addNewItemLine()}>
                  {t("store.addNewItemLine")}
                </button>
              </div>
            </div>
          )}

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
                  const item = allItems.find((i) => i.id === l.itemId);
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

          <div className="panel" style={{ marginTop: "0.85rem", padding: "0.75rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{t("store.extraExpense")}</h3>
            <p className="muted tiny" style={{ marginTop: 0 }}>
              {t("store.extraExpenseHint")}
            </p>
            <div className="grid-2">
              <div className="field">
                <label>{t("store.extraExpenseAmount")}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={extraExpense}
                  onChange={(e) => setExtraExpense(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="field">
                <label>{t("store.extraExpenseFor")}</label>
                <input
                  value={extraNote}
                  onChange={(e) => setExtraNote(e.target.value)}
                  placeholder={t("store.extraExpenseForPh")}
                />
              </div>
            </div>
            {extraAmt > 0 && (
              <div className="chips" style={{ marginTop: "0.35rem" }}>
                <button
                  type="button"
                  className={`chip ${extraPaidBy === "SELF" ? "active" : ""}`}
                  onClick={() => setExtraPaidBy("SELF")}
                >
                  {t("store.extraPaidSelf")}
                </button>
                <button
                  type="button"
                  className={`chip ${extraPaidBy === "SUPPLIER" ? "active" : ""}`}
                  onClick={() => setExtraPaidBy("SUPPLIER")}
                >
                  {t("store.extraPaidSupplier")}
                </button>
              </div>
            )}
          </div>

          <div className="field" style={{ marginTop: "0.75rem" }}>
            <label>{t("store.note")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("store.notePh")} />
          </div>

          <div className="stats" style={{ marginTop: "0.5rem" }}>
            <div className="panel stat">
              <span>{t("store.inventoryValue")}</span>
              <strong>{money(inventoryTotal)}</strong>
            </div>
            <div className="panel stat">
              <span>{t("store.extraExpense")}</span>
              <strong>
                {money(extraAmt)}
                {extraAmt > 0 ? (
                  <div className="tiny muted">
                    {extraPaidBy === "SELF" ? t("store.extraPaidSelf") : t("store.extraPaidSupplier")}
                    {extraNote.trim() ? ` · ${extraNote.trim()}` : ""}
                  </div>
                ) : null}
              </strong>
            </div>
            <div className="panel stat">
              <span>{t("store.paidToSupplier")}</span>
              <strong>{money(paid)}</strong>
            </div>
            <div className="panel stat">
              <span>{t("store.creditDue")}</span>
              <strong>{money(credit)}</strong>
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
                <th>{t("store.inventoryValue")}</th>
                <th>{t("store.extraExpense")}</th>
                <th>{t("store.paidToSupplier")}</th>
                <th>{t("store.creditDue")}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((b) => (
                <tr key={b.id}>
                  <td>{b.purchasedOn}</td>
                  <td>{b.supplier}</td>
                  <td>{b.lineCount}</td>
                  <td>{money(b.total)}</td>
                  <td>
                    {b.extraExpense > 0 ? (
                      <>
                        {money(b.extraExpense)}
                        <div className="tiny muted">
                          {b.extraExpensePaidBy === "SELF" ? t("store.extraPaidSelf") : t("store.extraPaidSupplier")}
                          {b.extraExpenseNote ? ` · ${b.extraExpenseNote}` : ""}
                        </div>
                      </>
                    ) : (
                      money(0)
                    )}
                  </td>
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

function billStatus(paidAmount: number, balance: number): "paid" | "partial" | "unpaid" {
  if (balance <= 0.009) return "paid";
  if (paidAmount > 0.009) return "partial";
  return "unpaid";
}

function supplierBillTotal(p: {
  total: number;
  extraExpense: number;
  extraExpensePaidBy: "SUPPLIER" | "SELF" | null;
}) {
  return p.total + (p.extraExpensePaidBy === "SUPPLIER" ? p.extraExpense : 0);
}

function SupplierMeta({
  phone,
  supplyOf,
  brand,
  address,
}: {
  phone?: string | null;
  supplyOf?: string | null;
  brand?: string | null;
  address?: string | null;
}) {
  const t = useT();
  return (
    <div className="supplier-meta">
      <div className="supplier-meta-item">
        <span>{t("store.supplierSupplyOf")}</span>
        <strong>{supplyOf?.trim() || "—"}</strong>
      </div>
      <div className="supplier-meta-item">
        <span>{t("store.supplierBrand")}</span>
        <strong>{brand?.trim() || "—"}</strong>
      </div>
      <div className="supplier-meta-item">
        <span>{t("store.phone")}</span>
        <strong>{phone?.trim() || "—"}</strong>
      </div>
      <div className="supplier-meta-item">
        <span>{t("store.supplierAddress")}</span>
        <strong>{address?.trim() || "—"}</strong>
      </div>
    </div>
  );
}

function SuppliersView({ canManage }: { canManage: boolean }) {
  const t = useT();
  const toast = useToast();
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [supplyOf, setSupplyOf] = useState("");
  const [brand, setBrand] = useState("");
  const [address, setAddress] = useState("");
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [openBillId, setOpenBillId] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<SupplierRow | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function resetAddForm() {
    setName("");
    setPhone("");
    setSupplyOf("");
    setBrand("");
    setAddress("");
  }

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
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || undefined,
          supplyOf: supplyOf.trim() || undefined,
          brand: brand.trim() || undefined,
          address: address.trim() || undefined,
        }),
      });
      resetAddForm();
      setAddOpen(false);
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
      const next = await api<Ledger>(`/store/suppliers/${id}/ledger`);
      setLedger(next);
      const firstOpen = next.purchases.find((p) => p.balance > 0.009);
      setOpenBillId(firstOpen?.id || next.purchases[0]?.id || null);
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
          <span>{t("store.supplierDueTotal")}</span>
          <strong>{money(purchased)}</strong>
        </div>
        <div className="panel stat">
          <span>{t("store.supplierStillDue")}</span>
          <strong>{money(outstanding)}</strong>
        </div>
      </div>

      {canManage && (
        <div className="row" style={{ marginBottom: "0.8rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              resetAddForm();
              setAddOpen(true);
            }}
          >
            + {t("store.newSupplier")}
          </button>
        </div>
      )}

      <Modal
        open={addOpen}
        title={t("store.newSupplier")}
        onClose={() => {
          if (!busy) {
            setAddOpen(false);
            resetAddForm();
          }
        }}
        size="md"
      >
        <form onSubmit={add}>
          <div className="modal-scroll">
            <div className="field">
              <label>{t("store.supplierName")}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label>{t("store.supplierSupplyOf")}</label>
              <input
                value={supplyOf}
                onChange={(e) => setSupplyOf(e.target.value)}
                placeholder={t("store.supplierSupplyOfPh")}
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label>{t("store.supplierBrand")}</label>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder={t("store.supplierBrandPh")} />
              </div>
              <div className="field">
                <label>{t("store.phone")}</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>{t("store.supplierAddress")}</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t("store.supplierAddressPh")}
              />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || !name.trim()}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setAddOpen(false);
                resetAddForm();
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </Modal>

      {!rows.length && (
        <div className="panel panel-pad">
          <div className="empty">{t("store.noSuppliers")}</div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="supplier-list">
          {rows.map((s) => (
            <div
              key={s.id}
              className={`panel panel-pad supplier-card${ledger?.id === s.id ? " is-selected" : ""}`}
            >
              <div className="supplier-card-top">
                <div className="supplier-profile" style={{ flex: 1, minWidth: 220 }}>
                  <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
                    <h3>{s.name}</h3>
                    {s.outstanding > 0.009 ? (
                      <span className="badge unpaid">{t("store.accountHasDue")}</span>
                    ) : (
                      <span className="badge paid">{t("store.accountClear")}</span>
                    )}
                  </div>
                  <SupplierMeta phone={s.phone} supplyOf={s.supplyOf} brand={s.brand} address={s.address} />
                </div>
                <div className="supplier-card-actions">
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
              </div>
              <div className="supplier-money">
                <div className="panel stat">
                  <span>{t("store.supplierDueTotal")}</span>
                  <strong>{money(s.purchased)}</strong>
                </div>
                <div className="panel stat">
                  <span>{t("store.supplierPaidTotal")}</span>
                  <strong>{money(s.paid)}</strong>
                </div>
                <div className="panel stat">
                  <span>{t("store.supplierStillDue")}</span>
                  <strong>
                    {s.outstanding > 0.009 ? (
                      <span className="badge unpaid">{money(s.outstanding)}</span>
                    ) : (
                      <span className="badge paid">{money(0)}</span>
                    )}
                  </strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {ledger && (
        <div className="panel panel-pad" style={{ marginTop: "0.8rem" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="supplier-profile" style={{ flex: 1, minWidth: 240 }}>
              <div className="tiny muted">{t("store.ledgerTitle")}</div>
              <h3>{ledger.name}</h3>
              <SupplierMeta
                phone={ledger.phone}
                supplyOf={ledger.supplyOf}
                brand={ledger.brand}
                address={ledger.address}
              />
              <p className="muted tiny" style={{ margin: "0.35rem 0 0" }}>
                {t("store.ledgerHint")}
              </p>
            </div>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setLedger(null);
                setOpenBillId(null);
              }}
            >
              {t("common.close")}
            </button>
          </div>

          <div className="stats" style={{ marginTop: "0.75rem" }}>
            <div className="panel stat">
              <span>{t("store.supplierDueTotal")}</span>
              <strong>{money(ledger.purchased)}</strong>
            </div>
            <div className="panel stat">
              <span>{t("store.supplierPaidTotal")}</span>
              <strong>{money(ledger.paid)}</strong>
            </div>
            <div className="panel stat">
              <span>{t("store.supplierStillDue")}</span>
              <strong>{money(ledger.outstanding)}</strong>
            </div>
          </div>

          <h4 style={{ marginBottom: "0.4rem" }}>{t("store.bills")}</h4>
          {!ledger.purchases.length && <div className="empty">{t("store.noBillsYet")}</div>}
          {ledger.purchases.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("store.inventoryValue")}</th>
                  <th>{t("store.extraExpense")}</th>
                  <th>{t("store.billSupplierTotal")}</th>
                  <th>{t("store.paidToSupplier")}</th>
                  <th>{t("store.billRemaining")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ledger.purchases.map((p) => {
                  const due = supplierBillTotal(p);
                  const status = billStatus(p.paidAmount, p.balance);
                  const open = openBillId === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr>
                        <td>
                          <strong>{p.purchasedOn}</strong>
                          <div className="tiny muted">
                            {p.payKind === "CASH" ? t("store.payCash") : t("store.payCredit")}
                          </div>
                        </td>
                        <td>
                          {status === "paid" && <span className="badge paid">{t("store.billStatusPaid")}</span>}
                          {status === "partial" && <span className="badge pending">{t("store.billStatusPartial")}</span>}
                          {status === "unpaid" && <span className="badge unpaid">{t("store.billStatusUnpaid")}</span>}
                        </td>
                        <td>{money(p.total)}</td>
                        <td>
                          {p.extraExpense > 0 ? (
                            <>
                              {money(p.extraExpense)}
                              <div className="tiny muted">
                                {p.extraExpensePaidBy === "SELF" ? t("store.extraPaidSelf") : t("store.extraPaidSupplier")}
                                {p.extraExpenseNote ? ` · ${p.extraExpenseNote}` : ""}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{money(due)}</td>
                        <td>{money(p.paidAmount)}</td>
                        <td>
                          {p.balance > 0.009 ? (
                            <span className="badge unpaid">{money(p.balance)}</span>
                          ) : (
                            <span className="badge paid">{money(0)}</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => setOpenBillId(open ? null : p.id)}
                          >
                            {open ? t("common.close") : t("store.billItems")}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={8} style={{ background: "rgba(0,0,0,0.03)" }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>{t("common.item")}</th>
                                  <th>{t("common.category")}</th>
                                  <th>{t("store.quantity")}</th>
                                  <th>{t("common.rate")}</th>
                                  <th>{t("common.amount")}</th>
                                </tr>
                              </thead>
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
                                {p.extraExpense > 0 && (
                                  <tr>
                                    <td colSpan={4}>
                                      <strong>{t("store.ledgerExtraRow")}</strong>
                                      {p.extraExpenseNote ? ` · ${p.extraExpenseNote}` : ""}
                                      <div className="tiny muted">
                                        {p.extraExpensePaidBy === "SELF"
                                          ? t("store.extraPaidSelfDetail")
                                          : t("store.extraPaidSupplierDetail")}
                                      </div>
                                    </td>
                                    <td>
                                      <strong>{money(p.extraExpense)}</strong>
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          <h4 style={{ marginTop: "1rem", marginBottom: "0.35rem" }}>{t("store.payments")}</h4>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            {t("store.paymentsHint")}
          </p>
          {!ledger.payments.length && <div className="tiny muted">—</div>}
          {ledger.payments.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>{t("store.note")}</th>
                  <th>{t("store.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.paidOn}</td>
                    <td>{p.note || "—"}</td>
                    <td>
                      <strong>{money(p.amount)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {payFor && (
        <form className="panel panel-pad" onSubmit={pay} style={{ marginTop: "0.8rem" }}>
          <h3 style={{ marginTop: 0 }}>
            {t("store.recordPayment")} · {payFor.name}
          </h3>
          <p className="muted">
            {t("store.supplierStillDue")} {money(payFor.outstanding)}
          </p>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            {t("store.paymentsHint")}
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

type DailyExtra = {
  purchaseId: string;
  supplier: string;
  amount: number;
  note: string | null;
  paidBy: "SUPPLIER" | "SELF" | null;
};

function DailyView() {
  const t = useT();
  const toast = useToast();
  const [date, setDate] = useState(todayIso);
  const [dates, setDates] = useState<string[]>([]);
  const [lines, setLines] = useState<DailyLine[]>([]);
  const [extras, setExtras] = useState<DailyExtra[]>([]);
  const [total, setTotal] = useState(0);
  const [extraTotal, setExtraTotal] = useState(0);

  async function load(d: string) {
    const [report, days] = await Promise.all([
      api<{ total: number; extraExpenseTotal?: number; lines: DailyLine[]; extras?: DailyExtra[] }>(
        `/store/purchases?date=${d}`
      ),
      api<string[]>("/store/purchases/dates"),
    ]);
    setLines(report.lines);
    setExtras(report.extras || []);
    setTotal(report.total);
    setExtraTotal(report.extraExpenseTotal || 0);
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
          {t("store.inventoryValue")} {money(total)}
          {extraTotal > 0 ? ` · ${t("store.extraExpense")} ${money(extraTotal)}` : ""}
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
        {extras.length > 0 && (
          <>
            <h4 style={{ marginTop: "1rem" }}>{t("store.extraExpense")}</h4>
            <table>
              <thead>
                <tr>
                  <th>{t("store.supplier")}</th>
                  <th>{t("store.extraExpenseFor")}</th>
                  <th>{t("store.paid")}</th>
                  <th>{t("common.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {extras.map((e) => (
                  <tr key={e.purchaseId}>
                    <td>{e.supplier}</td>
                    <td>{e.note || "—"}</td>
                    <td>{e.paidBy === "SELF" ? t("store.extraPaidSelf") : t("store.extraPaidSupplier")}</td>
                    <td>{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
