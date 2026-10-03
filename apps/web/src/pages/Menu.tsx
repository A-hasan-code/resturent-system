import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { useConfirm } from "../components/ConfirmModal";
import { SearchField, matchesSearch } from "../components/SearchField";
import { Pagination, paginate } from "../components/Pagination";

type KitchenStation = "BEVERAGES" | "COOKING" | "BBQ";

type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  kitchenStation?: KitchenStation | null;
  sellUnit: string;
  sellingPrice: number;
  costPerUnit: number;
  profitPerUnit: number;
  recipeId: string | null;
};

type Recipe = { id: string; name: string; category: string; baseUnit: string };
type RecipeCat = { id: string; name: string };

const UNITS = ["KG", "G", "L", "ML", "PCS"] as const;
const STATIONS: KitchenStation[] = ["BEVERAGES", "COOKING", "BBQ"];
const PAGE_SIZE = 10;

export function MenuPage() {
  const { can } = useAuth();
  const toast = useToast();
  const t = useT();
  const ask = useConfirm();
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
  const [kitchenStation, setKitchenStation] = useState<KitchenStation>("COOKING");
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
      toast.push(e instanceof Error ? e.message : t("menu.loadFailed"), "err");
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
    setKitchenStation("COOKING");
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
    setKitchenStation(m.kitchenStation || "COOKING");
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
        kitchenStation,
        sellUnit,
        sellingPrice: Number(price),
        recipeId: recipeId || null,
      };
      if (editId) {
        await api(`/menu/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast.push(t("menu.updated"), "ok");
      } else {
        await api("/menu", {
          method: "POST",
          body: JSON.stringify({
            ...body,
            recipeId: recipeId || undefined,
          }),
        });
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
    if (!(await ask({ title: t("menu.deleteTitle"), body: t("menu.deleteConfirm", { name: m.name }), danger: true }))) return;
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

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("menu.title")}</h1>
          <p>{t("menu.subtitle")}</p>
        </div>
        {can("menu.manage") && (
          <div className="row">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setCatOpen(true)}
            >
              {t("menu.addCategory")}
            </button>
            <button type="button" className="btn" onClick={openCreate}>
              {t("menu.addItem")}
            </button>
          </div>
        )}
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
              <th>{t("menu.cost")}</th>
              <th>{t("menu.profit")}</th>
              {can("menu.manage") && <th>{t("menu.action")}</th>}
            </tr>
          </thead>
          <tbody>
            {!pageRows.length && (
              <tr>
                <td colSpan={can("menu.manage") ? 8 : 7} className="empty">
                  {t("menu.empty")}
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
                <td>
                  <span className="badge">
                    {t(`menu.station.${m.kitchenStation || "COOKING"}` as "menu.station.COOKING")}
                  </span>
                </td>
                <td>
                  {t("menu.per")} {unitLabel(m.sellUnit)}
                </td>
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
        title={editId ? t("menu.editTitle") : t("menu.addTitle")}
        onClose={() => {
          setOpen(false);
          resetForm();
        }}
      >
        <form onSubmit={submit}>
          <div className="modal-scroll">
          <div className="field">
            <label>{t("common.name")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>{t("common.category")}</label>
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
          <div className="grid-2">
            <div className="field">
              <label>{t("menu.sellUnit")}</label>
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
              <label>{t("menu.sellingRate")}</label>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="field">
            <label>{t("menu.linkRecipe")}</label>
            <select
              value={recipeId}
              onChange={(e) => setRecipeId(e.target.value)}
            >
              <option value="">{t("menu.none")}</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.category} · {r.name}
                </option>
              ))}
            </select>
          </div>
          </div>
          <div className="form-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy
                ? t("common.saving")
                : editId
                  ? t("menu.update")
                  : t("menu.save")}
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
