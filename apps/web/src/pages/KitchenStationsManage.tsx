import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { useConfirm } from "../components/ConfirmModal";
import { Modal } from "../components/Modal";
import { loadKitchenStations, type KitchenStationRow } from "../kitchenStations";
import { sanitizePlainText, sanitizeQty } from "../inputSanitize";

export function KitchenStationsManage({
  canManage,
  onChanged,
}: {
  canManage: boolean;
  onChanged?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<KitchenStationRow[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const [edit, setEdit] = useState<KitchenStationRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editSort, setEditSort] = useState("0");

  async function load() {
    const list = await loadKitchenStations({ all: true });
    setRows(list);
  }

  useEffect(() => {
    load().catch((e) => toast.push(e instanceof Error ? e.message : t("store.loadFailed"), "err"));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!canManage || !name.trim()) return;
    setBusy(true);
    try {
      await api("/store/kitchen/stations", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
        }),
      });
      setName("");
      setCode("");
      await load();
      toast.push(t("store.stationAdded"), "ok");
      onChanged?.();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  function openEdit(row: KitchenStationRow) {
    setEdit(row);
    setEditName(row.name);
    setEditSort(String(row.sortOrder ?? 0));
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!canManage || !edit || !editName.trim()) return;
    setBusy(true);
    try {
      await api(`/store/kitchen/stations/${edit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          sortOrder: Math.max(0, Math.floor(Number(editSort) || 0)),
        }),
      });
      setEdit(null);
      await load();
      toast.push(t("store.stationUpdated"), "ok");
      onChanged?.();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: KitchenStationRow) {
    if (!canManage) return;
    try {
      await api(`/store/kitchen/stations/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !row.active }),
      });
      await load();
      onChanged?.();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    }
  }

  async function remove(row: KitchenStationRow) {
    if (!canManage) return;
    const ok = await confirm({
      title: t("store.stationDeleteTitle"),
      body: t("store.stationDeleteBody").replace("{name}", row.name),
      danger: true,
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    try {
      const res = await api<{ ok: boolean; deactivated?: boolean; deleted?: boolean }>(
        `/store/kitchen/stations/${row.id}`,
        { method: "DELETE" }
      );
      await load();
      toast.push(
        res.deactivated ? t("store.stationDeactivated") : t("store.stationDeleted"),
        "ok"
      );
      onChanged?.();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("common.failed"), "err");
    }
  }

  return (
    <div>
      <div style={{ marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>{t("store.tabKitchenStations")}</h2>
        <p className="muted" style={{ margin: "0.25rem 0 0" }}>
          {t("store.kitchenStationsHint")}
        </p>
      </div>

      {canManage && (
        <form className="panel panel-pad" onSubmit={add} style={{ marginBottom: "0.85rem" }}>
          <strong>{t("store.addStation")}</strong>
          <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "end" }}>
            <label style={{ flex: "1 1 12rem" }}>
              <span className="tiny muted">{t("common.name")}</span>
              <input
                className="field-ctrl"
                value={name}
                onChange={(e) => setName(sanitizePlainText(e.target.value))}
                placeholder={t("store.stationNamePh")}
                required
              />
            </label>
            <label style={{ flex: "0 1 10rem" }}>
              <span className="tiny muted">{t("store.stationCode")}</span>
              <input
                className="field-ctrl"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 40))
                }
                placeholder={t("store.stationCodePh")}
              />
            </label>
            <button className="btn" type="submit" disabled={busy || !name.trim()}>
              {busy ? t("common.saving") : t("store.addStation")}
            </button>
          </div>
        </form>
      )}

      <div className="panel panel-pad">
        <table>
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("store.stationCode")}</th>
              <th>{t("store.stationSort")}</th>
              <th>{t("common.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  {r.system ? (
                    <div className="tiny muted">{t("store.stationSystem")}</div>
                  ) : null}
                </td>
                <td>
                  <code>{r.code}</code>
                </td>
                <td>{r.sortOrder}</td>
                <td>
                  <span className={`pill ${r.active ? "paid" : "unpaid"}`}>
                    {r.active ? t("status.OK") : t("status.CANCELLED")}
                  </span>
                </td>
                <td className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {canManage && (
                    <>
                      <button type="button" className="btn ghost sm" onClick={() => openEdit(r)}>
                        {t("common.edit")}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => void toggleActive(r)}>
                        {r.active ? t("store.deactivate") : t("store.activate")}
                      </button>
                      {!r.system && (
                        <button type="button" className="btn danger sm" onClick={() => void remove(r)}>
                          {t("common.delete")}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{t("store.noStations")}</div>}
      </div>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={t("store.editStation")}
      >
        {edit && (
          <form className="form-grid" onSubmit={(e) => void saveEdit(e)}>
            <div className="field">
              <label htmlFor="st-name">{t("common.name")}</label>
              <input
                id="st-name"
                value={editName}
                onChange={(e) => setEditName(sanitizePlainText(e.target.value))}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="st-code">{t("store.stationCode")}</label>
              <input id="st-code" value={edit.code} disabled />
              <span className="tiny muted">{t("store.stationCodeLocked")}</span>
            </div>
            <div className="field">
              <label htmlFor="st-sort">{t("store.stationSort")}</label>
              <input
                id="st-sort"
                type="text"
                inputMode="numeric"
                value={editSort}
                onChange={(e) => setEditSort(sanitizeQty(e.target.value))}
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
              <button type="button" className="btn ghost" onClick={() => setEdit(null)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn" disabled={busy || !editName.trim()}>
                {t("common.save")}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
