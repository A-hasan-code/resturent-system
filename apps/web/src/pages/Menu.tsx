import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatKg, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { useConfirm } from "../components/ConfirmModal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";
import { listPriceLabel } from "../menuQty";

type KitchenStation = "BEVERAGES" | "COOKING" | "BBQ";
type MenuKind = "NORMAL" | "SPECIAL" | "MIX";
type FormKind = "NORMAL" | "MIX";
type KindFilter = "ALL" | MenuKind;

type SpecialProduct = {
  id: string;
  name: string;
  category: string;
  platePrice: number;
  plateGrams: number;
};

type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  kitchenStation?: KitchenStation | null;
  kind?: MenuKind;
  sellUnit: string;
  sellingPrice: number;
  listPortionQty?: number;
  listAmount?: number;
  costPerUnit: number;
  recipeId: string | null;
  recipe?: { id: string; name: string; category: string | null; baseUnit: string } | null;
  specialProductId?: string | null;
  mixSpecialPlates?: number | null;
  specialProduct?: SpecialProduct | null;
  minQty?: number;
  maxQty?: number | null;
  qtyStep?: number | null;
  allowCustomQty?: boolean;
  modifiers?: { id: string; name: string; priceDelta: number; sortOrder?: number }[];
};

type ModDraft = { name: string; priceDelta: string };

type Recipe = { id: string; name: string; category: string; baseUnit: string };
type RecipeCat = { id: string; name: string };

const UNITS = ["KG", "G", "L", "ML", "PCS"] as const;
const STATIONS: KitchenStation[] = ["BEVERAGES", "COOKING", "BBQ"];
const PAGE_SIZE = 10;

function defaultPriceBasis(unit: string) {
  if (unit === "KG" || unit === "L") return "1000";
  return "";
}

function resolveRatePerSellUnit(unit: string, amount: number, basis: number) {
  if (!(amount > 0) || !(basis > 0)) return null;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  if (unit === "KG") return round2(amount * (1000 / basis));
  if (unit === "L") return round2(amount * (1000 / basis));
  if (unit === "G" || unit === "ML" || unit === "PCS") return round2(amount / basis);
  return round2(amount / basis);
}

function portionInSellUnit(unit: string, basis: number) {
  if (!(basis > 0)) return null;
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  if (unit === "KG" || unit === "L") return round3(basis / 1000);
  return round3(basis);
}

export function MenuPage() {
  const { can } = useAuth();
  const toast = useToast();
  const t = useT();
  const ask = useConfirm();
  const [rows, setRows] = useState<MenuItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [cats, setCats] = useState<RecipeCat[]>([]);
  const [specials, setSpecials] = useState<SpecialProduct[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formKind, setFormKind] = useState<FormKind>("NORMAL");
  const [catOpen, setCatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  const [newCatName, setNewCatName] = useState("");

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Karahi");
  const [kitchenStation, setKitchenStation] = useState<KitchenStation>("COOKING");
  const [sellUnit, setSellUnit] = useState("KG");
  const [price, setPrice] = useState("");
  const [priceBasis, setPriceBasis] = useState("1000");
  const [minQty, setMinQty] = useState("0");
  const [maxQty, setMaxQty] = useState("");
  const [qtyStep, setQtyStep] = useState("");
  const [allowCustomQty, setAllowCustomQty] = useState(true);
  const [recipeId, setRecipeId] = useState("");
  const [specialProductId, setSpecialProductId] = useState("");
  const [mixPlates, setMixPlates] = useState("1");
  const [recipeQ, setRecipeQ] = useState("");
  const [modDrafts, setModDrafts] = useState<ModDraft[]>([]);

  async function load() {
    try {
      const [menu, recipeCats] = await Promise.all([
        api<MenuItem[]>("/menu"),
        api<RecipeCat[]>("/recipes/categories"),
      ]);
      setRows(menu);
      setCats(recipeCats);
      if (recipeCats[0]) setCategory((c) => c || recipeCats[0].name);
      if (can("menu.manage", "recipe.view", "recipe.manage")) {
        setRecipes(await api<Recipe[]>("/recipes"));
      }
      if (can("menu.manage", "close.manage", "store.manage")) {
        try {
          setSpecials(await api<SpecialProduct[]>("/specials/products"));
        } catch {
          setSpecials([]);
        }
      }
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("menu.loadFailed"), "err");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const kindOrder: Record<MenuKind, number> = { NORMAL: 0, SPECIAL: 1, MIX: 2 };
    return rows
      .filter((m) => {
        const kind = (m.kind || "NORMAL") as MenuKind;
        if (kindFilter !== "ALL" && kind !== kindFilter) return false;
        return matchesSearch(
          q,
          m.name,
          m.category,
          m.sellUnit,
          kind,
          m.specialProduct?.name
        );
      })
      .sort((a, b) => {
        const ka = kindOrder[(a.kind || "NORMAL") as MenuKind];
        const kb = kindOrder[(b.kind || "NORMAL") as MenuKind];
        if (ka !== kb) return ka - kb;
        return a.name.localeCompare(b.name);
      });
  }, [rows, q, kindFilter]);

  const kindCounts = useMemo(() => {
    const c = { ALL: rows.length, NORMAL: 0, SPECIAL: 0, MIX: 0 };
    for (const m of rows) {
      const k = (m.kind || "NORMAL") as MenuKind;
      c[k] += 1;
    }
    return c;
  }, [rows]);

  const catSuggestions = useMemo(
    () => cats.filter((c) => matchesSearch(category, c.name)).slice(0, 12),
    [cats, category]
  );

  const recipeSuggestions = useMemo(() => {
    const list = recipeQ.trim()
      ? recipes.filter((r) => matchesSearch(recipeQ, r.name, r.category))
      : recipes;
    return list.slice(0, 14);
  }, [recipes, recipeQ]);

  const selectedRecipe = useMemo(
    () => recipes.find((r) => r.id === recipeId) || null,
    [recipes, recipeId]
  );

  const selectedSpecial = useMemo(
    () => specials.find((p) => p.id === specialProductId) || null,
    [specials, specialProductId]
  );
  useEffect(() => {
    setPage(1);
  }, [q, kindFilter]);

  const pageRows = paginate(shown, page, PAGE_SIZE);

  async function saveModifiers(menuItemId: string) {
    const rows = modDrafts
      .map((r, i) => ({
        name: r.name.trim(),
        priceDelta: Math.round((Number(r.priceDelta) || 0) * 100) / 100,
        sortOrder: i,
      }))
      .filter((r) => r.name);
    await api(`/menu/${menuItemId}/modifiers`, {
      method: "PUT",
      body: JSON.stringify({ modifiers: rows }),
    });
  }

  const groupedPage = useMemo(() => {
    if (kindFilter !== "ALL") return null;
    const order: MenuKind[] = ["NORMAL", "SPECIAL", "MIX"];
    return order
      .map((kind) => ({
        kind,
        items: pageRows.filter((m) => (m.kind || "NORMAL") === kind),
      }))
      .filter((g) => g.items.length > 0);
  }, [kindFilter, pageRows]);

  const portionCheck = useMemo(() => {
    const amount = Number(price);
    const basis = Number(priceBasis);
    if (!(amount > 0) || !(basis > 0)) return null;
    const portion = portionInSellUnit(sellUnit, basis);
    const rate = resolveRatePerSellUnit(sellUnit, amount, basis);
    if (portion == null || rate == null) return null;
    return { amount, basis, portion, rate };
  }, [price, priceBasis, sellUnit]);

  function priceBasisLabel() {
    if (sellUnit === "KG" || sellUnit === "G") return t("menu.priceForGrams");
    if (sellUnit === "L" || sellUnit === "ML") return t("menu.priceForMl");
    return t("menu.priceForPcs");
  }

  function priceBasisHint() {
    if (sellUnit === "KG") return t("menu.priceBasisHintKg");
    if (sellUnit === "G") return t("menu.priceBasisHintG");
    if (sellUnit === "L") return t("menu.priceBasisHintL");
    if (sellUnit === "ML") return t("menu.priceBasisHintMl");
    return t("menu.priceBasisHintPcs");
  }

  function basisPlaceholder() {
    if (sellUnit === "KG" || sellUnit === "G") return "500";
    if (sellUnit === "L" || sellUnit === "ML") return "500";
    return "1";
  }

  function resetForm() {
    setName("");
    setCategory(cats[0]?.name || "Karahi");
    setKitchenStation("COOKING");
    setSellUnit("KG");
    setPrice("");
    setPriceBasis(defaultPriceBasis("KG"));
    setMinQty("0");
    setMaxQty("");
    setQtyStep("");
    setAllowCustomQty(true);
    setRecipeId("");
    setSpecialProductId("");
    setMixPlates("1");
    setRecipeQ("");
    setModDrafts([]);
    setEditId(null);
    setFormKind("NORMAL");
  }

  function openAdd() {
    setPickOpen(true);
  }

  function startCreate(kind: FormKind) {
    resetForm();
    setFormKind(kind);
    if (kind === "MIX") {
      setSellUnit("PCS");
      setPriceBasis("1");
      setMinQty("1");
      setQtyStep("1");
      setAllowCustomQty(false);
      setMixPlates("1");
    }
    setPickOpen(false);
    setOpen(true);
  }

  function openEdit(m: MenuItem) {
    const kind = (m.kind || "NORMAL") as MenuKind;
    if (kind === "SPECIAL") {
      toast.push(t("menu.editInSpecials"), "err");
      return;
    }
    setEditId(m.id);
    setFormKind(kind === "MIX" ? "MIX" : "NORMAL");
    setName(m.name);
    setCategory(m.category || cats[0]?.name || "General");
    setKitchenStation(m.kitchenStation || "COOKING");
    setSellUnit(m.sellUnit);
    setRecipeId(m.recipeId || "");
    setRecipeQ("");
    setSpecialProductId(m.specialProductId || "");
    setMixPlates(String(m.mixSpecialPlates ?? 1));
    setMinQty(String(m.minQty ?? (kind === "MIX" ? 1 : 0)));
    setMaxQty(m.maxQty == null ? "" : String(m.maxQty));
    setQtyStep(m.qtyStep == null ? "" : String(m.qtyStep));
    setAllowCustomQty(m.allowCustomQty !== false);
    setModDrafts(
      (m.modifiers ?? []).map((x) => ({ name: x.name, priceDelta: String(x.priceDelta) }))
    );

    if (kind === "MIX") {
      setPrice(String(m.sellingPrice));
      setPriceBasis("1");
    } else {
      const portion = m.listPortionQty != null && m.listPortionQty > 0 ? m.listPortionQty : 1;
      const listAmt =
        m.listAmount != null && m.listAmount > 0
          ? m.listAmount
          : Math.round(m.sellingPrice * portion * 100) / 100;
      setPrice(String(listAmt));
      if (m.sellUnit === "KG" || m.sellUnit === "L") {
        setPriceBasis(String(Math.round(portion * 1000 * 1000) / 1000));
      } else {
        setPriceBasis(String(portion));
      }
    }
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const typed = category.trim();
    const matched =
      cats.find((c) => c.name === typed) ||
      cats.find((c) => c.name.toLowerCase() === typed.toLowerCase());
    if (!matched) {
      toast.push(t("menu.categoryPick"), "err");
      return;
    }
    const amount = Number(price);
    if (!(amount > 0)) {
      toast.push(t("menu.needPrice"), "err");
      return;
    }

    if (formKind === "MIX") {
      if (!recipeId) {
        toast.push(t("menu.needMixRecipe"), "err");
        return;
      }
      if (!specialProductId) {
        toast.push(t("menu.needSpecial"), "err");
        return;
      }
      const plates = Number(mixPlates);
      if (!(plates > 0)) {
        toast.push(t("menu.needMixPlates"), "err");
        return;
      }
      setBusy(true);
      try {
        const body = {
          name: name.trim(),
          category: matched.name,
          kitchenStation,
          kind: "MIX" as const,
          sellUnit: "PCS",
          sellingPrice: Math.round(amount * 100) / 100,
          listPortionQty: 1,
          minQty: Number(minQty || 1),
          maxQty: maxQty.trim() === "" ? null : Number(maxQty),
          qtyStep: qtyStep.trim() === "" ? 1 : Number(qtyStep),
          allowCustomQty,
          recipeId,
          specialProductId,
          mixSpecialPlates: plates,
        };
        if (editId) {
          await api(`/menu/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
          await saveModifiers(editId);
          toast.push(t("menu.updated"), "ok");
        } else {
          const created = await api<{ id: string }>("/menu", { method: "POST", body: JSON.stringify(body) });
          await saveModifiers(created.id);
          toast.push(t("menu.mixAdded"), "ok");
        }
        setOpen(false);
        resetForm();
        await load();
      } catch (err) {
        toast.push(err instanceof Error ? err.message : t("menu.saveFailed"), "err");
      } finally {
        setBusy(false);
      }
      return;
    }

    const basis = Number(priceBasis);
    if (!(basis > 0)) {
      toast.push(t("menu.needPriceBasis"), "err");
      return;
    }
    if ((sellUnit === "G" || sellUnit === "ML") && basis <= 1.0005 && amount >= 20) {
      toast.push(t("menu.priceBasisTooSmall"), "err");
      return;
    }
    const sellingPrice = resolveRatePerSellUnit(sellUnit, amount, basis);
    if (sellingPrice == null || !(sellingPrice > 0)) {
      toast.push(t("menu.needPrice"), "err");
      return;
    }
    const portion = portionInSellUnit(sellUnit, basis);
    if (portion == null || !(portion > 0)) {
      toast.push(t("menu.needPriceBasis"), "err");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        category: matched.name,
        kitchenStation,
        kind: "NORMAL" as const,
        sellUnit,
        sellingPrice,
        listPortionQty: portion,
        minQty: Number(minQty || 0),
        maxQty: maxQty.trim() === "" ? null : Number(maxQty),
        qtyStep: qtyStep.trim() === "" ? null : Number(qtyStep),
        allowCustomQty,
        recipeId: recipeId || null,
        specialProductId: null,
        mixSpecialPlates: null,
      };
      if (editId) {
        await api(`/menu/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
        await saveModifiers(editId);
        toast.push(t("menu.updated"), "ok");
      } else {
        const created = await api<{ id: string }>("/menu", {
          method: "POST",
          body: JSON.stringify({
            ...body,
            recipeId: recipeId || undefined,
          }),
        });
        await saveModifiers(created.id);
        toast.push(t("menu.added"), "ok");
      }
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("menu.saveFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(m: MenuItem) {
    if (!(await ask({ title: t("menu.deleteTitle"), body: t("menu.deleteConfirm", { name: m.name }), danger: true })))
      return;
    setBusy(true);
    try {
      await api(`/menu/${m.id}`, { method: "DELETE" });
      toast.push(t("menu.deleted"), "ok");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("menu.deleteFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setBusy(true);
    try {
      await api("/recipes/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCatName.trim() }),
      });
      toast.push(t("menu.catAdded"), "ok");
      setNewCatName("");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  function kindLabel(kind: MenuKind) {
    return t(`menu.kind.${kind}` as "menu.kind.NORMAL");
  }

  function formTitle() {
    if (editId) {
      return formKind === "MIX" ? t("menu.editMixTitle") : t("menu.editTitle");
    }
    return formKind === "MIX" ? t("menu.addMixTitle") : t("menu.addTitle");
  }

  function renderRow(m: MenuItem) {
    const kind = (m.kind || "NORMAL") as MenuKind;
    const isNormal = kind === "NORMAL";
    const isMix = kind === "MIX";
    return (
      <tr key={m.id}>
        <td>
          <strong>{m.name}</strong>
          <div className="tiny muted">
            <span className="badge">{kindLabel(kind)}</span>
            {(m.modifiers?.length ?? 0) > 0 && (
              <span className="badge" style={{ marginLeft: "0.35rem" }}>
                {t("menu.extrasBadge", { n: String(m.modifiers!.length) })}
              </span>
            )}
            {m.specialProduct && (
              <span style={{ marginLeft: "0.35rem" }}>
                · {t("menu.mixPartCooked")}: {m.specialProduct.name}
                {isMix && m.mixSpecialPlates != null
                  ? ` × ${m.mixSpecialPlates}`
                  : ""}
              </span>
            )}
            {isMix && m.recipe && (
              <div className="tiny muted" style={{ marginTop: "0.15rem" }}>
                {t("menu.mixPartStore")}: {m.recipe.name}
              </div>
            )}
          </div>
        </td>
        <td>
          <span className="badge">{m.category || "—"}</span>
        </td>
        <td>
          <span className="badge">
            {t(`menu.station.${m.kitchenStation || "COOKING"}` as "menu.station.COOKING")}
          </span>
        </td>
        <td>{unitLabel(m.sellUnit)}</td>
        <td>
          <strong>
            {kind === "SPECIAL" || kind === "MIX"
              ? money(m.sellingPrice)
              : listPriceLabel(m, money)}
          </strong>
          {isNormal && (
            <div className="tiny muted">
              {t("menu.perUnitRate", {
                rate: money(m.sellingPrice),
                unit: unitLabel(m.sellUnit),
              })}
            </div>
          )}
          {kind === "SPECIAL" && m.specialProduct && (
            <div className="tiny muted">
              {formatKg(m.specialProduct.plateGrams)} · {t("specials.plate")}
            </div>
          )}
        </td>
        <td className="tiny muted">
          {m.minQty ? `≥${m.minQty}` : "—"}
          {m.maxQty != null ? ` · ≤${m.maxQty}` : ""}
          {m.qtyStep != null ? ` · step ${m.qtyStep}` : ""}
          {m.allowCustomQty === false ? ` · ${t("menu.fixedSteps")}` : ""}
        </td>
        <td>{money(m.costPerUnit)}</td>
        {can("menu.manage") && (
          <td>
            <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
              {isNormal || isMix ? (
                <>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => openEdit(m)}
                    disabled={busy}
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    type="button"
                    className="btn danger sm"
                    onClick={() => removeItem(m)}
                    disabled={busy}
                  >
                    {t("common.delete")}
                  </button>
                </>
              ) : (
                <Link className="btn ghost sm" to="/specials">
                  {t("menu.openSpecials")}
                </Link>
              )}
            </div>
          </td>
        )}
      </tr>
    );
  }

  const colSpan = can("menu.manage") ? 8 : 7;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("menu.title")}</h1>
          <p>{t("menu.subtitle")}</p>
        </div>
        {can("menu.manage") && (
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setCatOpen(true)}>
              {t("menu.addCategory")}
            </button>
            <Link className="btn ghost" to="/specials">
              {t("menu.openSpecials")}
            </Link>
            <button type="button" className="btn" onClick={openAdd}>
              {t("menu.addItem")}
            </button>
          </div>
        )}
      </div>

      <div className="chips" style={{ marginBottom: "0.75rem" }}>
        {(["ALL", "NORMAL", "SPECIAL", "MIX"] as KindFilter[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`chip ${kindFilter === k ? "active" : ""}`}
            onClick={() => setKindFilter(k)}
          >
            {k === "ALL" ? t("common.all") : kindLabel(k)}
            <span className="tiny muted" style={{ marginLeft: "0.35rem" }}>
              {kindCounts[k]}
            </span>
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField value={q} onChange={setQ} placeholder={t("menu.search")} />
      </div>

      <div className="panel panel-pad">
        <table>
          <thead>
            <tr>
              <th>{t("common.item")}</th>
              <th>{t("common.category")}</th>
              <th>{t("menu.kitchenStation")}</th>
              <th>{t("menu.sellUnit")}</th>
              <th>{t("menu.sellRate")}</th>
              <th>{t("menu.qtyRules")}</th>
              <th>{t("menu.cost")}</th>
              {can("menu.manage") && <th>{t("menu.action")}</th>}
            </tr>
          </thead>
          <tbody>
            {!pageRows.length && (
              <tr>
                <td colSpan={colSpan} className="empty">
                  {t("menu.empty")}
                </td>
              </tr>
            )}
            {groupedPage
              ? groupedPage.map((g) => (
                  <Fragment key={g.kind}>
                    <tr>
                      <td
                        colSpan={colSpan}
                        style={{
                          background: "var(--panel-2, rgba(0,0,0,0.04))",
                          fontWeight: 700,
                          paddingTop: "0.85rem",
                          paddingBottom: "0.55rem",
                        }}
                      >
                        {kindLabel(g.kind)}
                        <span className="tiny muted" style={{ marginLeft: "0.5rem", fontWeight: 500 }}>
                          {g.items.length}
                        </span>
                      </td>
                    </tr>
                    {g.items.map((m) => renderRow(m))}
                  </Fragment>
                ))
              : pageRows.map((m) => renderRow(m))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={shown.length} onChange={setPage} />

      <Modal open={pickOpen} title={t("menu.pickKindTitle")} onClose={() => setPickOpen(false)}>
        <div className="modal-scroll">
          <p className="tiny muted" style={{ marginTop: 0 }}>
            {t("menu.pickKindHint")}
          </p>
          <div className="row" style={{ flexDirection: "column", gap: "0.65rem", alignItems: "stretch" }}>
            <button type="button" className="btn" onClick={() => startCreate("NORMAL")}>
              {t("menu.pickNormal")}
            </button>
            <button type="button" className="btn" onClick={() => startCreate("MIX")}>
              {t("menu.pickMix")}
            </button>
            <Link className="btn ghost" to="/specials" onClick={() => setPickOpen(false)}>
              {t("menu.pickSpecialNote")}
            </Link>
          </div>
        </div>
      </Modal>

      <Modal
        open={open}
        title={formTitle()}
        onClose={() => {
          setOpen(false);
          resetForm();
        }}
      >
        <form onSubmit={submit}>
          <div className="modal-scroll">
            {formKind === "MIX" && (
              <p className="tiny muted" style={{ marginTop: 0 }}>
                {t("menu.mixHint")}
              </p>
            )}

            {formKind !== "MIX" && (
              <div className="field">
                <label>{t("common.name")}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            )}
            <div className="field">
              <label>{t("common.category")}</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t("menu.categorySearchPh")}
                autoComplete="off"
                required
              />
              <div className="suggest-list">
                {catSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`suggest-item ${category === c.name ? "active" : ""}`}
                    onClick={() => setCategory(c.name)}
                  >
                    <strong>{c.name}</strong>
                  </button>
                ))}
                {!catSuggestions.length && category.trim() ? (
                  <div className="tiny muted" style={{ padding: "0.5rem 0.65rem" }}>
                    {t("menu.noCategoryMatch")}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="field">
              <label>{t("menu.kitchenStation")}</label>
              <select
                value={kitchenStation}
                onChange={(e) => setKitchenStation(e.target.value as KitchenStation)}
                required
              >
                {STATIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`menu.station.${s}` as "menu.station.COOKING")}
                  </option>
                ))}
              </select>
            </div>

            {formKind === "MIX" ? (
              <>
                <div className="field">
                  <label>{t("menu.mixComboName")}</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("menu.mixComboNamePh")}
                    required
                  />
                  <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
                    {t("menu.mixComboNameHint")}
                  </p>
                </div>

                <div
                  className="panel panel-pad"
                  style={{ marginBottom: "0.85rem", background: "var(--panel-2, rgba(0,0,0,0.03))" }}
                >
                  <strong style={{ display: "block", marginBottom: "0.35rem" }}>
                    1 · {t("menu.mixPartStore")}
                  </strong>
                  <p className="tiny muted" style={{ marginTop: 0 }}>
                    {t("menu.mixPartStoreHint")}
                  </p>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>{t("menu.mixStoreRecipe")}</label>
                    {selectedRecipe ? (
                      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                        <span className="badge">
                          {selectedRecipe.category} · {selectedRecipe.name}
                        </span>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => {
                            setRecipeId("");
                            setRecipeQ("");
                          }}
                        >
                          {t("menu.clearPick")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          value={recipeQ}
                          onChange={(e) => setRecipeQ(e.target.value)}
                          placeholder={t("menu.mixRecipeSearchPh")}
                          autoComplete="off"
                        />
                        <div className="suggest-list">
                          {recipeSuggestions.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              className="suggest-item"
                              onClick={() => {
                                setRecipeId(r.id);
                                setRecipeQ("");
                              }}
                            >
                              <strong>{r.name}</strong>
                              <span className="tiny muted"> · {r.category}</span>
                            </button>
                          ))}
                          {!recipeSuggestions.length && (
                            <div className="tiny muted" style={{ padding: "0.5rem 0.65rem" }}>
                              {t("menu.mixNoRecipe")}{" "}
                              <Link to="/recipes">{t("menu.openRecipes")}</Link>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div
                  className="panel panel-pad"
                  style={{ marginBottom: "0.85rem", background: "var(--panel-2, rgba(0,0,0,0.03))" }}
                >
                  <strong style={{ display: "block", marginBottom: "0.35rem" }}>
                    2 · {t("menu.mixPartCooked")}
                  </strong>
                  <p className="tiny muted" style={{ marginTop: 0 }}>
                    {t("menu.mixPartCookedHint")}
                  </p>
                  <div className="field">
                    <label>{t("menu.specialProduct")}</label>
                    <select
                      value={specialProductId}
                      onChange={(e) => setSpecialProductId(e.target.value)}
                      required
                    >
                      <option value="">{t("menu.pickSpecialPot")}</option>
                      {specials.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {money(p.platePrice)} / {formatKg(p.plateGrams)}
                        </option>
                      ))}
                    </select>
                    {!specials.length && (
                      <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
                        {t("menu.noSpecialsYet")}{" "}
                        <Link to="/specials">{t("menu.openSpecials")}</Link>
                      </p>
                    )}
                    {selectedSpecial && (
                      <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
                        {t("menu.mixSelectedPot", {
                          name: selectedSpecial.name,
                          kg: formatKg(selectedSpecial.plateGrams),
                        })}
                      </p>
                    )}
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>{t("menu.mixPlates")}</label>
                    <input
                      type="number"
                      min={0.001}
                      step="any"
                      value={mixPlates}
                      onChange={(e) => setMixPlates(e.target.value)}
                      required
                    />
                    <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
                      {t("menu.mixPlatesHint")}
                    </p>
                  </div>
                </div>

                <div className="field">
                  <label>{t("menu.mixSellPrice")}</label>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="800"
                    required
                  />
                  <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
                    {t("menu.mixSellPriceHint")}
                  </p>
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>{t("menu.minQty")}</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={minQty}
                      onChange={(e) => setMinQty(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>{t("menu.qtyStep")}</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={qtyStep}
                      onChange={(e) => setQtyStep(e.target.value)}
                      placeholder="1"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid-2">
                  <div className="field">
                    <label>{t("menu.sellUnit")}</label>
                    <select
                      value={sellUnit}
                      onChange={(e) => {
                        const u = e.target.value;
                        setSellUnit(u);
                        setPriceBasis(defaultPriceBasis(u));
                      }}
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {unitLabel(u)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>{t("menu.sellingAmount")}</label>
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="550"
                      required
                    />
                    <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
                      {t("menu.sellingAmountHint")}
                    </p>
                  </div>
                </div>
                <div className="field">
                  <label>{priceBasisLabel()}</label>
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    value={priceBasis}
                    onChange={(e) => setPriceBasis(e.target.value)}
                    placeholder={basisPlaceholder()}
                    required
                  />
                  <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
                    {priceBasisHint()}
                  </p>
                  {portionCheck && (
                    <p
                      className="tiny"
                      style={{
                        margin: "0.5rem 0 0",
                        fontWeight: 600,
                        color: "var(--ok, #0a7a4a)",
                      }}
                    >
                      {sellUnit === "KG" || sellUnit === "L"
                        ? t("menu.portionCheckBig", {
                            portion: String(portionCheck.basis),
                            small: sellUnit === "KG" ? "g" : "ml",
                            amount: money(portionCheck.amount),
                            fullRate: money(portionCheck.rate),
                            full: unitLabel(sellUnit),
                          })
                        : t("menu.portionCheckSmall", {
                            portion: String(portionCheck.basis),
                            small: unitLabel(sellUnit),
                            amount: money(portionCheck.amount),
                            rate: money(portionCheck.rate),
                            unit: unitLabel(sellUnit),
                          })}
                    </p>
                  )}
                </div>
                <p className="tiny muted" style={{ margin: "0 0 0.75rem" }}>
                  {t("menu.qtyHelp")}
                </p>
                <div className="grid-2">
                  <div className="field">
                    <label>{t("menu.minQty")}</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={minQty}
                      onChange={(e) => setMinQty(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="field">
                    <label>{t("menu.maxQty")}</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={maxQty}
                      onChange={(e) => setMaxQty(e.target.value)}
                      placeholder={t("menu.maxQtyPh")}
                    />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>{t("menu.qtyStep")}</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={qtyStep}
                      onChange={(e) => setQtyStep(e.target.value)}
                      placeholder={t("menu.qtyStepPh")}
                    />
                  </div>
                  <div className="field">
                    <label>{t("menu.allowCustom")}</label>
                    <label className="row" style={{ gap: "0.5rem", marginTop: "0.55rem" }}>
                      <input
                        type="checkbox"
                        checked={allowCustomQty}
                        onChange={(e) => setAllowCustomQty(e.target.checked)}
                      />
                      <span className="tiny">{t("menu.allowCustomHint")}</span>
                    </label>
                  </div>
                </div>
                <div className="field">
                  <label>{t("menu.linkRecipe")}</label>
                  <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
                    <option value="">{t("menu.none")}</option>
                    {recipes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.category} · {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="field">
              <label>{t("menu.modifiers")}</label>
              <p className="tiny muted" style={{ margin: "0 0 0.5rem" }}>
                {t("menu.modifiersHint")}
              </p>
              {modDrafts.map((row, idx) => (
                <div key={idx} className="grid-2" style={{ marginBottom: "0.4rem", alignItems: "end" }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>{t("menu.modName")}</label>
                    <input
                      value={row.name}
                      onChange={(e) =>
                        setModDrafts((prev) =>
                          prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p))
                        )
                      }
                      maxLength={60}
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>{t("menu.modPrice")}</label>
                    <div className="row" style={{ gap: 6 }}>
                      <input
                        type="number"
                        step="any"
                        value={row.priceDelta}
                        onChange={(e) =>
                          setModDrafts((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, priceDelta: e.target.value } : p))
                          )
                        }
                      />
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setModDrafts((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        {t("menu.modRemove")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setModDrafts((prev) => [...prev, { name: "", priceDelta: "0" }])}
              >
                {t("menu.modAdd")}
              </button>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? t("common.saving") : editId ? t("menu.update") : t("menu.save")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={catOpen} title={t("menu.addCatTitle")} onClose={() => setCatOpen(false)}>
        <form onSubmit={addCategory}>
          <div className="modal-scroll">
            <div className="field">
              <label>{t("menu.catName")}</label>
              <input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder={t("menu.catPh")}
                required
              />
            </div>
            <div className="chips" style={{ marginTop: "1rem" }}>
              {cats.map((c) => (
                <span key={c.id} className="chip active">
                  {c.name}
                </span>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {t("menu.saveCat")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
