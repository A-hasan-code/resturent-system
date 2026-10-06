import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { Navigate } from "react-router-dom";

type Partition = { id: string; name: string; sortOrder: number; active?: boolean };
type Table = {
  id: string;
  name: string;
  area: string | null;
  seats: number;
  sortOrder: number;
  active: boolean;
  partitionId?: string;
  partition?: { id: string; name: string } | null;
};

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

export function TableSettingsPage() {
  const { can } = useAuth();
  const t = useT();
  const toast = useToast();
  const [tables, setTables] = useState<Table[]>([]);
  const [partitions, setPartitions] = useState<Partition[]>([]);
  const [name, setName] = useState("");
  const [partitionId, setPartitionId] = useState("");
  const [partName, setPartName] = useState("");
  /** Filter table chips; empty = all partitions. */
  const [filterPartitionId, setFilterPartitionId] = useState("");

  const load = useCallback(async () => {
    try {
      const [all, parts] = await Promise.all([
        api<Table[]>("/tables/all"),
        api<Partition[]>("/tables/partitions"),
      ]);
      setTables(all);
      setPartitions(parts);
      setPartitionId((prev) => {
        if (prev && parts.some((p) => p.id === prev)) return prev;
        return parts[0]?.id || "";
      });
      setFilterPartitionId((prev) => {
        if (prev && parts.some((p) => p.id === prev)) return prev;
        return parts[0]?.id || "";
      });
    } catch (e) {
      toast.push(errMsg(e, t("common.failed")), "err");
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const shownTables = useMemo(() => {
    if (!filterPartitionId) return tables;
    return tables.filter((tbl) => tbl.partitionId === filterPartitionId || tbl.partition?.id === filterPartitionId);
  }, [tables, filterPartitionId]);

  async function addPartition(e: FormEvent) {
    e.preventDefault();
    if (!partName.trim()) return;
    try {
      const p = await api<Partition>("/tables/partitions", {
        method: "POST",
        body: JSON.stringify({ name: partName.trim(), sortOrder: partitions.length }),
      });
      setPartName("");
      setPartitionId(p.id);
      setFilterPartitionId(p.id);
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  async function setPartitionActive(p: Partition, active: boolean) {
    try {
      await api(`/tables/partitions/${p.id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!partitionId) {
      toast.push(t("settings.pickPartition"), "err");
      return;
    }
    try {
      await api("/tables", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), partitionId, sortOrder: tables.length + 1 }),
      });
      setName("");
      setFilterPartitionId(partitionId);
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  async function setActive(tbl: Table, active: boolean) {
    try {
      await api(`/tables/${tbl.id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  if (!can("tables.manage")) return <Navigate to="/" replace />;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("tableSettings.title")}</h1>
          <p>{t("tableSettings.subtitle")}</p>
        </div>
      </div>

      <div className="panel panel-pad" style={{ marginBottom: "0.85rem" }}>
        <h2 className="settings-h" style={{ marginTop: 0 }}>
          {t("settings.partitions")}
        </h2>
        <p className="tiny muted" style={{ marginTop: 0 }}>
          {t("tableSettings.partitionHint")}
        </p>
        <form className="row tables-add" onSubmit={addPartition}>
          <div className="field" style={{ margin: 0, flex: "1 1 180px" }}>
            <input
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
              placeholder={t("settings.partitionNamePh")}
            />
          </div>
          <button className="btn ghost" type="submit" style={{ minHeight: "2.6rem" }}>
            {t("settings.addPartition")}
          </button>
        </form>
        <div className="chips" style={{ marginTop: "0.6rem" }}>
          {partitions.map((p) => (
            <span key={p.id} className={`chip ${p.active !== false ? "active" : ""}`}>
              {p.name}
              <button
                type="button"
                className="chip-x"
                title={p.active !== false ? t("settings.hideTitles") : t("settings.showTitles")}
                onClick={() => void setPartitionActive(p, p.active === false)}
              >
                {p.active !== false ? "×" : "+"}
              </button>
            </span>
          ))}
          {!partitions.length && <span className="tiny muted">{t("tableSettings.noPartitions")}</span>}
        </div>
      </div>

      <div className="panel panel-pad">
        <h2 className="settings-h" style={{ marginTop: 0 }}>
          {t("settings.tables")}
        </h2>
        <form className="row tables-add" onSubmit={add}>
          <div className="field" style={{ margin: 0, flex: "1 1 140px" }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.tableNamePh")} />
          </div>
          <div className="field" style={{ margin: 0, flex: "1 1 160px" }}>
            <select
              value={partitionId}
              onChange={(e) => {
                const id = e.target.value;
                setPartitionId(id);
                if (id) setFilterPartitionId(id);
              }}
              required
            >
              <option value="">{t("settings.pickPartition")}</option>
              {partitions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit" style={{ minHeight: "2.6rem" }} disabled={!partitionId}>
            {t("settings.addTable")}
          </button>
        </form>

        <div className="chips" style={{ marginTop: "0.85rem", marginBottom: "0.5rem" }}>
          <button
            type="button"
            className={`chip ${!filterPartitionId ? "active" : ""}`}
            onClick={() => setFilterPartitionId("")}
          >
            {t("tableSettings.filterAll")}
          </button>
          {partitions.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${filterPartitionId === p.id ? "active" : ""}`}
              onClick={() => setFilterPartitionId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="tiny muted" style={{ margin: "0 0 0.5rem" }}>
          {filterPartitionId
            ? t("tableSettings.filterHint", {
                name: partitions.find((p) => p.id === filterPartitionId)?.name || "",
              })
            : t("tableSettings.filterAllHint")}
        </p>

        <div className="chips">
          {shownTables.map((tbl) => (
            <span key={tbl.id} className={`chip ${tbl.active ? "active" : ""}`}>
              {tbl.partition?.name ? `${tbl.partition.name} · ` : ""}
              {tbl.name}
              <button
                type="button"
                className="chip-x"
                title={tbl.active ? t("settings.hideTitles") : t("settings.showTitles")}
                onClick={() => void setActive(tbl, !tbl.active)}
              >
                {tbl.active ? "×" : "+"}
              </button>
            </span>
          ))}
          {!shownTables.length && <span className="tiny muted">{t("tableSettings.noTables")}</span>}
        </div>
      </div>
    </div>
  );
}
