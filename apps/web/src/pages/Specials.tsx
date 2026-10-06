import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, formatKg, gramsToKg, kgToGrams, money } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { useConfirm } from "../components/ConfirmModal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { useHotelGate } from "../hotel-gate";

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
  plateGrams: number;
  cookRecipeId: string | null;
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
};

type TodayPayload = {
  businessDate: string;
  batchCloseDone: boolean;
  products: TodayProduct[];
};

type LossRow = {
  businessDate: string;
  name: string;
  wasteGrams: number;
  lossCost: number;
  wasteNote: string | null;
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
  const [loss, setLoss] = useState<{ rows: LossRow[]; totalLoss: number; totalWasteGrams: number } | null>(
    null
  );
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Pakistani Special");
  const [servingLabel, setServingLabel] = useState("Plate");
  const [sellMode, setSellMode] = useState<SellMode>("BOTH");
  const [platePrice, setPlatePrice] = useState("");
  /** One serving weight in kg (API still stores grams). */
  const [plateKg, setPlateKg] = useState("0.25");
  const [cookRecipeId, setCookRecipeId] = useState("");
  const [recipeQ, setRecipeQ] = useState("");
  const [cookKg, setCookKg] = useState<Record<string, string>>({});

  async function load() {
    try {
      const [prods, day] = await Promise.all([
        api<SpecialProduct[]>("/specials/products"),
        api<TodayPayload>("/specials/today"),
      ]);
      setProducts(prods);
      setToday(day);
      if (can("recipe.view", "recipe.manage", "menu.manage")) {
        setRecipes(await api<Recipe[]>("/recipes"));
      }
      if (can("close.view", "reports.view", "menu.manage")) {
        setLoss(await api("/specials/loss"));
      }
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("specials.loadFailed"), "err");
    }
  }

  useEffect(() => {
    load();
  }, []);

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
    setPlateKg("0.25");
    setCookRecipeId("");
    setRecipeQ("");
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
    setPlateKg(String(gramsToKg(p.plateGrams)));
    setCookRecipeId(p.cookRecipeId || "");
    setRecipeQ(p.cookRecipe ? `${p.cookRecipe.category ? p.cookRecipe.category + " · " : ""}${p.cookRecipe.name}` : "");
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
    const kg = Number(plateKg);
    if (!(price > 0)) {
      toast.push(t("specials.needPrice"), "err");
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
        plateGrams: kgToGrams(kg),
        cookRecipeId,
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

  async function cook(productId: string) {
    const kgRaw = cookKg[productId]?.trim();
    const kg = Number(kgRaw);
    if (!kgRaw || !Number.isFinite(kg) || kg <= 0) {
      toast.push(t("specials.cookQtyInvalid"), "err");
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
    setBusy(true);
    try {
      await api("/specials/cook", {
        method: "POST",
        body: JSON.stringify({
          specialProductId: productId,
          cookedGrams: kgToGrams(kg),
        }),
      });
      toast.push(t("specials.cookLogged"), "ok");
      setCookKg((s) => ({ ...s, [productId]: "" }));
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
                  <th>{t("specials.carry")}</th>
                  <th>{t("specials.cooked")}</th>
                  <th>{t("specials.sold")}</th>
                  <th>{t("specials.remaining")}</th>
                  {canCook && (
                    <th>
                      {t("specials.cookAction")} ({t("common.kg")})
                    </th>
                  )}
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
                        {p.sellMode === "SERVING_ONLY"
                          ? ` · ${t("specials.sellServingOnly")}`
                          : p.sellMode === "RS_ONLY"
                            ? ` · ${t("specials.sellRsOnly")}`
                            : ""}
                      </div>
                    </td>
                    <td>{formatKg(p.openingCarryGrams)}</td>
                    <td>{formatKg(p.cookedGrams)}</td>
                    <td>{formatKg(p.soldGrams)}</td>
                    <td>
                      <strong>{formatKg(p.remainingGrams)}</strong>
                      <div className="tiny muted">
                        ≈ {p.remainingPlates.toFixed(1)} {p.servingLabel || "Plate"}
                      </div>
                    </td>
                    {canCook && (
                      <td>
                        <div className="cook-log">
                          <label className="cook-log-field">
                            <input
                              className="field-ctrl sm"
                              inputMode="decimal"
                              placeholder="5"
                              value={cookKg[p.id] ?? ""}
                              onChange={(e) => setCookKg((s) => ({ ...s, [p.id]: e.target.value }))}
                              disabled={busy || today.batchCloseDone}
                              title={t("specials.cookKgPh")}
                              aria-label={t("specials.cookKgPh")}
                            />
                            <span className="cook-log-unit">{t("common.kg")}</span>
                          </label>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={busy || today.batchCloseDone}
                            onClick={() => cook(p.id)}
                          >
                            {t("specials.logCook")}
                          </button>
                        </div>
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
              <th>{t("specials.plateSell")}</th>
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
                      ? ` · ${t("specials.sellServingOnly")}`
                      : p.sellMode === "RS_ONLY"
                        ? ` · ${t("specials.sellRsOnly")}`
                        : ` · ${t("specials.sellBoth")}`}
                  </div>
                </td>
                <td>{money(p.platePrice)}</td>
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

      {loss && loss.rows.length > 0 && (
        <div className="panel panel-pad" style={{ marginTop: "0.85rem" }}>
          <h3 style={{ marginTop: 0 }}>{t("specials.lossTitle")}</h3>
          <p className="tiny muted">
            {t("specials.lossTotal")}: {money(loss.totalLoss)} · {formatKg(loss.totalWasteGrams)}
          </p>
          <table>
            <thead>
              <tr>
                <th>{t("close.date")}</th>
                <th>{t("common.item")}</th>
                <th>{t("specials.waste")}</th>
                <th>{t("specials.lossCost")}</th>
              </tr>
            </thead>
            <tbody>
              {loss.rows.slice(0, 30).map((r, i) => (
                <tr key={`${r.businessDate}-${r.name}-${i}`}>
                  <td>{r.businessDate}</td>
                  <td>{r.name}</td>
                  <td>{formatKg(r.wasteGrams)}</td>
                  <td>{money(r.lossCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
              <label>{t("specials.sellMode")}</label>
              <div className="chips">
                {(
                  [
                    ["BOTH", "specials.sellBoth"],
                    ["SERVING_ONLY", "specials.sellServingOnly"],
                    ["RS_ONLY", "specials.sellRsOnly"],
                  ] as const
                ).map(([mode, key]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`chip ${sellMode === mode ? "active" : ""}`}
                    onClick={() => setSellMode(mode)}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
              <p className="tiny muted">{t("specials.sellModeHint", { unit: servingLabel || "Plate" })}</p>
            </div>
            <div className="grid-2">
              <div className="field">
                <label>{t("specials.servingSell", { unit: servingLabel || "Plate" })}</label>
                <input
                  value={platePrice}
                  onChange={(e) => setPlatePrice(e.target.value)}
                  placeholder="250"
                  required
                />
                <p className="tiny muted">{t("specials.servingSellHint", { unit: (servingLabel || "Plate").toLowerCase() })}</p>
              </div>
              <div className="field">
                <label>{t("specials.servingKg", { unit: servingLabel || "Plate" })}</label>
                <input
                  value={plateKg}
                  onChange={(e) => setPlateKg(e.target.value)}
                  placeholder="0.4"
                  inputMode="decimal"
                  required
                />
                <p className="tiny muted">{t("specials.servingKgHint", { unit: (servingLabel || "Plate").toLowerCase() })}</p>
              </div>
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
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? t("common.saving") : editId ? t("menu.update") : t("menu.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
