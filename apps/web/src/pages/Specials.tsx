import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, formatKg, gramsToKg, kgToGrams, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { useConfirm } from "../components/ConfirmModal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { DateField } from "../components/DateField";
import { TimeField } from "../components/TimeField";
import { useHotelGate } from "../hotel-gate";
import { loadKitchenStations, type KitchenStationRow } from "../kitchenStations";

type Recipe = { id: string; name: string; category: string };
type SellMode = "BOTH" | "SERVING_ONLY" | "RS_ONLY";

const SERVING_PRESETS = ["Plate", "Glass", "Box", "Bowl", "Cup"] as const;

type SpecialProduct = {
  id: string;
  name: string;
  category: string;
  servingLabel: string;
  sellMode: SellMode;
  platePrice: number;
  /** Separate half-plate Rs; null/0 = no half option */
  halfPlatePrice?: number | null;
  plateGrams: number;
  cookRecipeId: string | null;
  kitchenStation?: string;
  cookRecipe?: { id: string; name: string; category?: string } | null;
  menuItems?: { id: string; name: string; kind: string; sellingPrice: number }[];
};

type TodayProduct = {
  id: string;
  name: string;
  category: string;
  servingLabel: string;
  sellMode: SellMode;
  platePrice: number;
  halfPlatePrice?: number | null;
  plateGrams: number;
  cookRecipeId: string | null;
  batchId: string | null;
  status: string | null;
  openingCarryGrams: number;
  cookedGrams: number;
  soldGrams: number;
  remainingGrams: number;
  remainingPlates: number;
  maxRs: number;
  cookCost?: number;
  soldCost?: number;
  remainingCost?: number;
  soldValue?: number;
  costPerKg?: number;
  cookedByName?: string | null;
  cookedAt?: string | null;
};

type TodayPayload = {
  businessDate: string;
  batchCloseDone: boolean;
  dayCashClosed?: boolean;
  locked?: boolean;
  products: TodayProduct[];
  totals?: {
    cookedGrams: number;
    soldGrams: number;
    remainingGrams: number;
    cookCost: number;
    soldCost: number;
    remainingCost: number;
    soldValue: number;
    wasteGrams: number;
    wasteLoss: number;
    yieldPct: number;
    foodMargin: number;
    openPots: number;
    closedPots: number;
  };
};

type LossRow = {
  businessDate: string;
  name: string;
  wasteGrams: number;
  lossCost: number;
  wasteNote: string | null;
};

type CookIngRow = {
  storeItemId: string;
  name: string;
  unit: string;
  storeUnit: string;
  suggestedQty: number;
  onHand: number;
  qty: string;
};

type CookPreview = {
  specialProductId: string;
  name: string;
  kitchenStation: string;
  recipe: { id: string; name: string; baseUnit: string; baseQty: number };
  ingredients: Omit<CookIngRow, "qty">[];
};

export function SpecialsPage() {
  const { can, user } = useAuth();
  const { gate } = useHotelGate();
  const t = useT();
  const toast = useToast();
  const ask = useConfirm();
  const canManage = can("menu.manage");
  const canCook = can("close.manage", "menu.manage", "store.manage");
  const canRemove =
    user?.roleCode === "ADMIN" && !!gate?.manuallyClosed && canManage;

  const [products, setProducts] = useState<SpecialProduct[]>([]);
  const [today, setToday] = useState<TodayPayload | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [stations, setStations] = useState<KitchenStationRow[]>([]);
  const [loss, setLoss] = useState<{ rows: LossRow[]; totalLoss: number; totalWasteGrams: number } | null>(
    null
  );
  const [lossFrom, setLossFrom] = useState("");
  const [lossTo, setLossTo] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Pakistani Special");
  const [servingLabel, setServingLabel] = useState("Plate");
  const [sellMode, setSellMode] = useState<SellMode>("BOTH");
  /** Full plate Rs */
  const [platePrice, setPlatePrice] = useState("");
  /** Half plate Rs (optional) */
  const [halfPlatePrice, setHalfPlatePrice] = useState("");
  /** One full plate weight in kg (API stores grams). */
  const [plateKg, setPlateKg] = useState("0.25");
  const [cookRecipeId, setCookRecipeId] = useState("");
  const [recipeQ, setRecipeQ] = useState("");
  const [kitchenStation, setKitchenStation] = useState("COOKING");
  const [cookOpen, setCookOpen] = useState(false);
  const [cookProductId, setCookProductId] = useState<string | null>(null);
  const [cookProductName, setCookProductName] = useState("");
  const [cookRecipeName, setCookRecipeName] = useState("");
  const [cookStation, setCookStation] = useState("");
  const [cookFinishedKg, setCookFinishedKg] = useState("");
  const [cookDate, setCookDate] = useState("");
  const [cookTime, setCookTime] = useState("");
  const [cookDayStart, setCookDayStart] = useState("11:00");
  const [cookRolled, setCookRolled] = useState(false);
  const [cookIngs, setCookIngs] = useState<CookIngRow[]>([]);
  const [cookLoading, setCookLoading] = useState(false);

  async function load() {
    try {
      const [prods, day, stationList] = await Promise.all([
        api<SpecialProduct[]>("/specials/products"),
        api<TodayPayload>("/specials/today"),
        loadKitchenStations(),
      ]);
      setProducts(prods);
      setToday(day);
      setStations(stationList);
      if (can("recipe.view", "recipe.manage", "menu.manage")) {
        setRecipes(await api<Recipe[]>("/recipes"));
      }
      if (can("close.view", "reports.view", "menu.manage")) {
        const params = new URLSearchParams();
        if (lossFrom) params.set("from", lossFrom);
        if (lossTo) params.set("to", lossTo);
        setLoss(await api(`/specials/loss?${params}`));
      }
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("specials.loadFailed"), "err");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lossFrom, lossTo]);

  const shown = useMemo(
    () => products.filter((p) => matchesSearch(q, p.name, p.category, p.cookRecipe?.name)),
    [products, q]
  );

  const recipeHits = useMemo(() => {
    const list = recipes.filter((r) => matchesSearch(recipeQ, r.name, r.category));
    return list.slice(0, 12);
  }, [recipes, recipeQ]);

  const selectedRecipe = recipes.find((r) => r.id === cookRecipeId) ?? null;

  function resetForm() {
    setName("");
    setCategory("Pakistani Special");
    setServingLabel("Plate");
    setSellMode("BOTH");
    setPlatePrice("");
    setHalfPlatePrice("");
    setPlateKg("0.25");
    setCookRecipeId("");
    setRecipeQ("");
    setKitchenStation(
      stations.find((s) => s.code === "COOKING")?.code || stations[0]?.code || "COOKING"
    );
    setEditId(null);
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(p: SpecialProduct) {
    setEditId(p.id);
    setName(p.name);
    setCategory(p.category || "Pakistani Special");
    setServingLabel(p.servingLabel || "Plate");
    setSellMode(p.sellMode || "BOTH");
    setPlatePrice(String(p.platePrice));
    setHalfPlatePrice(
      p.halfPlatePrice != null && p.halfPlatePrice > 0 ? String(p.halfPlatePrice) : ""
    );
    setPlateKg(String(gramsToKg(p.plateGrams)));
    setCookRecipeId(p.cookRecipeId || "");
    setRecipeQ(p.cookRecipe ? `${p.cookRecipe.category ? p.cookRecipe.category + " · " : ""}${p.cookRecipe.name}` : "");
    setKitchenStation(p.kitchenStation || "COOKING");
    setOpen(true);
  }

  function pickRecipe(r: Recipe) {
    setCookRecipeId(r.id);
    setRecipeQ(`${r.category} · ${r.name}`);
  }

  function clearRecipe() {
    setCookRecipeId("");
    setRecipeQ("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.push(t("specials.needName"), "err");
      return;
    }
    const price = Number(platePrice);
    const halfRaw = halfPlatePrice.trim();
    const half = halfRaw === "" ? null : Number(halfRaw);
    const kg = Number(plateKg);
    if (!(price > 0)) {
      toast.push(t("specials.needFullPrice"), "err");
      return;
    }
    if (half != null && (!(half > 0) || Number.isNaN(half))) {
      toast.push(t("specials.needHalfPrice"), "err");
      return;
    }
    if (!(kg > 0)) {
      toast.push(t("specials.needPlateKg"), "err");
      return;
    }
    if (!cookRecipeId) {
      toast.push(t("specials.needRecipe"), "err");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        category: category.trim() || "Pakistani Special",
        servingLabel: servingLabel.trim() || "Plate",
        sellMode,
        platePrice: price,
        halfPlatePrice: half,
        plateGrams: kgToGrams(kg),
        cookRecipeId,
        kitchenStation,
      };
      if (editId) {
        await api(`/specials/products/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.push(t("specials.updated"), "ok");
      } else {
        await api("/specials/products", { method: "POST", body: JSON.stringify(body) });
        toast.push(t("specials.added"), "ok");
      }
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("specials.saveFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function removeProduct(p: SpecialProduct) {
    if (!canRemove) {
      toast.push(
        gate?.manuallyClosed ? t("specials.removeAdminOnly") : t("specials.removeAfterClose"),
        "err"
      );
      return;
    }
    const ok = await ask({
      title: t("specials.removeTitle"),
      body: t("specials.removeBody", { name: p.name }),
      confirmLabel: t("specials.removeConfirm"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/specials/products/${p.id}/deactivate`, { method: "POST", body: "{}" });
      toast.push(t("specials.removed"), "ok");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("specials.removeFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function openCook(productId: string) {
    setCookLoading(true);
    setCookOpen(true);
    setCookProductId(productId);
    setCookFinishedKg("");
    setCookIngs([]);
    setCookDate("");
    setCookTime("");
    setCookRolled(false);
    try {
      const [prev, defaults] = await Promise.all([
        api<CookPreview>(`/specials/products/${productId}/cook-ingredients`),
        api<{
          suggestedDate: string;
          suggestedTime: string;
          dayStart: string;
          rolledToNewDay?: boolean;
        }>("/specials/cook-defaults"),
      ]);
      setCookProductName(prev.name);
      setCookRecipeName(prev.recipe.name);
      setCookStation(prev.kitchenStation);
      setCookDate(defaults.suggestedDate);
      setCookTime(defaults.suggestedTime || "06:00");
      setCookDayStart(defaults.dayStart || "11:00");
      setCookRolled(!!defaults.rolledToNewDay);
      setCookIngs(
        prev.ingredients.map((ing) => ({
          ...ing,
          qty: ing.suggestedQty > 0 ? String(ing.suggestedQty) : "",
        }))
      );
    } catch (err) {
      setCookOpen(false);
      setCookProductId(null);
      toast.push(err instanceof Error ? err.message : t("specials.cookFailed"), "err");
    } finally {
      setCookLoading(false);
    }
  }

  function closeCook() {
    setCookOpen(false);
    setCookProductId(null);
    setCookIngs([]);
    setCookFinishedKg("");
    setCookDate("");
    setCookTime("");
    setCookRolled(false);
  }

  async function submitCook() {
    if (!cookProductId) return;
    const kgRaw = cookFinishedKg.trim();
    const kg = Number(kgRaw);
    if (!kgRaw || !Number.isFinite(kg) || kg <= 0) {
      toast.push(t("specials.cookQtyInvalid"), "err");
      return;
    }
    if (!cookDate || !/^\d{4}-\d{2}-\d{2}$/.test(cookDate)) {
      toast.push(t("specials.cookNeedDate"), "err");
      return;
    }
    const ingredients = cookIngs
      .map((ing) => ({
        storeItemId: ing.storeItemId,
        quantity: Number(ing.qty),
        unit: ing.unit,
      }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
    if (!ingredients.length) {
      toast.push(t("specials.cookNeedIngredients"), "err");
      return;
    }
    if (kg > 100) {
      const okHuge = await ask({
        title: t("specials.cookHugeTitle"),
        body: t("specials.cookHugeBody", { kg: String(kg) }),
        confirmLabel: t("specials.logCook"),
        danger: true,
      });
      if (!okHuge) return;
    }
    const timePart = cookTime && /^\d{2}:\d{2}$/.test(cookTime) ? cookTime : "12:00";
    const cookedAt = new Date(`${cookDate}T${timePart}:00`);
    setBusy(true);
    try {
      await api("/specials/cook", {
        method: "POST",
        body: JSON.stringify({
          specialProductId: cookProductId,
          cookedGrams: kgToGrams(kg),
          ingredients,
          businessDate: cookDate,
          cookedAt: Number.isFinite(cookedAt.getTime()) ? cookedAt.toISOString() : undefined,
        }),
      });
      toast.push(t("specials.cookLogged"), "ok");
      closeCook();
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("specials.cookFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("specials.title")}</h1>
          <p>
            {t("specials.subtitle")}
            {today ? ` · ${today.businessDate}` : ""}
          </p>
        </div>
        {canManage && (
          <button type="button" className="btn" onClick={openCreate}>
            {t("specials.addProduct")}
          </button>
        )}
      </div>

      {today?.locked && (
        <div className="panel panel-pad alert-stale banner-row" style={{ marginBottom: "0.85rem" }}>
          <p style={{ margin: 0 }}>{t("specials.lockedHint")}</p>
        </div>
      )}

      {today?.totals && (
        <div className="stats" style={{ marginBottom: "0.85rem" }}>
          <div className="panel stat">
            <span>{t("specials.kpiCooked")}</span>
            <strong>{formatKg(today.totals.cookedGrams)}</strong>
            <span className="tiny">{money(today.totals.cookCost)}</span>
          </div>
          <div className="panel stat">
            <span>{t("specials.kpiSold")}</span>
            <strong>{formatKg(today.totals.soldGrams)}</strong>
            <span className="tiny">
              {money(today.totals.soldValue)} · {t("specials.kpiCost")} {money(today.totals.soldCost)}
            </span>
          </div>
          <div className="panel stat">
            <span>{t("specials.kpiRemaining")}</span>
            <strong>{formatKg(today.totals.remainingGrams)}</strong>
            <span className="tiny">{money(today.totals.remainingCost)}</span>
          </div>
          <div className="panel stat">
            <span>{t("specials.kpiMargin")}</span>
            <strong style={{ color: today.totals.foodMargin < 0 ? "var(--danger)" : "var(--ok)" }}>
              {money(today.totals.foodMargin)}
            </strong>
            <span className="tiny">{t("specials.kpiYield", { n: today.totals.yieldPct })}</span>
          </div>
          <div className={`panel stat ${today.totals.wasteLoss > 0 ? "alert-low" : ""}`}>
            <span>{t("specials.kpiWaste")}</span>
            <strong>{formatKg(today.totals.wasteGrams)}</strong>
            <span className="tiny">{money(today.totals.wasteLoss)}</span>
          </div>
        </div>
      )}

      <div className="panel panel-pad" style={{ marginBottom: "0.85rem" }}>
        <h3 style={{ marginTop: 0 }}>{t("specials.todayCook")}</h3>
        <p className="tiny muted" style={{ marginTop: 0 }}>
          {t("specials.todayHint")}
        </p>
        {today?.batchCloseDone && (
          <p className="tiny" style={{ color: "var(--danger)" }}>
            {t("specials.alreadyClosed")}
          </p>
        )}
        {!today?.products.length ? (
          <div className="empty">{t("specials.noProducts")}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.item")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("specials.carry")}</th>
                  <th>{t("specials.cooked")}</th>
                  <th>{t("specials.sold")}</th>
                  <th>{t("specials.remaining")}</th>
                  <th>{t("specials.kpiCost")}</th>
                  {canCook && <th>{t("specials.cookAction")}</th>}
                </tr>
              </thead>
              <tbody>
                {today.products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <div className="tiny muted">
                        {money(p.platePrice)} / {(p.servingLabel || "Plate").toLowerCase()} ·{" "}
                        {formatKg(p.plateGrams)}
                        {p.costPerKg ? ` · ${money(p.costPerKg)}/${t("common.kg")}` : ""}
                        {p.sellMode === "SERVING_ONLY"
                          ? ` · ${t("specials.sellServingOnly")}`
                          : p.sellMode === "RS_ONLY"
                            ? ` · ${t("specials.sellRsOnly")}`
                            : ""}
                      </div>
                    </td>
                    <td>
                      {p.status === "CLOSED" ? (
                        <span className="badge pending">{t("specials.statusClosed")}</span>
                      ) : p.status === "OPEN" ? (
                        <span className="badge paid">{t("specials.statusOpen")}</span>
                      ) : (
                        <span className="tiny muted">{t("specials.statusIdle")}</span>
                      )}
                    </td>
                    <td>{formatKg(p.openingCarryGrams)}</td>
                    <td>
                      {formatKg(p.cookedGrams)}
                      {(p.cookCost ?? 0) > 0 ? <div className="tiny muted">{money(p.cookCost!)}</div> : null}
                    </td>
                    <td>
                      {formatKg(p.soldGrams)}
                      {(p.soldValue ?? 0) > 0 ? (
                        <div className="tiny muted">{money(p.soldValue!)}</div>
                      ) : null}
                    </td>
                    <td>
                      <strong>{formatKg(p.remainingGrams)}</strong>
                      <div className="tiny muted">
                        ≈ {p.remainingPlates.toFixed(1)} {p.servingLabel || "Plate"}
                      </div>
                    </td>
                    <td className="tiny">
                      {(p.remainingCost ?? 0) > 0 ? money(p.remainingCost!) : "—"}
                    </td>
                    {canCook && (
                      <td>
                        <button
                          type="button"
                          className="btn sm"
                          disabled={busy || today.batchCloseDone || !!today.locked || !p.cookRecipeId}
                          onClick={() => openCook(p.id)}
                        >
                          {t("specials.logCook")}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField value={q} onChange={setQ} placeholder={t("specials.search")} />
      </div>

      <div className="panel panel-pad">
        <h3 style={{ marginTop: 0 }}>{t("specials.products")}</h3>
        <p className="tiny muted" style={{ marginTop: 0 }}>
          {t("specials.setupHint")}
        </p>
        <p className="tiny muted">{t("specials.removePolicy")}</p>
        <table>
          <thead>
            <tr>
              <th>{t("common.item")}</th>
              <th>{t("specials.ratesCol")}</th>
              <th>{t("specials.plateKg")}</th>
              <th>{t("specials.cookRecipe")}</th>
              <th>{t("specials.waiterMenu")}</th>
              {canManage && <th>{t("menu.action")}</th>}
            </tr>
          </thead>
          <tbody>
            {!shown.length && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="empty">
                  {t("specials.noProducts")}
                </td>
              </tr>
            )}
            {shown.map((p) => {
              const specialMenu = p.menuItems?.find((m) => m.kind === "SPECIAL");
              return (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="tiny muted">
                    {p.category} · {p.servingLabel || "Plate"}
                    {p.sellMode === "SERVING_ONLY"
                      ? ` · ${t("specials.sellByRsNo")}`
                      : ` · ${t("specials.sellByRsYes")}`}
                  </div>
                </td>
                <td className="tiny">
                  <div>
                    {t("specials.fullShort")}: <strong>{money(p.platePrice)}</strong>
                  </div>
                  {p.halfPlatePrice != null && p.halfPlatePrice > 0 ? (
                    <div>
                      {t("specials.halfShort")}: <strong>{money(p.halfPlatePrice)}</strong>
                    </div>
                  ) : (
                    <div className="muted">{t("specials.halfNone")}</div>
                  )}
                </td>
                <td>{formatKg(p.plateGrams)}</td>
                <td>
                  {p.cookRecipe
                    ? `${p.cookRecipe.category ? p.cookRecipe.category + " · " : ""}${p.cookRecipe.name}`
                    : "—"}
                </td>
                <td className="tiny">
                  {specialMenu ? (
                    <span style={{ color: "var(--ok, #0a7a4a)", fontWeight: 600 }}>
                      {t("specials.waiterMenuReady", { price: money(specialMenu.sellingPrice) })}
                    </span>
                  ) : (
                    <span className="muted">{t("specials.waiterMenuMissing")}</span>
                  )}
                </td>
                {canManage && (
                  <td>
                    <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
                      <button type="button" className="btn ghost sm" onClick={() => openEdit(p)} disabled={busy}>
                        {t("common.edit")}
                      </button>
                      {canRemove ? (
                        <button
                          type="button"
                          className="btn danger sm"
                          onClick={() => void removeProduct(p)}
                          disabled={busy}
                        >
                          {t("common.remove")}
                        </button>
                      ) : null}
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {can("close.view", "reports.view", "menu.manage") && (
        <div className="panel panel-pad" style={{ marginTop: "0.85rem" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
            <h3 style={{ marginTop: 0 }}>{t("specials.lossTitle")}</h3>
            <div className="row" style={{ gap: "0.5rem" }}>
              <div className="field" style={{ margin: 0, minWidth: "11rem" }}>
                <label htmlFor="sp-loss-from">{t("payments.from")}</label>
                <DateField id="sp-loss-from" value={lossFrom} onChange={setLossFrom} max={lossTo || undefined} />
              </div>
              <div className="field" style={{ margin: 0, minWidth: "11rem" }}>
                <label htmlFor="sp-loss-to">{t("payments.to")}</label>
                <DateField id="sp-loss-to" value={lossTo} onChange={setLossTo} min={lossFrom || undefined} />
              </div>
            </div>
          </div>
          {loss && loss.rows.length > 0 ? (
            <>
              <p className="tiny muted">
                {t("specials.lossTotal")}: {money(loss.totalLoss)} · {formatKg(loss.totalWasteGrams)}
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("close.date")}</th>
                      <th>{t("common.item")}</th>
                      <th>{t("specials.waste")}</th>
                      <th>{t("specials.lossCost")}</th>
                      <th>{t("specials.wasteNote")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loss.rows.slice(0, 60).map((r, i) => (
                      <tr key={`${r.businessDate}-${r.name}-${i}`}>
                        <td>{r.businessDate}</td>
                        <td>{r.name}</td>
                        <td>{formatKg(r.wasteGrams)}</td>
                        <td>{money(r.lossCost)}</td>
                        <td className="tiny">{r.wasteNote || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty">{t("specials.lossEmpty")}</div>
          )}
        </div>
      )}

      <Modal
        open={open}
        title={editId ? t("specials.editProduct") : t("specials.addProduct")}
        onClose={() => {
          setOpen(false);
          resetForm();
        }}
      >
        <form onSubmit={submit}>
          <div className="modal-scroll">
            <p className="tiny muted" style={{ marginTop: 0 }}>
              {t("specials.formHint")}
            </p>
            <div className="field">
              <label>{t("specials.potName")}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("specials.potNamePh")}
                required
              />
            </div>
            <div className="field">
              <label>{t("common.category")}</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="field">
              <label>{t("specials.servingType")}</label>
              <div className="chips" style={{ marginBottom: "0.4rem" }}>
                {SERVING_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`chip ${servingLabel === s ? "active" : ""}`}
                    onClick={() => setServingLabel(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                value={servingLabel}
                onChange={(e) => setServingLabel(e.target.value)}
                placeholder={t("specials.servingTypePh")}
                maxLength={40}
              />
              <p className="tiny muted">{t("specials.servingTypeHint")}</p>
            </div>
            <div className="field">
              <label>{t("specials.sellByRs")}</label>
              <div className="chips">
                <button
                  type="button"
                  className={`chip ${sellMode !== "SERVING_ONLY" ? "active" : ""}`}
                  onClick={() => setSellMode("BOTH")}
                >
                  {t("specials.sellByRsYes")}
                </button>
                <button
                  type="button"
                  className={`chip ${sellMode === "SERVING_ONLY" ? "active" : ""}`}
                  onClick={() => setSellMode("SERVING_ONLY")}
                >
                  {t("specials.sellByRsNo")}
                </button>
              </div>
              <p className="tiny muted">{t("specials.sellByRsHint")}</p>
            </div>
            <div className="grid-2">
              <div className="field">
                <label>{t("specials.fullPlatePrice")}</label>
                <input
                  value={platePrice}
                  onChange={(e) => setPlatePrice(e.target.value)}
                  placeholder="200"
                  required
                  inputMode="decimal"
                />
                <p className="tiny muted">{t("specials.fullPlatePriceHint")}</p>
              </div>
              <div className="field">
                <label>{t("specials.halfPlatePrice")}</label>
                <input
                  value={halfPlatePrice}
                  onChange={(e) => setHalfPlatePrice(e.target.value)}
                  placeholder="120"
                  inputMode="decimal"
                />
                <p className="tiny muted">{t("specials.halfPlatePriceHint")}</p>
              </div>
            </div>
            <div className="field">
              <label>{t("specials.fullPlateKg")}</label>
              <input
                value={plateKg}
                onChange={(e) => setPlateKg(e.target.value)}
                placeholder="0.4"
                inputMode="decimal"
                required
              />
              <p className="tiny muted">{t("specials.fullPlateKgHint")}</p>
            </div>
            <div className="field">
              <label>{t("specials.cookRecipe")}</label>
              <input
                value={recipeQ}
                onChange={(e) => {
                  setRecipeQ(e.target.value);
                  if (cookRecipeId) setCookRecipeId("");
                }}
                placeholder={t("specials.recipeSearchPh")}
                autoComplete="off"
              />
              {selectedRecipe && cookRecipeId ? (
                <div className="row" style={{ marginTop: "0.4rem", gap: "0.5rem", alignItems: "center" }}>
                  <span className="badge">
                    {selectedRecipe.category} · {selectedRecipe.name}
                  </span>
                  <button type="button" className="btn ghost sm" onClick={clearRecipe}>
                    {t("common.clear")}
                  </button>
                </div>
              ) : (
                <div className="suggest-list">
                  {recipeHits.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="suggest-item"
                      onClick={() => pickRecipe(r)}
                    >
                      <strong>{r.name}</strong>
                      <span className="tiny muted">{r.category}</span>
                    </button>
                  ))}
                  {recipeQ.trim() && !recipeHits.length ? (
                    <div className="tiny muted" style={{ padding: "0.5rem 0.65rem" }}>
                      {t("specials.noRecipeMatch")}
                    </div>
                  ) : null}
                </div>
              )}
              <p className="tiny muted">{t("specials.cookRecipeHint")}</p>
            </div>
            <div className="field">
              <label>{t("specials.kitchenStation")}</label>
              <select
                value={kitchenStation}
                onChange={(e) => setKitchenStation(e.target.value)}
              >
                {stations.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="tiny muted">{t("specials.kitchenStationHint")}</p>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? t("common.saving") : editId ? t("menu.update") : t("menu.save")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={cookOpen}
        title={t("specials.cookModalTitle", { name: cookProductName || "…" })}
        onClose={closeCook}
        size="lg"
      >
        {cookLoading ? (
          <p className="tiny muted">{t("common.loading")}</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCook();
            }}
          >
            <div className="modal-scroll">
              <p className="tiny muted" style={{ marginTop: 0 }}>
                {t("specials.cookModalHint")}
                {cookRecipeName ? ` · ${cookRecipeName}` : ""}
                {cookStation ? ` · ${cookStation}` : ""}
              </p>
              <div className="grid-2" style={{ marginBottom: "0.85rem" }}>
                <div className="field">
                  <label>{t("specials.cookForDate")}</label>
                  <DateField
                    id="cook-for-date"
                    value={cookDate}
                    onChange={setCookDate}
                    disabled={busy}
                  />
                </div>
                <div className="field">
                  <label>{t("specials.cookForTime")}</label>
                  <TimeField
                    id="cook-for-time"
                    value={cookTime}
                    onChange={setCookTime}
                    disabled={busy}
                  />
                </div>
              </div>
              <p className="tiny muted" style={{ marginTop: 0 }}>
                {t("specials.cookDateHint", { start: cookDayStart })}
                {cookRolled ? ` · ${t("specials.cookRolledHint")}` : ""}
              </p>
              <h3 style={{ margin: "0.75rem 0 0.5rem", fontSize: "1rem" }}>
                {t("specials.cookIngredientsTitle")}
              </h3>
              {!cookIngs.length ? (
                <div className="empty">{t("specials.cookNoIngredients")}</div>
              ) : (
                <div className="table-wrap" style={{ marginBottom: "1rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t("common.item")}</th>
                        <th>{t("specials.cookGaveQty")}</th>
                        <th>{t("specials.cookKitchenHave")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cookIngs.map((ing) => (
                        <tr key={ing.storeItemId}>
                          <td>
                            <strong>{ing.name}</strong>
                          </td>
                          <td>
                            <label className="cook-log-field" style={{ maxWidth: "10rem" }}>
                              <input
                                className="field-ctrl sm"
                                inputMode="decimal"
                                value={ing.qty}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setCookIngs((rows) =>
                                    rows.map((r) =>
                                      r.storeItemId === ing.storeItemId ? { ...r, qty: v } : r
                                    )
                                  );
                                }}
                                disabled={busy}
                                aria-label={ing.name}
                              />
                              <span className="cook-log-unit">{unitLabel(ing.unit)}</span>
                            </label>
                          </td>
                          <td className="tiny muted">
                            {Math.round(ing.onHand * 1000) / 1000} {unitLabel(ing.storeUnit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="field">
                <label>{t("specials.cookFinishedKg")}</label>
                <label className="cook-log-field" style={{ maxWidth: "12rem" }}>
                  <input
                    className="field-ctrl sm"
                    inputMode="decimal"
                    placeholder="5"
                    value={cookFinishedKg}
                    onChange={(e) => setCookFinishedKg(e.target.value)}
                    disabled={busy}
                    required
                  />
                  <span className="cook-log-unit">{t("common.kg")}</span>
                </label>
                <p className="tiny muted">{t("specials.cookFinishedKgHint")}</p>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn ghost" onClick={closeCook} disabled={busy}>
                {t("common.cancel")}
              </button>
              <button className="btn" type="submit" disabled={busy || cookLoading}>
                {busy ? t("common.saving") : t("specials.logCook")}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
