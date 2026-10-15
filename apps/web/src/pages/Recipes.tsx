import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { useConfirm } from "../components/ConfirmModal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";

const UNITS = ["KG", "G", "L", "ML", "PCS"] as const;
const PAGE_SIZE = 5;

function unitFamily(u: string): "solid" | "liquid" | "count" {
  if (u === "KG" || u === "G") return "solid";
  if (u === "L" || u === "ML") return "liquid";
  return "count";
}

function unitsForStore(storeUnit: string | undefined) {
  if (!storeUnit) return [...UNITS];
  const fam = unitFamily(storeUnit);
  return UNITS.filter((u) => unitFamily(u) === fam);
}

type StoreItem = {
  id: string;
  name: string;
  unit: string;
  ratePerUnit: number;
  category: string;
};

type RecipeCat = { id: string; name: string; sortOrder: number };

type Recipe = {
  id: string;
  name: string;
  category: string;
  baseUnit: string;
  baseQty: number;
  prepMinutes?: number;
  costPerBase: number;
  totalForBase?: number;
  ingredients: {
    storeItemId: string;
    name: string;
    category: string;
    quantity: number;
    unit: string;
    storeUnit?: string;
    ratePerUnit: number;
    storeActive?: boolean;
  }[];
};

type IngForm = { storeItemId: string; itemQ: string; quantity: string; unit: string };

export function RecipesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const t = useT();
  const ask = useConfirm();
  const [rows, setRows] = useState<Recipe[]>([]);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [recipeCats, setRecipeCats] = useState<RecipeCat[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [enforceStock, setEnforceStock] = useState(true);
  const [enforceBusy, setEnforceBusy] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Karahi");
  const [baseUnit, setBaseUnit] = useState("KG");
  const [baseQty, setBaseQty] = useState("1");
  const [prepMinutes, setPrepMinutes] = useState("15");
  const [ings, setIngs] = useState<IngForm[]>([
    { storeItemId: "", itemQ: "", quantity: "", unit: "KG" },
  ]);

  async function load() {
    try {
      const [recipes, cats, stock] = await Promise.all([
        api<Recipe[]>("/recipes"),
        api<RecipeCat[]>("/recipes/categories"),
        api<{ enforceRecipeStock: boolean }>("/recipes/stock-enforce"),
      ]);
      setRows(recipes);
      setRecipeCats(cats);
      setEnforceStock(stock.enforceRecipeStock !== false);
      if (cats[0] && !cats.find((c) => c.name === category)) {
        setCategory(cats[0].name);
      }
      if (can("recipe.manage", "store.view", "store.manage")) {
        const storeCats = await api<
          {
            name: string;
            items: {
              id: string;
              name: string;
              unit: string;
              ratePerUnit: number;
            }[];
          }[]
        >("/store/categories");
        setItems(
          storeCats.flatMap((c) =>
            c.items.map((i) => ({ ...i, category: c.name }))
          )
        );
      }
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("recipes.loadFailed"), "err");
    }
  }

  async function toggleStockEnforce(next: boolean) {
    if (!can("recipe.manage") || enforceBusy) return;
    setEnforceBusy(true);
    const prev = enforceStock;
    setEnforceStock(next);
    try {
      const res = await api<{ enforceRecipeStock: boolean }>("/recipes/stock-enforce", {
        method: "PATCH",
        body: JSON.stringify({ enabled: next }),
      });
      setEnforceStock(res.enforceRecipeStock !== false);
      toast.push(
        res.enforceRecipeStock !== false
          ? t("recipes.stockEnforceOn")
          : t("recipes.stockEnforceOff"),
        "ok"
      );
    } catch (err) {
      setEnforceStock(prev);
      toast.push(err instanceof Error ? err.message : t("recipes.stockEnforceFailed"), "err");
    } finally {
      setEnforceBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(
    () =>
      rows.filter((r) => {
        if (!(filter === "ALL" || r.category === filter)) return false;
        return matchesSearch(
          q,
          r.name,
          r.category,
          ...r.ingredients.map((i) => i.name)
        );
      }),
    [rows, filter, q]
  );

  useEffect(() => {
    setPage(1);
  }, [filter, q]);

  const pageRows = paginate(shown, page, PAGE_SIZE);

  const filterChips = useMemo(() => {
    const names = recipeCats.map((c) => c.name);
    for (const r of rows) {
      if (!names.includes(r.category)) names.push(r.category);
    }
    return ["ALL", ...names];
  }, [recipeCats, rows]);

  function resetForm() {
    setName("");
    setCategory(recipeCats[0]?.name || "General");
    setBaseUnit("KG");
    setBaseQty("1");
    setPrepMinutes("15");
    setIngs([{ storeItemId: "", itemQ: "", quantity: "", unit: "KG" }]);
    setEditId(null);
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(r: Recipe) {
    setEditId(r.id);
    setName(r.name);
    setCategory(r.category);
    setBaseUnit(r.baseUnit);
    setBaseQty(String(r.baseQty));
    setPrepMinutes(String(r.prepMinutes ?? 15));
    setIngs(
      r.ingredients.length
        ? r.ingredients.map((i) => ({
            storeItemId: i.storeItemId,
            itemQ: `${i.category} · ${i.name}`,
            quantity: String(i.quantity),
            unit: i.unit,
          }))
        : [{ storeItemId: "", itemQ: "", quantity: "", unit: "KG" }]
    );
    setOpen(true);
  }

  function pickStoreItem(idx: number, it: StoreItem) {
    setIngs((prev) =>
      prev.map((p, i) =>
        i === idx
          ? {
              ...p,
              storeItemId: it.id,
              itemQ: `${it.category} · ${it.name}`,
              unit: it.unit,
            }
          : p
      )
    );
  }

  function clearStoreItem(idx: number) {
    setIngs((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, storeItemId: "", itemQ: "", unit: "KG" } : p
      )
    );
  }

  function storeHitsFor(idx: number, q: string) {
    const taken = new Set(
      ings.map((x, i) => (i !== idx && x.storeItemId ? x.storeItemId : "")).filter(Boolean)
    );
    const list = items.filter(
      (it) => !taken.has(it.id) && matchesSearch(q, it.name, it.category)
    );
    return list.slice(0, 10);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ingredients = ings
      .filter((i) => i.storeItemId && Number(i.quantity) > 0)
      .map((i) => ({
        storeItemId: i.storeItemId,
        quantity: Number(i.quantity),
        unit: i.unit,
      }));
    if (!ingredients.length) {
      toast.push(t("recipes.needIng"), "err");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        category,
        baseUnit,
        baseQty: Number(baseQty) || 1,
        prepMinutes: Math.max(1, Math.round(Number(prepMinutes) || 15)),
        ingredients,
      };
      if (editId) {
        await api(`/recipes/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast.push(t("recipes.updated"), "ok");
      } else {
        await api("/recipes", {
          method: "POST",
          body: JSON.stringify(body),
        });
        toast.push(t("recipes.saved"), "ok");
      }
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("recipes.saveFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function removeRecipe(r: Recipe) {
    if (!(await ask({ title: t("recipes.deleteTitle"), body: t("recipes.deleteConfirm", { name: r.name }), danger: true }))) return;
    setBusy(true);
    try {
      await api(`/recipes/${r.id}`, { method: "DELETE" });
      toast.push(t("recipes.deleted"), "ok");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("recipes.deleteFailed"), "err");
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
      toast.push(t("recipes.catAdded"), "ok");
      setNewCatName("");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("recipes.catFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("recipes.title")}</h1>
          <p>{t("recipes.subtitle")}</p>
        </div>
        {can("recipe.manage") && (
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setCatOpen(true)}>
              {t("recipes.addCategory")}
            </button>
            <button type="button" className="btn" onClick={openCreate}>
              {t("recipes.addRecipe")}
            </button>
          </div>
        )}
      </div>

      <div className="panel panel-pad" style={{ marginBottom: "0.85rem" }}>
        <label className="switch-row" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={enforceStock}
            disabled={!can("recipe.manage") || enforceBusy}
            onChange={(e) => toggleStockEnforce(e.target.checked)}
          />
          <span>
            {t("recipes.stockEnforce")}
            <small>{t("recipes.stockEnforceHint")}</small>
          </span>
        </label>
      </div>

      <div className="chips">
        {filterChips.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip ${filter === c ? "active" : ""}`}
            onClick={() => setFilter(c)}
          >
            {c === "ALL" ? t("common.all") : c}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField
          value={q}
          onChange={setQ}
          placeholder={t("recipes.search")}
        />
      </div>

      <div className="stack" style={{ display: "grid", gap: "0.85rem" }}>
        {!shown.length && (
          <div className="panel panel-pad empty">{t("recipes.empty")}</div>
        )}
        {pageRows.map((r) => (
          <div className="panel panel-pad" key={r.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem" }}>{r.name}</h2>
                <span className="badge">{r.category}</span>
                <span className="badge pending" style={{ marginLeft: "0.35rem" }}>
                  {r.prepMinutes ?? 15}m
                </span>
              </div>
              <div className="row" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
                <div style={{ textAlign: "right" }}>
                  <div className="muted tiny">
                    {t("recipes.costPerUnit", { unit: unitLabel(r.baseUnit) })}
                  </div>
                  <strong style={{ fontSize: "1.2rem" }}>{money(r.costPerBase)}</strong>
                  {r.baseQty !== 1 && r.totalForBase != null && (
                    <div className="muted tiny">
                      {t("recipes.costBatch", {
                        qty: String(r.baseQty),
                        unit: unitLabel(r.baseUnit),
                        amount: money(r.totalForBase),
                      })}
                    </div>
                  )}
                </div>
                {can("recipe.manage") && (
                  <div className="row" style={{ gap: "0.35rem" }}>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => openEdit(r)}
                      disabled={busy}
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      className="btn danger sm"
                      onClick={() => removeRecipe(r)}
                      disabled={busy}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>{t("recipes.ingredient")}</th>
                  <th>{t("recipes.storeCat")}</th>
                  <th>{t("common.qty")}</th>
                  <th>{t("recipes.todayRate")}</th>
                </tr>
              </thead>
              <tbody>
                {r.ingredients.map((i, idx) => (
                  <tr key={idx}>
                    <td>
                      {i.name}
                      {i.storeActive === false && (
                        <span className="badge" style={{ marginLeft: 6 }}>
                          {t("recipes.inactiveItem")}
                        </span>
                      )}
                    </td>
                    <td>{i.category}</td>
                    <td>
                      {i.quantity} {unitLabel(i.unit)}
                    </td>
                    <td>
                      {money(i.ratePerUnit)} / {unitLabel(i.storeUnit || i.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={shown.length}
        onChange={setPage}
      />

      <Modal
        open={open}
        title={editId ? t("recipes.editTitle") : t("recipes.addTitle")}
        onClose={() => {
          setOpen(false);
          resetForm();
        }}
        wide
      >
        <form className="form" onSubmit={submit}>
          <div className="modal-scroll">
          <div className="grid-2">
            <div className="field">
              <label>{t("recipes.recipeName")}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("recipes.namePh")}
                required
              />
            </div>
            <div className="field">
              <label>{t("common.category")}</label>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  if (e.target.value === "Drinks") setBaseUnit("L");
                  else setBaseUnit("KG");
                }}
                required
              >
                {recipeCats.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="tiny muted" style={{ margin: "-0.45rem 0 0.85rem" }}>
            {t("recipes.missingCat")}
          </p>
          <div className="grid-2">
            <div className="field">
              <label>{t("recipes.baseUnit")}</label>
              <select
                value={baseUnit}
                onChange={(e) => setBaseUnit(e.target.value)}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t("recipes.baseQty")}</label>
              <input
                value={baseQty}
                onChange={(e) => setBaseQty(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="field">
            <label>{t("recipes.prepMinutes")}</label>
            <input
              type="number"
              min={1}
              step={1}
              value={prepMinutes}
              onChange={(e) => setPrepMinutes(e.target.value)}
              required
            />
            <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
              {t("recipes.prepMinutesHint")}
            </p>
          </div>

          <h3 style={{ margin: "0.5rem 0" }}>{t("recipes.ingredients")}</h3>
          <div className="ing-table">
            <div className="ing-head">
              <span>{t("recipes.storeItem")}</span>
              <span>{t("common.qty")}</span>
              <span>{t("common.unit")}</span>
              <span />
            </div>
            {ings.map((ing, idx) => {
              const storeItem = items.find((x) => x.id === ing.storeItemId);
              const unitOpts = unitsForStore(storeItem?.unit);
              const hits = !ing.storeItemId ? storeHitsFor(idx, ing.itemQ) : [];
              return (
              <div className="ing-row" key={idx}>
                <div className="ing-pick">
                  {storeItem && ing.storeItemId ? (
                    <div className="row" style={{ gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                      <span className="badge">
                        {storeItem.category} · {storeItem.name}
                      </span>
                      <span className="tiny muted">
                        {money(storeItem.ratePerUnit)}/{unitLabel(storeItem.unit)}
                      </span>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => clearStoreItem(idx)}
                      >
                        {t("common.clear")}
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        value={ing.itemQ}
                        onChange={(e) =>
                          setIngs((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, itemQ: e.target.value, storeItemId: "" } : p
                            )
                          )
                        }
                        placeholder={t("recipes.itemSearchPh")}
                        autoComplete="off"
                        aria-label={t("recipes.storeItem")}
                        required={!ing.storeItemId}
                      />
                      <div className="suggest-list">
                        {hits.map((it) => (
                          <button
                            key={it.id}
                            type="button"
                            className="suggest-item"
                            onClick={() => pickStoreItem(idx, it)}
                          >
                            <strong>{it.name}</strong>
                            <span className="tiny muted">
                              {" "}
                              · {it.category} · {money(it.ratePerUnit)}/{unitLabel(it.unit)}
                            </span>
                          </button>
                        ))}
                        {ing.itemQ.trim() && !hits.length ? (
                          <div className="tiny muted" style={{ padding: "0.5rem 0.65rem" }}>
                            {t("recipes.noItemMatch")}
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
                <input
                  value={ing.quantity}
                  onChange={(e) =>
                    setIngs((prev) =>
                      prev.map((p, i) =>
                        i === idx ? { ...p, quantity: e.target.value } : p
                      )
                    )
                  }
                  required
                  aria-label={t("store.quantity")}
                />
                <select
                  value={ing.unit}
                  onChange={(e) =>
                    setIngs((prev) =>
                      prev.map((p, i) =>
                        i === idx ? { ...p, unit: e.target.value } : p
                      )
                    )
                  }
                  aria-label={t("common.unit")}
                >
                  {unitOpts.map((u) => (
                    <option key={u} value={u}>
                      {unitLabel(u)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() =>
                    setIngs((prev) => prev.filter((_, i) => i !== idx))
                  }
                  disabled={ings.length === 1}
                >
                  {t("recipes.removeIng")}
                </button>
              </div>
              );
            })}
          </div>

          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              setIngs((prev) => [
                ...prev,
                { storeItemId: "", itemQ: "", quantity: "", unit: "KG" },
              ])
            }
          >
            {t("recipes.addIng")}
          </button>
          </div>

          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy
                ? t("common.saving")
                : editId
                  ? t("recipes.update")
                  : t("recipes.save")}
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

      <Modal
        open={catOpen}
        title={t("recipes.categories")}
        onClose={() => setCatOpen(false)}
      >
        <form onSubmit={addCategory}>
          <div className="modal-scroll">
          <div className="field">
            <label>{t("recipes.newCat")}</label>
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder={t("recipes.catPh")}
              required
            />
          </div>
          <div style={{ marginTop: "1rem" }}>
            <p className="muted tiny">{t("recipes.existing")}</p>
            <div className="chips">
              {recipeCats.map((c) => (
                <span key={c.id} className="chip active">
                  {c.name}
                </span>
              ))}
            </div>
          </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {t("recipes.addCat")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
