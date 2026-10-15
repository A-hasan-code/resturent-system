import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  PACK_UNITS,
  api,
  formatStockQty,
  money,
  packUnitLabel,
  unitLabel,
} from "../api";
import { useAuth } from "../auth";
import { useI18n, useT, type MessageKey } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { useConfirm } from "../components/ConfirmModal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { downloadExcelCsv } from "../csv";
import { StorePurchasing } from "./StorePurchasing";
import { StoreDayUse } from "./StoreDayUse";
import { KitchenDayUse } from "./KitchenDayUse";
import { KitchenTransfer } from "./KitchenTransfer";
import { KitchenStationsManage } from "./KitchenStationsManage";
import { sanitizePlainText, sanitizeQty } from "../inputSanitize";

const PAGE_SIZE = 15;

type Item = {
  id: string;
  name: string;
  unit: string;
  packUnit?: string;
  unitsPerPack?: number;
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

const OUT_REASONS: { value: string; key: MessageKey }[] = [
  { value: "Wastage / spoilage", key: "store.outWastage" },
  { value: "Kitchen issue", key: "store.outKitchen" },
  { value: "Staff meal", key: "store.outStaff" },
  { value: "Transfer", key: "store.outTransfer" },
  { value: "Other", key: "store.outOther" },
];

export function StorePage() {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useConfirm();
  const t = useT();
  const { ts } = useI18n();
  const canManage = can("store.manage");
  const [tab, setTab] = useState<
    | "stock"
    | "buy"
    | "suppliers"
    | "daily"
    | "moves"
    | "transfer"
    | "stations"
    | "usage"
    | "kitchenClose"
    | "alerts"
  >("stock");
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
  const [editName, setEditName] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editReorder, setEditReorder] = useState("");
  const [itemId, setItemId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [outReason, setOutReason] = useState(OUT_REASONS[0].value);

  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newUnit, setNewUnit] = useState("KG");
  const [newPackUnit, setNewPackUnit] = useState("NONE");
  const [newUnitsPerPack, setNewUnitsPerPack] = useState("1");
  const [newRate, setNewRate] = useState("");
  const [newQty, setNewQty] = useState("0");
  const [newReorder, setNewReorder] = useState("5");
  const [editPackUnit, setEditPackUnit] = useState("NONE");
  const [editUnitsPerPack, setEditUnitsPerPack] = useState("1");

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
      toast.push(e instanceof Error ? e.message : t("store.loadFailed"), "err");
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
    setOutReason(OUT_REASONS[0].value);
  }

  function openRateEdit(item: FlatItem) {
    setEditItem(item);
    setEditName(item.name);
    setEditRate(String(item.ratePerUnit));
    setEditReorder(String(item.reorderLevel));
    setEditPackUnit(item.packUnit || "NONE");
    setEditUnitsPerPack(String(item.unitsPerPack && item.unitsPerPack > 0 ? item.unitsPerPack : 1));
    setRateOpen(true);
  }

  async function removeItem(item: FlatItem) {
    if (
      !(await ask({
        title: t("store.deleteTitle"),
        body: t("store.deleteConfirm", { name: item.name }),
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ usedInRecipes?: string[] }>(`/store/items/${item.id}`, {
        method: "DELETE",
      });
      toast.push(t("store.deleted"), "ok");
      if (res.usedInRecipes?.length) {
        toast.push(
          t("store.deleteRecipeWarn", { names: res.usedInRecipes.join(", ") }),
          "err"
        );
      }
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("store.deleteFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function saveRate(e: FormEvent) {
    e.preventDefault();
    if (!editItem) return;
    setBusy(true);
    try {
      const packUnit = editPackUnit || "NONE";
      const body: Record<string, unknown> = {
        ratePerUnit: Number(editRate),
        reorderLevel: Number(editReorder),
        packUnit,
        unitsPerPack: packUnit === "NONE" ? 1 : Math.max(1, Number(editUnitsPerPack) || 1),
      };
      if (canManage) {
        const name = editName.trim();
        if (!name) {
          toast.push(t("common.failed"), "err");
          setBusy(false);
          return;
        }
        body.name = name;
      }
      await api(`/store/items/${editItem.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      toast.push(t("store.rateUpdated"), "ok");
      setRateOpen(false);
      setEditItem(null);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function submitMove(e: FormEvent) {
    e.preventDefault();
    if (!moveOpen || !itemId) {
      toast.push(t("store.pickItem"), "err");
      return;
    }
    const amount = Number(qty);
    if (!(amount >= 0) || (moveOpen !== "ADJUST" && !(amount > 0))) {
      toast.push(t("store.badQty"), "err");
      return;
    }
    if (moveOpen === "OUT" && selected && amount > selected.quantityOnHand) {
      toast.push(
        t("store.notEnough", {
          n: `${selected.quantityOnHand} ${unitLabel(selected.unit)}`,
        }),
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
        moveOpen === "OUT" ? t("store.outSaved") : t("store.updated"),
        "ok"
      );
      setMoveOpen(null);
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const packUnit = newPackUnit || "NONE";
      await api("/store/items", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          categoryId: newCat,
          unit: newUnit,
          packUnit,
          unitsPerPack: packUnit === "NONE" ? 1 : Math.max(1, Number(newUnitsPerPack) || 1),
          quantityOnHand: Number(newQty) || 0,
          ratePerUnit: Number(newRate) || 0,
          reorderLevel: Number(newReorder) || 0,
        }),
      });
      toast.push(t("store.itemAdded"), "ok");
      setAddOpen(false);
      setNewName("");
      setNewRate("");
      setNewQty("0");
      setNewPackUnit("NONE");
      setNewUnitsPerPack("1");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("store.addFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const filteredMoves = moves.filter((m) =>
    matchesSearch(q, m.itemName, m.category, m.type, m.note, m.orderNo, m.tableNo)
  );

  const filteredLow = low.filter((i) => matchesSearch(q, i.name, i.category));

  useEffect(() => {
    setPage(1);
  }, [tab, filter, q]);

  const stockTabs = tab === "stock" || tab === "moves" || tab === "alerts";
  const listTotal =
    tab === "stock"
      ? shown.length
      : tab === "moves"
        ? filteredMoves.length
        : tab === "alerts"
          ? filteredLow.length
          : 0;

  const pageStock = paginate(shown, page, PAGE_SIZE);
  const pageMoves = paginate(filteredMoves, page, PAGE_SIZE);
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
    toast.push(t("store.excelOk"), "ok");
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
    toast.push(t("store.excelOk"), "ok");
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
    toast.push(t("store.excelOk"), "ok");
  }

  const moveTitle =
    moveOpen === "IN"
      ? t("store.modalIn")
      : moveOpen === "OUT"
        ? t("store.modalOut")
        : t("store.modalAdjust");

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("store.title")}</h1>
          <p>
            {t("store.stockIn")} · {t("store.tabBuy")} · {t("store.tabKitchenTransfer")} ·{" "}
            {t("store.tabStoreClose")} · {t("store.tabKitchenClose")}
          </p>
        </div>
        <div className="row">
          {(can("store.view") || can("store.manage")) && (
            <>
              <button type="button" className="btn ghost sm" onClick={exportStock}>
                {t("common.excel")} · {t("store.tabList")}
              </button>
              <button type="button" className="btn ghost sm" onClick={exportMoves}>
                {t("common.excel")} · {t("store.tabMoves")}
              </button>
              <button type="button" className="btn ghost sm" onClick={exportUsage}>
                {t("common.excel")} · {t("store.tabUsed")}
              </button>
            </>
          )}
          {can("store.manage") && (
            <>
              <button type="button" className="btn sm" onClick={() => setTab("buy")}>
                {t("store.newPurchase")}
              </button>
              <button type="button" className="btn ok sm" onClick={() => openMove("IN")}>
                {t("store.stockIn")}
              </button>
              <button type="button" className="btn danger sm" onClick={() => openMove("OUT")}>
                {t("store.stockOut")}
              </button>
              <button type="button" className="btn ghost sm" onClick={() => openMove("ADJUST")}>
                {t("store.adjust")}
              </button>
              <button type="button" className="btn sm" onClick={() => setAddOpen(true)}>
                {t("store.addItem")}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <span>{t("common.items")}</span>
          <strong>{summary?.itemCount ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("store.stockValue")}</span>
          <strong>{summary ? money(summary.totalValue) : "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("store.lowStock")}</span>
          <strong>{summary?.lowStockCount ?? "—"}</strong>
        </div>
        <div className="panel stat">
          <span>{t("store.movements")}</span>
          <strong>{moves.length}</strong>
        </div>
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField value={q} onChange={setQ} placeholder={t("store.search")} />
      </div>

      <div className="store-layout">
        <nav className="store-nav" aria-label={t("store.title")}>
          {(
            [
              ["stock", "store.tabList"],
              ["buy", "store.tabBuy"],
              ["suppliers", "store.tabSuppliers"],
              ["daily", "store.tabDaily"],
              ["moves", "store.tabMoves"],
              ["transfer", "store.tabKitchenTransfer"],
              ["stations", "store.tabKitchenStations"],
              ["usage", "store.tabStoreClose"],
              ["kitchenClose", "store.tabKitchenClose"],
              ["alerts", "store.tabLow"],
            ] as const
          ).map(([k, key]) => (
            <div key={k} className="store-nav-group">
              <button
                type="button"
                className={`store-nav-link ${tab === k ? "active" : ""}`}
                onClick={() => setTab(k)}
              >
                {t(key)}
              </button>
              {k === "stock" && tab === "stock" && (
                <div className="store-nav-sub">
                  <button
                    type="button"
                    className={`store-nav-link sub ${filter === "ALL" ? "active" : ""}`}
                    onClick={() => setFilter("ALL")}
                  >
                    {t("common.all")}
                  </button>
                  {cats.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`store-nav-link sub ${filter === c.code ? "active" : ""}`}
                      onClick={() => setFilter(c.code)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="store-main">
          {tab === "stock" && (
            <div className="panel panel-pad">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.category")}</th>
                    <th>{t("common.item")}</th>
                    <th>{t("store.onHand")}</th>
                    <th>{t("common.rate")}</th>
                    <th>{t("common.value")}</th>
                    <th>{t("common.status")}</th>
                    {can("store.manage") && <th>{t("common.actions")}</th>}
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
                        {formatStockQty(i.quantityOnHand, i.unit, i.packUnit, i.unitsPerPack)}
                        {i.packUnit && i.packUnit !== "NONE" && Number(i.unitsPerPack) > 1 ? (
                          <div className="tiny muted">
                            {t("store.packHint", {
                              pack: packUnitLabel(i.packUnit),
                              n: String(i.unitsPerPack),
                              unit: unitLabel(i.unit),
                            })}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {money(i.ratePerUnit)}/{unitLabel(i.unit)}
                      </td>
                      <td>{money(i.stockValue)}</td>
                      <td>
                        {i.lowStock ? (
                          <span className="badge unpaid">{ts("LOW")}</span>
                        ) : (
                          <span className="badge paid">{ts("OK")}</span>
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
                              {t("store.stockIn")}
                            </button>
                            <button
                              type="button"
                              className="btn danger sm"
                              onClick={() => openMove("OUT", i)}
                            >
                              {t("store.stockOut")}
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => openRateEdit(i)}
                            >
                              {t("store.editRate")}
                            </button>
                            <button
                              type="button"
                              className="btn danger sm"
                              disabled={busy}
                              onClick={() => void removeItem(i)}
                            >
                              {t("store.deleteItem")}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && <div className="empty">{t("store.noItems")}</div>}
            </div>
          )}

          {(tab === "buy" || tab === "suppliers" || tab === "daily") && (
            <StorePurchasing
              view={tab}
              items={flat}
              canManage={can("store.manage")}
              onChanged={() => void load()}
            />
          )}

          {tab === "moves" && (
            <div className="panel panel-pad">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.when")}</th>
                    <th>{t("common.type")}</th>
                    <th>{t("common.item")}</th>
                    <th>{t("common.qty")}</th>
                    <th>{t("common.order")}</th>
                    <th>{t("store.reason")}</th>
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
                            m.type === "IN" || m.type === "RESTORE" || m.type === "KITCHEN_RETURN"
                              ? "paid"
                              : m.type === "OUT" ||
                                  m.type === "SALE" ||
                                  m.type === "COOK" ||
                                  m.type === "KITCHEN_TRANSFER" ||
                                  m.type === "KITCHEN_OUT"
                                ? "unpaid"
                                : "pending"
                          }`}
                        >
                          {ts(m.type)}
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
              {!filteredMoves.length && <div className="empty">{t("store.noMoves")}</div>}
            </div>
          )}

          {tab === "transfer" && (
            <KitchenTransfer canManage={can("store.manage")} onChanged={() => void load()} />
          )}

          {tab === "stations" && (
            <KitchenStationsManage canManage={can("store.manage")} onChanged={() => void load()} />
          )}

          {tab === "usage" && <StoreDayUse canManage={can("store.manage")} onChanged={() => void load()} />}

          {tab === "kitchenClose" && (
            <KitchenDayUse canManage={can("store.manage")} onChanged={() => void load()} />
          )}

          {tab === "alerts" && (
            <div className="panel panel-pad">
              {!filteredLow.length ? (
                <div className="empty">{t("store.allOk")}</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{t("common.item")}</th>
                      <th>{t("store.onHand")}</th>
                      <th>{t("store.reorder")}</th>
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
                          {formatStockQty(i.quantityOnHand, i.unit, i.packUnit, i.unitsPerPack)}
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
                              {t("store.stockIn")}
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

          {stockTabs && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={listTotal}
              onChange={setPage}
            />
          )}
        </div>
      </div>

      <Modal open={!!moveOpen} title={moveTitle} onClose={() => setMoveOpen(null)}>
        <form onSubmit={submitMove}>
          <div className="modal-scroll">
          <div className="field">
            <label>{t("store.selectItem")}</label>
            <input
              value={itemSearch}
              onChange={(e) => {
                setItemSearch(e.target.value);
                setItemId("");
              }}
              placeholder={t("store.selectPh")}
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
              {t("store.available")}{" "}
              <strong>
                {selected.quantityOnHand} {unitLabel(selected.unit)}
              </strong>
            </p>
          )}
          <div className="field">
            <label>
              {moveOpen === "ADJUST" ? t("store.newQty") : t("store.quantity")}
            </label>
            <input
              value={qty}
              inputMode="decimal"
              onChange={(e) => setQty(sanitizeQty(e.target.value))}
              required
            />
          </div>
          {moveOpen === "IN" && (
            <>
              <p className="muted tiny">{t("store.stockInHint")}</p>
              <div className="field">
                <label>{t("store.purchaseRate")}</label>
                <input
                  value={rate}
                  inputMode="decimal"
                  onChange={(e) => setRate(sanitizeQty(e.target.value))}
                />
              </div>
            </>
          )}
          {moveOpen === "OUT" && (
            <div className="field">
              <label>{t("store.reason")}</label>
              <select
                value={outReason}
                onChange={(e) => setOutReason(e.target.value)}
              >
                {OUT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {t(r.key)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>{t("store.note")}</label>
            <input
              value={note}
              onChange={(e) => setNote(sanitizePlainText(e.target.value))}
              placeholder={t("store.notePh")}
            />
          </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy || !itemId}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={addOpen} title={t("store.addTitle")} onClose={() => setAddOpen(false)}>
        <form onSubmit={addItem}>
          <div className="modal-scroll">
          <div className="field">
            <label>{t("common.name")}</label>
            <input
              value={newName}
              onChange={(e) => setNewName(sanitizePlainText(e.target.value))}
              required
            />
          </div>
          <div className="field">
            <label>{t("common.category")}</label>
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
              <label>{t("common.unit")}</label>
              <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t("store.reorder")}</label>
              <input
                value={newReorder}
                inputMode="decimal"
                onChange={(e) => setNewReorder(sanitizeQty(e.target.value))}
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>{t("store.packUnit")}</label>
              <select value={newPackUnit} onChange={(e) => setNewPackUnit(e.target.value)}>
                {PACK_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u === "NONE" ? t("store.packUnitNone") : packUnitLabel(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t("store.unitsPerPack")}</label>
              <input
                type="text"
                inputMode="numeric"
                value={newUnitsPerPack}
                disabled={newPackUnit === "NONE"}
                onChange={(e) => setNewUnitsPerPack(sanitizeQty(e.target.value))}
              />
              <span className="tiny muted">{t("store.unitsPerPackHint")}</span>
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>{t("store.openingQty")}</label>
              <input
                value={newQty}
                inputMode="decimal"
                onChange={(e) => setNewQty(sanitizeQty(e.target.value))}
              />
            </div>
            <div className="field">
              <label>{t("store.todayRate")}</label>
              <input
                value={newRate}
                inputMode="decimal"
                onChange={(e) => setNewRate(sanitizeQty(e.target.value))}
                required
              />
            </div>
          </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {t("store.addItemBtn")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={rateOpen}
        title={
          editItem
            ? `${t("store.editRateTitle")} · ${editItem.name}`
            : t("store.editRateTitle")
        }
        onClose={() => {
          setRateOpen(false);
          setEditItem(null);
        }}
      >
        <form className="form" onSubmit={saveRate}>
          <div className="modal-scroll">
          {editItem && (
            <p className="muted">
              {editItem.category} · {t("store.currentStock")}{" "}
              {formatStockQty(
                editItem.quantityOnHand,
                editItem.unit,
                editItem.packUnit,
                editItem.unitsPerPack
              )}
            </p>
          )}
          {canManage && (
            <div className="field">
              <label>{t("common.name")}</label>
              <input
                value={editName}
                onChange={(e) => setEditName(sanitizePlainText(e.target.value))}
                required
              />
            </div>
          )}
          <div className="grid-2">
            <div className="field">
              <label>{t("store.ratePerUnit")}</label>
              <input
                value={editRate}
                onChange={(e) => setEditRate(sanitizeQty(e.target.value))}
                inputMode="decimal"
                required
              />
            </div>
            <div className="field">
              <label>{t("store.reorderLevel")}</label>
              <input
                value={editReorder}
                onChange={(e) => setEditReorder(sanitizeQty(e.target.value))}
                inputMode="decimal"
                required
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>{t("store.packUnit")}</label>
              <select value={editPackUnit} onChange={(e) => setEditPackUnit(e.target.value)}>
                {PACK_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u === "NONE" ? t("store.packUnitNone") : packUnitLabel(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t("store.unitsPerPack")}</label>
              <input
                type="text"
                inputMode="numeric"
                value={editUnitsPerPack}
                disabled={editPackUnit === "NONE"}
                onChange={(e) => setEditUnitsPerPack(sanitizeQty(e.target.value))}
              />
              <span className="tiny muted">{t("store.unitsPerPackHint")}</span>
            </div>
          </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {t("store.saveRate")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
