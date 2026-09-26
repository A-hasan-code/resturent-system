import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { downloadExcelCsv } from "../csv";

const PAGE_SIZE = 15;

type Item = {
  id: string;
  name: string;
  unit: string;
  quantityOnHand: number;
  ratePerUnit: number;
  reorderLevel: number;
  stockValue: number;
  lowStock: boolean;
};

type Cat = { id: string; code: string; name: string; items: Item[] };

type Summary = {
  itemCount: number;
  totalValue: number;
  lowStockCount: number;
};

type Movement = {
  id: string;
  type: string;
  quantity: number;
  usedQty?: number;
  ratePerUnit: number | null;
  value?: number | null;
  note: string | null;
  reason?: string | null;
  createdAt: string;
  itemName: string;
  unit: string;
  category: string;
  orderNo?: number | null;
  tableNo?: string | null;
};

type UsageRow = {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  totalUsed: number;
  totalValue: number;
  orderCount: number;
  orderNos: string;
};

type FlatItem = Item & { category: string; categoryCode: string };

const UNITS = ["KG", "G", "L", "ML", "PCS"] as const;
const OUT_REASONS = [
  "Wastage / spoilage",
  "Kitchen issue",
  "Staff meal",
  "Transfer",
  "Other",
];

export function StorePage() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<"stock" | "moves" | "usage" | "alerts">("stock");
  const [cats, setCats] = useState<Cat[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [low, setLow] = useState<(Item & { category?: string })[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState<"IN" | "OUT" | "ADJUST" | null>(null);
  const [rateOpen, setRateOpen] = useState(false);
  const [editItem, setEditItem] = useState<FlatItem | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editReorder, setEditReorder] = useState("");
  const [itemId, setItemId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [outReason, setOutReason] = useState(OUT_REASONS[0]);

  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newUnit, setNewUnit] = useState("KG");
  const [newRate, setNewRate] = useState("");
  const [newQty, setNewQty] = useState("0");
  const [newReorder, setNewReorder] = useState("5");

  async function load() {
    try {
      const [c, s, m, l, u] = await Promise.all([
        api<Cat[]>("/store/categories"),
        api<Summary>("/store/summary"),
        api<Movement[]>("/store/movements?limit=500"),
        api<(Item & { category: string })[]>("/store/low-stock"),
        api<UsageRow[]>("/store/usage"),
      ]);
      setCats(c);
      setSummary(s);
      setMoves(m);
      setLow(l);
      setUsage(u);
      if (!newCat && c[0]) setNewCat(c[0].id);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Inventory load failed", "err");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const flat = useMemo(
    () =>
      cats.flatMap((c) =>
        c.items.map((i) => ({ ...i, category: c.name, categoryCode: c.code }))
      ),
    [cats]
  );

  const selected = flat.find((i) => i.id === itemId);

  const shown = flat.filter((i) => {
    if (filter !== "ALL" && i.categoryCode !== filter) return false;
    return matchesSearch(
      q,
      i.name,
      i.category,
      i.unit,
      unitLabel(i.unit),
      i.ratePerUnit,
      i.quantityOnHand,
      i.lowStock ? "low" : "ok"
    );
  });

  const moveItems = flat.filter((i) =>
    matchesSearch(itemSearch, i.name, i.category)
  );

  function openMove(type: "IN" | "OUT" | "ADJUST", item?: FlatItem) {
    setMoveOpen(type);
    setItemId(item?.id || "");
    setItemSearch(item ? `${item.category} · ${item.name}` : "");
    setQty("");
    setRate(item ? String(item.ratePerUnit) : "");
    setNote("");
    setOutReason(OUT_REASONS[0]);
  }

  function openRateEdit(item: FlatItem) {
    setEditItem(item);
    setEditRate(String(item.ratePerUnit));
    setEditReorder(String(item.reorderLevel));
    setRateOpen(true);
  }

  async function saveRate(e: FormEvent) {
    e.preventDefault();
    if (!editItem) return;
    setBusy(true);
    try {
      await api(`/store/items/${editItem.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ratePerUnit: Number(editRate),
          reorderLevel: Number(editReorder),
        }),
      });
      toast.push("Rate / reorder updated", "ok");
      setRateOpen(false);
      setEditItem(null);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Update failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function submitMove(e: FormEvent) {
    e.preventDefault();
    if (!moveOpen || !itemId) {
      toast.push("Select an item", "err");
      return;
    }
    const amount = Number(qty);
    if (!(amount >= 0) || (moveOpen !== "ADJUST" && !(amount > 0))) {
      toast.push("Sahi quantity likhein", "err");
      return;
    }
    if (moveOpen === "OUT" && selected && amount > selected.quantityOnHand) {
      toast.push(
        `Stock kam hai. Available: ${selected.quantityOnHand} ${unitLabel(selected.unit)}`,
        "err"
      );
      return;
    }
    setBusy(true);
    try {
      if (moveOpen === "IN") {
        await api(`/store/items/${itemId}/stock-in`, {
          method: "POST",
          body: JSON.stringify({
            quantity: amount,
            ratePerUnit: rate ? Number(rate) : undefined,
            note: note || "Purchase / stock in",
          }),
        });
      } else if (moveOpen === "OUT") {
        await api(`/store/items/${itemId}/stock-out`, {
          method: "POST",
          body: JSON.stringify({
            quantity: amount,
            note: note || outReason,
          }),
        });
      } else {
        await api(`/store/items/${itemId}/adjust`, {
          method: "POST",
          body: JSON.stringify({
            newQuantity: amount,
            note: note || "Physical count adjust",
          }),
        });
      }
      toast.push(
        moveOpen === "OUT" ? "Stock out saved" : "Inventory updated",
        "ok"
      );
      setMoveOpen(null);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Update failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/store/items", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          categoryId: newCat,
          unit: newUnit,
          quantityOnHand: Number(newQty) || 0,
          ratePerUnit: Number(newRate) || 0,
          reorderLevel: Number(newReorder) || 0,
        }),
      });
      toast.push("Item added", "ok");
      setAddOpen(false);
      setNewName("");
      setNewRate("");
      setNewQty("0");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Add failed", "err");
    } finally {
      setBusy(false);
    }
  }

  const filteredMoves = moves.filter((m) =>
    matchesSearch(q, m.itemName, m.category, m.type, m.note, m.orderNo, m.tableNo)
  );

  const filteredUsage = usage.filter((u) =>
    matchesSearch(q, u.itemName, u.category, u.orderNos)
  );

  const filteredLow = low.filter((i) => matchesSearch(q, i.name, i.category));

  useEffect(() => {
    setPage(1);
  }, [tab, filter, q]);

  const listTotal =
    tab === "stock"
      ? shown.length
      : tab === "moves"
        ? filteredMoves.length
        : tab === "usage"
          ? filteredUsage.length
          : filteredLow.length;

  const pageStock = paginate(shown, page, PAGE_SIZE);
  const pageMoves = paginate(filteredMoves, page, PAGE_SIZE);
  const pageUsage = paginate(filteredUsage, page, PAGE_SIZE);
  const pageLow = paginate(filteredLow, page, PAGE_SIZE);

  function exportStock() {
    downloadExcelCsv(
      `inventory-stock-${Date.now()}.csv`,
      flat.map((i) => ({
        Category: i.category,
        Item: i.name,
        OnHand: i.quantityOnHand,
        Unit: i.unit,
        Rate: i.ratePerUnit,
        Value: i.stockValue,
        ReorderLevel: i.reorderLevel,
        Status: i.lowStock ? "LOW" : "OK",
      }))
    );
    toast.push("Stock Excel downloaded", "ok");
  }

  function exportMoves() {
    downloadExcelCsv(
      `inventory-movements-${Date.now()}.csv`,
      moves.map((m) => ({
        Date: new Date(m.createdAt).toLocaleString("en-PK"),
        Type: m.type,
        Item: m.itemName,
        Category: m.category,
        Qty: m.quantity,
        Unit: m.unit,
        Rate: m.ratePerUnit ?? "",
        Value: m.value ?? "",
        OrderNo: m.orderNo ?? "",
        Table: m.tableNo ?? "",
        Reason: m.note ?? "",
      }))
    );
    toast.push("Movements Excel downloaded", "ok");
  }

  function exportUsage() {
    downloadExcelCsv(
      `stock-used-by-orders-${Date.now()}.csv`,
      usage.map((u) => ({
        Item: u.itemName,
        Category: u.category,
        TotalUsed: u.totalUsed,
        Unit: u.unit,
        ApproxValue: u.totalValue,
        OrdersCount: u.orderCount,
        OrderNos: u.orderNos,
      }))
    );
    toast.push("Usage Excel downloaded", "ok");
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p>Stock in · Stock out · Adjust · Ledger · Search</p>
        </div>
        <div className="row">
          {(can("store.view") || can("store.manage")) && (
            <>
              <button type="button" className="btn ghost sm" onClick={exportStock}>
                Excel · Stock
              </button>
              <button type="button" className="btn ghost sm" onClick={exportMoves}>
                Excel · Moves
              </button>
              <button type="button" className="btn ghost sm" onClick={exportUsage}>
                Excel · Used
              </button>
            </>
          )}
          {can("store.manage") && (
            <>
              <button type="button" className="btn ok sm" onClick={() => openMove("IN")}>
                Stock in
              </button>
              <button type="button" className="btn warn sm" onClick={() => openMove("OUT")}>
                Stock out
              </button>
              <button type="button" className="btn ghost sm" onClick={() => openMove("ADJUST")}>
                Adjust
              </button>
              <button type="button" className="btn sm" onClick={() => setAddOpen(true)}>
                + Item
              </button>
            </>
          )}
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>Items</span>
          <strong>{summary?.itemCount ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Stock value</span>
          <strong>{summary ? money(summary.totalValue) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Low stock</span>
          <strong>{summary?.lowStockCount ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>Movements</span>
          <strong>{moves.length}</strong>
        </div>
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField value={q} onChange={setQ} placeholder="Search item, category, movement…" />
      </div>

      <div className="chips">
        {(
          [
            ["stock", "Stock list"],
            ["moves", "Movements"],
            ["usage", "Used by orders"],
            ["alerts", "Low stock"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`chip ${tab === k ? "active" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <>
          <div className="chips">
            <button
              type="button"
              className={`chip ${filter === "ALL" ? "active" : ""}`}
              onClick={() => setFilter("ALL")}
            >
              All
            </button>
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${filter === c.code ? "active" : ""}`}
                onClick={() => setFilter(c.code)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="panel panel-pad">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Item</th>
                  <th>On hand</th>
                  <th>Rate</th>
                  <th>Value</th>
                  <th>Status</th>
                  {can("store.manage") && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {pageStock.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className="badge">{i.category}</span>
                    </td>
                    <td>{i.name}</td>
                    <td>
                      {i.quantityOnHand} {unitLabel(i.unit)}
                    </td>
                    <td>
                      {money(i.ratePerUnit)}/{unitLabel(i.unit)}
                    </td>
                    <td>{money(i.stockValue)}</td>
                    <td>
                      {i.lowStock ? (
                        <span className="badge unpaid">LOW</span>
                      ) : (
                        <span className="badge paid">OK</span>
                      )}
                    </td>
                    {can("store.manage") && (
                      <td>
                        <div className="row">
                          <button
                            type="button"
                            className="btn ok sm"
                            onClick={() => openMove("IN", i)}
                          >
                            Stock in
                          </button>
                          <button
                            type="button"
                            className="btn warn sm"
                            onClick={() => openMove("OUT", i)}
                          >
                            Stock out
                          </button>
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => openRateEdit(i)}
                          >
                            Edit rate
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <div className="empty">No matching items</div>}
          </div>
        </>
      )}

      {tab === "moves" && (
        <div className="panel panel-pad">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Order</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {pageMoves.map((m) => (
                <tr key={m.id}>
                  <td className="tiny">
                    {new Date(m.createdAt).toLocaleString("en-PK")}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        m.type === "IN"
                          ? "paid"
                          : m.type === "OUT" || m.type === "SALE"
                            ? "unpaid"
                            : "pending"
                      }`}
                    >
                      {m.type}
                    </span>
                  </td>
                  <td>
                    {m.itemName}
                    <div className="tiny muted">{m.category}</div>
                  </td>
                  <td>
                    {m.quantity > 0 ? "+" : ""}
                    {m.quantity} {unitLabel(m.unit)}
                  </td>
                  <td>
                    {m.orderNo != null ? (
                      <>
                        #{m.orderNo}
                        <div className="tiny muted">{m.tableNo || ""}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="tiny">{m.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredMoves.length && <div className="empty">No movements</div>}
        </div>
      )}

      {tab === "usage" && (
        <div className="panel panel-pad">
          <p className="muted" style={{ marginTop: 0 }}>
            Stock used automatically from orders (SALE). Download Excel anytime.
          </p>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Used</th>
                <th>Value</th>
                <th>Orders</th>
                <th>Order #s</th>
              </tr>
            </thead>
            <tbody>
              {pageUsage.map((u) => (
                <tr key={u.itemId}>
                  <td>
                    {u.itemName}
                    <div className="tiny muted">{u.category}</div>
                  </td>
                  <td>
                    {u.totalUsed} {unitLabel(u.unit)}
                  </td>
                  <td>{money(u.totalValue)}</td>
                  <td>{u.orderCount}</td>
                  <td className="tiny">{u.orderNos || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredUsage.length && (
            <div className="empty">No stock used from orders yet</div>
          )}
        </div>
      )}

      {tab === "alerts" && (
        <div className="panel panel-pad">
          {!filteredLow.length ? (
            <div className="empty">All items above reorder level</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>On hand</th>
                  <th>Reorder</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageLow.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name}
                      <div className="tiny muted">{i.category}</div>
                    </td>
                    <td>
                      {i.quantityOnHand} {unitLabel(i.unit)}
                    </td>
                    <td>
                      {i.reorderLevel} {unitLabel(i.unit)}
                    </td>
                    <td>
                      {can("store.manage") && (
                        <button
                          type="button"
                          className="btn ok sm"
                          onClick={() =>
                            openMove("IN", {
                              ...i,
                              category: i.category || "",
                              categoryCode: "",
                              stockValue: 0,
                              lowStock: true,
                            })
                          }
                        >
                          Stock in
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={listTotal}
        onChange={setPage}
      />

      <Modal
        open={!!moveOpen}
        title={
          moveOpen === "IN"
            ? "Stock in (purchase)"
            : moveOpen === "OUT"
              ? "Stock out"
              : "Adjust count"
        }
        onClose={() => setMoveOpen(null)}
      >
        <form onSubmit={submitMove}>
          <div className="field">
            <label>Search & select item</label>
            <input
              value={itemSearch}
              onChange={(e) => {
                setItemSearch(e.target.value);
                setItemId("");
              }}
              placeholder="Type chicken, oil…"
            />
            <div className="suggest-list">
              {moveItems.slice(0, 8).map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className={`suggest-item ${itemId === i.id ? "active" : ""}`}
                  onClick={() => {
                    setItemId(i.id);
                    setItemSearch(`${i.category} · ${i.name}`);
                    setRate(String(i.ratePerUnit));
                  }}
                >
                  <strong>{i.name}</strong>
                  <span className="tiny muted">
                    {i.category} · {i.quantityOnHand} {unitLabel(i.unit)} ·{" "}
                    {money(i.ratePerUnit)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {selected && (
            <p className="muted tiny">
              Available: <strong>{selected.quantityOnHand} {unitLabel(selected.unit)}</strong>
            </p>
          )}
          <div className="field">
            <label>
              {moveOpen === "ADJUST" ? "New quantity" : "Quantity"}
            </label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} required />
          </div>
          {moveOpen === "IN" && (
            <div className="field">
              <label>Purchase rate (today rate)</label>
              <input value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          )}
          {moveOpen === "OUT" && (
            <div className="field">
              <label>Reason</label>
              <select
                value={outReason}
                onChange={(e) => setOutReason(e.target.value)}
              >
                {OUT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Note</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional detail"
            />
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || !itemId}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={addOpen} title="Add inventory item" onClose={() => setAddOpen(false)}>
        <form onSubmit={addItem}>
          <div className="field">
            <label>Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={newCat} onChange={(e) => setNewCat(e.target.value)} required>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Unit</label>
              <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Reorder level</label>
              <input value={newReorder} onChange={(e) => setNewReorder(e.target.value)} />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Opening qty</label>
              <input value={newQty} onChange={(e) => setNewQty(e.target.value)} />
            </div>
            <div className="field">
              <label>Today rate</label>
              <input value={newRate} onChange={(e) => setNewRate(e.target.value)} required />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              Add item
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={rateOpen}
        title={editItem ? `Edit rate · ${editItem.name}` : "Edit rate"}
        onClose={() => {
          setRateOpen(false);
          setEditItem(null);
        }}
      >
        <form className="form" onSubmit={saveRate}>
          {editItem && (
            <p className="muted">
              {editItem.category} · Current stock {editItem.quantityOnHand}{" "}
              {unitLabel(editItem.unit)}
            </p>
          )}
          <div className="grid-2">
            <div className="field">
              <label>Rate per {editItem ? unitLabel(editItem.unit) : "unit"} (Rs)</label>
              <input
                value={editRate}
                onChange={(e) => setEditRate(e.target.value)}
                type="number"
                step="0.01"
                min="0"
                required
              />
            </div>
            <div className="field">
              <label>Low stock alert level</label>
              <input
                value={editReorder}
                onChange={(e) => setEditReorder(e.target.value)}
                type="number"
                step="0.01"
                min="0"
                required
              />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              Save rate
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
