import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";

const UNITS = ["KG", "G", "L", "ML", "PCS"] as const;
const PAGE_SIZE = 5;

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
  costPerBase: number;
  ingredients: {
    storeItemId: string;
    name: string;
    category: string;
    quantity: number;
    unit: string;
    ratePerUnit: number;
  }[];
};

type IngForm = { storeItemId: string; quantity: string; unit: string };

export function RecipesPage() {
  const { can } = useAuth();
  const toast = useToast();
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

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Karahi");
  const [baseUnit, setBaseUnit] = useState("KG");
  const [baseQty, setBaseQty] = useState("1");
  const [ings, setIngs] = useState<IngForm[]>([
    { storeItemId: "", quantity: "", unit: "KG" },
  ]);

  async function load() {
    try {
      const [recipes, cats] = await Promise.all([
        api<Recipe[]>("/recipes"),
        api<RecipeCat[]>("/recipes/categories"),
      ]);
      setRows(recipes);
      setRecipeCats(cats);
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
      toast.push(e instanceof Error ? e.message : "Failed to load recipes", "err");
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
    setIngs([{ storeItemId: "", quantity: "", unit: "KG" }]);
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
    setIngs(
      r.ingredients.length
        ? r.ingredients.map((i) => ({
            storeItemId: i.storeItemId,
            quantity: String(i.quantity),
            unit: i.unit,
          }))
        : [{ storeItemId: "", quantity: "", unit: "KG" }]
    );
    setOpen(true);
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
      toast.push("Add at least 1 ingredient", "err");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        category,
        baseUnit,
        baseQty: Number(baseQty) || 1,
        ingredients,
      };
      if (editId) {
        await api(`/recipes/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast.push("Recipe updated", "ok");
      } else {
        await api("/recipes", {
          method: "POST",
          body: JSON.stringify(body),
        });
        toast.push("Recipe saved", "ok");
      }
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Save failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function removeRecipe(r: Recipe) {
    if (!window.confirm(`Delete recipe "${r.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/recipes/${r.id}`, { method: "DELETE" });
      toast.push("Recipe deleted", "ok");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Delete failed", "err");
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
      toast.push("Category added", "ok");
      setNewCatName("");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Category failed", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Recipes</h1>
          <p>Categories · quantities only · rates from inventory</p>
        </div>
        {can("recipe.manage") && (
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setCatOpen(true)}>
              + Category
            </button>
            <button type="button" className="btn" onClick={openCreate}>
              + New recipe
            </button>
          </div>
        )}
      </div>

      <div className="chips">
        {filterChips.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip ${filter === c ? "active" : ""}`}
            onClick={() => setFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="Search recipes / ingredients…"
        />
      </div>

      <div className="stack" style={{ display: "grid", gap: "0.85rem" }}>
        {!shown.length && (
          <div className="panel panel-pad empty">No recipes yet</div>
        )}
        {pageRows.map((r) => (
          <div className="panel panel-pad" key={r.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem" }}>{r.name}</h2>
                <span className="badge">{r.category}</span>
              </div>
              <div className="row" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
                <div style={{ textAlign: "right" }}>
                  <div className="muted tiny">
                    Cost / {r.baseQty} {unitLabel(r.baseUnit)}
                  </div>
                  <strong style={{ fontSize: "1.2rem" }}>
                    {money(r.costPerBase)}
                  </strong>
                </div>
                {can("recipe.manage") && (
                  <div className="row" style={{ gap: "0.35rem" }}>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => openEdit(r)}
                      disabled={busy}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn danger sm"
                      onClick={() => removeRecipe(r)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Store cat</th>
                  <th>Qty</th>
                  <th>Today rate</th>
                </tr>
              </thead>
              <tbody>
                {r.ingredients.map((i, idx) => (
                  <tr key={idx}>
                    <td>{i.name}</td>
                    <td>{i.category}</td>
                    <td>
                      {i.quantity} {unitLabel(i.unit)}
                    </td>
                    <td>
                      {money(i.ratePerUnit)} / {unitLabel(i.unit)}
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
        title={editId ? "Edit recipe" : "Add recipe"}
        onClose={() => {
          setOpen(false);
          resetForm();
        }}
        wide
      >
        <form className="form" onSubmit={submit}>
          <div className="grid-2">
            <div className="field">
              <label>Recipe name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Chicken Karahi / Kheer / Lassi"
                required
              />
            </div>
            <div className="field">
              <label>Category</label>
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
            Missing a category? Create one with “+ Category” first.
          </p>
          <div className="grid-2">
            <div className="field">
              <label>Base unit</label>
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
              <label>Base qty (usually 1)</label>
              <input
                value={baseQty}
                onChange={(e) => setBaseQty(e.target.value)}
                required
              />
            </div>
          </div>

          <h3 style={{ margin: "0.5rem 0" }}>Ingredients from store</h3>
          <div className="ing-table">
            <div className="ing-head">
              <span>Store item</span>
              <span>Qty</span>
              <span>Unit</span>
              <span />
            </div>
            {ings.map((ing, idx) => (
              <div className="ing-row" key={idx}>
                <select
                  value={ing.storeItemId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const item = items.find((x) => x.id === id);
                    setIngs((prev) =>
                      prev.map((p, i) =>
                        i === idx
                          ? {
                              ...p,
                              storeItemId: id,
                              unit: item?.unit || p.unit,
                            }
                          : p
                      )
                    );
                  }}
                  required
                  aria-label="Store item"
                >
                  <option value="">Select…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.category} · {it.name} ({money(it.ratePerUnit)}/
                      {unitLabel(it.unit)})
                    </option>
                  ))}
                </select>
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
                  aria-label="Quantity"
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
                  aria-label="Unit"
                >
                  {UNITS.map((u) => (
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
                  Remove
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              setIngs((prev) => [
                ...prev,
                { storeItemId: "", quantity: "", unit: "KG" },
              ])
            }
          >
            + Ingredient
          </button>

          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : editId ? "Update recipe" : "Save recipe"}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={catOpen}
        title="Recipe categories"
        onClose={() => setCatOpen(false)}
      >
        <form onSubmit={addCategory}>
          <div className="field">
            <label>New category name</label>
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="e.g. BBQ, Chinese, Fast Food"
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Add category
          </button>
        </form>
        <div style={{ marginTop: "1rem" }}>
          <p className="muted tiny">Existing</p>
          <div className="chips">
            {recipeCats.map((c) => (
              <span key={c.id} className="chip active">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
