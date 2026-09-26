import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";

type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  sellUnit: string;
  sellingPrice: number;
  costPerUnit: number;
  profitPerUnit: number;
  recipeId: string | null;
};

type Recipe = { id: string; name: string; category: string; baseUnit: string };
type RecipeCat = { id: string; name: string };

const UNITS = ["KG", "G", "L", "ML", "PCS"] as const;
const PAGE_SIZE = 10;

export function MenuPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<MenuItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [cats, setCats] = useState<RecipeCat[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [newCatName, setNewCatName] = useState("");

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Karahi");
  const [sellUnit, setSellUnit] = useState("KG");
  const [price, setPrice] = useState("");
  const [recipeId, setRecipeId] = useState("");

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
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Menu load failed", "err");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(
    () => rows.filter((m) => matchesSearch(q, m.name, m.category, m.sellUnit)),
    [rows, q]
  );

  useEffect(() => {
    setPage(1);
  }, [q]);

  const pageRows = paginate(shown, page, PAGE_SIZE);

  function resetForm() {
    setName("");
    setCategory(cats[0]?.name || "Karahi");
    setSellUnit("KG");
    setPrice("");
    setRecipeId("");
    setEditId(null);
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(m: MenuItem) {
    setEditId(m.id);
    setName(m.name);
    setCategory(m.category || cats[0]?.name || "General");
    setSellUnit(m.sellUnit);
    setPrice(String(m.sellingPrice));
    setRecipeId(m.recipeId || "");
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        category,
        sellUnit,
        sellingPrice: Number(price),
        recipeId: recipeId || null,
      };
      if (editId) {
        await api(`/menu/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast.push("Menu item updated", "ok");
      } else {
        await api("/menu", {
          method: "POST",
          body: JSON.stringify({
            ...body,
            recipeId: recipeId || undefined,
          }),
        });
        toast.push("Menu item added", "ok");
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

  async function removeItem(m: MenuItem) {
    if (!window.confirm(`Delete menu item "${m.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/menu/${m.id}`, { method: "DELETE" });
      toast.push("Menu item deleted", "ok");
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
      toast.push(err instanceof Error ? err.message : "Failed", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Menu Rates</h1>
          <p>Selling price · categories · recipe link · edit / delete</p>
        </div>
        {can("menu.manage") && (
          <div className="row">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setCatOpen(true)}
            >
              + Category
            </button>
            <button type="button" className="btn" onClick={openCreate}>
              + Menu item
            </button>
          </div>
        )}
      </div>

      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <SearchField value={q} onChange={setQ} placeholder="Search menu…" />
      </div>

      <div className="panel panel-pad">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Sell unit</th>
              <th>Sell rate</th>
              <th>Cost</th>
              <th>Profit</th>
              {can("menu.manage") && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {!pageRows.length && (
              <tr>
                <td colSpan={can("menu.manage") ? 7 : 6} className="empty">
                  No menu items
                </td>
              </tr>
            )}
            {pageRows.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.name}</strong>
                </td>
                <td>
                  <span className="badge">{m.category || "—"}</span>
                </td>
                <td>per {unitLabel(m.sellUnit)}</td>
                <td>{money(m.sellingPrice)}</td>
                <td>{money(m.costPerUnit)}</td>
                <td
                  style={{
                    color:
                      m.profitPerUnit >= 0 ? "var(--ok)" : "var(--danger)",
                  }}
                >
                  {money(m.profitPerUnit)}
                </td>
                {can("menu.manage") && (
                  <td>
                    <div className="row" style={{ gap: "0.35rem" }}>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => openEdit(m)}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn danger sm"
                        onClick={() => removeItem(m)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={shown.length}
        onChange={setPage}
      />

      <Modal
        open={open}
        title={editId ? "Edit menu item" : "Add menu item"}
        onClose={() => {
          setOpen(false);
          resetForm();
        }}
      >
        <form onSubmit={submit}>
          <div className="field">
            <label>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              required
            >
              {cats.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Sell unit</label>
              <select
                value={sellUnit}
                onChange={(e) => setSellUnit(e.target.value)}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Selling rate (PKR)</label>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="field">
            <label>Link recipe (auto cost)</label>
            <select
              value={recipeId}
              onChange={(e) => setRecipeId(e.target.value)}
            >
              <option value="">None</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.category} · {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : editId ? "Update" : "Save"}
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

      <Modal open={catOpen} title="Add category" onClose={() => setCatOpen(false)}>
        <form onSubmit={addCategory}>
          <div className="field">
            <label>Category name</label>
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Karahi, BBQ, Chinese…"
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Save category
          </button>
        </form>
        <div className="chips" style={{ marginTop: "1rem" }}>
          {cats.map((c) => (
            <span key={c.id} className="chip active">
              {c.name}
            </span>
          ))}
        </div>
      </Modal>
    </div>
  );
}
