import { FormEvent, useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, uploadApi } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { useConfirm } from "../components/ConfirmModal";
import { useSocketEvent } from "../socket";
import { serverOrigin } from "../server";
import { applyAccent, THEME_PRESETS, useBrand } from "../brand";
import { useT, type MessageKey } from "../i18n";

type ServerInfo = {
  serverId: string;
  name: string;
  version: string;
  port: number;
  hostname: string;
  urls: string[];
  mdnsUrl: string;
  addresses: { iface: string; ip: string }[];
  androidApk: { path: string; size: number; updatedAt: string } | null;
};

type Restaurant = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  accent?: string;
  logoUrl?: string | null;
};

type Printer = {
  id: string;
  name: string;
  kind: "WINDOWS" | "NETWORK" | "FILE";
  target: string;
  paperWidth: number;
  printsKot: boolean;
  printsBill: boolean;
  station: string;
  categories: string;
  active: boolean;
};

type SystemPrinter = { name: string; driver: string; port: string; status: string; isDefault: boolean };

type Job = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  lastError: string | null;
  printer: string | null;
  orderNo: number | null;
  tableNo: string | null;
  createdAt: string;
};

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
type Backup = { file: string; size: number; createdAt: string; auto: boolean; kind?: "daily" | "monthly" | "manual" | "safety" };

const BACKUP_KIND_KEY: Record<string, MessageKey> = {
  daily: "settings.kindDaily",
  monthly: "settings.kindMonthly",
  manual: "settings.kindManual",
  safety: "settings.kindBefore",
};

const EMPTY_PRINTER: Omit<Printer, "id"> = {
  name: "",
  kind: "NETWORK",
  target: "",
  paperWidth: 80,
  printsKot: false,
  printsBill: true,
  station: "",
  categories: "",
  active: true,
};

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

export function SettingsPage() {
  const { can } = useAuth();
  const t = useT();
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.subtitle")}</p>
        </div>
      </div>
      <ServerSection canEdit={can("system.manage")} />
      {can("system.manage") && <TipPrintSection />}
      {can("printers.manage") && <PrintersSection />}
      {can("printers.manage") && <JobsSection />}
      {can("tables.manage") && <TablesSection />}
      {can("system.manage") && <BackupSection />}
    </div>
  );
}

function ServerSection({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const t = useT();
  const { refresh, logoSrc } = useBrand();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [serverName, setServerName] = useState("");
  const [r, setR] = useState<Restaurant>({ name: "", tagline: "", address: "", phone: "", accent: "#0f7a6c" });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api<ServerInfo>("/system/info").then(setInfo).catch(() => undefined);
    api<{ serverName: string; restaurant: Restaurant }>("/system/settings")
      .then((s) => {
        setServerName(s.serverName);
        setR({ accent: "#0f7a6c", ...s.restaurant });
        if (s.restaurant.accent) applyAccent(s.restaurant.accent);
      })
      .catch(() => undefined);
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/system/settings", {
        method: "PATCH",
        body: JSON.stringify({
          serverName,
          restaurantName: r.name,
          tagline: r.tagline,
          address: r.address,
          phone: r.phone,
          accent: r.accent,
        }),
      });
      applyAccent(r.accent || "#0f7a6c");
      await refresh();
      toast.push(t("settings.saved"), "ok");
    } catch (err) {
      toast.push(errMsg(err, t("settings.saveFailed")), "err");
    }
  }

  async function onLogo(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await uploadApi("/system/logo", form);
      await refresh();
      toast.push(t("settings.logoSaved"), "ok");
    } catch (err) {
      toast.push(errMsg(err, t("settings.logoFailed")), "err");
    } finally {
      setUploading(false);
    }
  }

  async function clearLogo() {
    try {
      await api("/system/logo", { method: "DELETE" });
      await refresh();
      toast.push(t("settings.logoRemoved"), "ok");
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  const mainUrl =
    info?.urls.find((u) => /:\/\/192\.168\./.test(u)) ??
    info?.urls[0] ??
    (serverOrigin() || location.origin);

  return (
    <div className="settings-grid">
      <form className="panel panel-pad" onSubmit={save} id="branding">
        <h2 className="settings-h">{t("settings.branding")}</h2>
        <p className="tiny muted" style={{ marginTop: 0 }}>{t("settings.brandingHint")}</p>

        <div className="brand-upload">
          <div className="brand-upload-preview">
            {logoSrc ? <img src={logoSrc} alt="" /> : <span className="tiny muted">{t("settings.noLogo")}</span>}
          </div>
          {canEdit && (
            <div className="row">
              <label className="btn ghost sm brand-file-btn">
                {uploading ? t("common.loading") : t("settings.uploadLogo")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  hidden
                  disabled={uploading}
                  onChange={(e) => void onLogo(e.target.files?.[0] ?? null)}
                />
              </label>
              {logoSrc && (
                <button type="button" className="btn ghost sm" onClick={() => void clearLogo()}>
                  {t("settings.removeLogo")}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="field">
          <label>{t("settings.theme")}</label>
          <div className="theme-swatches" role="radiogroup" aria-label={t("settings.theme")}>
            {THEME_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={r.accent === p.accent}
                disabled={!canEdit}
                className={`theme-swatch ${r.accent === p.accent ? "selected" : ""}`}
                style={{ ["--swatch" as string]: p.accent }}
                title={p.label}
                onClick={() => {
                  setR({ ...r, accent: p.accent });
                  applyAccent(p.accent);
                }}
              >
                <span />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <h2 className="settings-h">{t("settings.restaurantInfo")}</h2>
        <div className="field">
          <label>{t("settings.restaurantName")}</label>
          <input value={r.name} disabled={!canEdit} onChange={(e) => setR({ ...r, name: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("settings.tagline")}</label>
          <input value={r.tagline} disabled={!canEdit} onChange={(e) => setR({ ...r, tagline: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("settings.address")}</label>
          <input value={r.address} disabled={!canEdit} onChange={(e) => setR({ ...r, address: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("settings.phone")}</label>
          <input value={r.phone} disabled={!canEdit} onChange={(e) => setR({ ...r, phone: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("settings.serverName")}</label>
          <input value={serverName} disabled={!canEdit} onChange={(e) => setServerName(e.target.value)} />
        </div>
        {canEdit && (
          <div className="form-footer">
            <button className="btn" type="submit">
              {t("common.save")}
            </button>
          </div>
        )}
      </form>

      <div className="panel panel-pad">
        <h2 className="settings-h">{t("settings.connectTablets")}</h2>
        <div className="row" style={{ alignItems: "flex-start", gap: "1.25rem" }}>
          <div className="qr-box">
            <QRCodeSVG value={mainUrl} size={150} level="M" />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <p className="muted" style={{ marginTop: 0 }}>
              {t("settings.joinWifi")}{" "}
              <strong>{t("settings.addHome")}</strong>
            </p>
            <ul className="url-list">
              {(info?.urls ?? []).map((u) => (
                <li key={u}>
                  <code>{u}</code>
                </li>
              ))}
              {info && (
                <li>
                  <code>{info.mdnsUrl}</code> <span className="tiny muted">{t("settings.byName")}</span>
                </li>
              )}
            </ul>
            <p className="tiny muted">{t("settings.ipHint")}</p>
          </div>
        </div>
        {info && (
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            {t("settings.serverId")}: <code>{info.serverId}</code> · v{info.version} · PC: {info.hostname}
          </p>
        )}
        {info?.androidApk && (
          <>
            <h2 className="settings-h" style={{ marginTop: "1.25rem" }}>{t("settings.androidApp")}</h2>
            <div className="row" style={{ alignItems: "flex-start", gap: "1.25rem" }}>
              <div className="qr-box">
                <QRCodeSVG value={`${mainUrl}${info.androidApk.path}`} size={150} level="M" />
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <p className="muted" style={{ marginTop: 0 }}>
                  {t("settings.scanTablet")} {t("settings.unknownApps")}
                </p>
                <p className="tiny muted" style={{ marginBottom: 0 }}>
                  <code>{`${mainUrl}${info.androidApk.path}`}</code> · {(info.androidApk.size / 1048576).toFixed(1)} MB
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TipPrintSection() {
  const toast = useToast();
  const t = useT();
  const [tipSplit, setTipSplit] = useState("SPLIT_50");
  const [billShowOrderBy, setBillShowOrderBy] = useState(true);
  const [billShowServedBy, setBillShowServedBy] = useState(true);
  const [billShowCashier, setBillShowCashier] = useState(true);
  const [billShowTip, setBillShowTip] = useState(true);
  const [billFooter, setBillFooter] = useState("Thank you - Come again!");
  const [kotShowOrderBy, setKotShowOrderBy] = useState(true);
  const [kotFooter, setKotFooter] = useState("");
  const [perHeadEnabled, setPerHeadEnabled] = useState(true);
  const [perHeadAmount, setPerHeadAmount] = useState("100");
  const [perHeadLabel, setPerHeadLabel] = useState("Per head");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{
      tip: { split: string };
      billing?: { perHead?: { enabled: boolean; amount: number; label: string } };
      print: {
        bill: {
          showOrderBy: boolean;
          showServedBy: boolean;
          showCashier: boolean;
          showTip: boolean;
          footer: string;
        };
        kot: { showOrderBy: boolean; footer: string };
      };
    }>("/system/settings")
      .then((s) => {
        setTipSplit(s.tip?.split || "SPLIT_50");
        setBillShowOrderBy(s.print?.bill?.showOrderBy !== false);
        setBillShowServedBy(s.print?.bill?.showServedBy !== false);
        setBillShowCashier(s.print?.bill?.showCashier !== false);
        setBillShowTip(s.print?.bill?.showTip !== false);
        setBillFooter(s.print?.bill?.footer || "Thank you - Come again!");
        setKotShowOrderBy(s.print?.kot?.showOrderBy !== false);
        setKotFooter(s.print?.kot?.footer || "");
        const ph = s.billing?.perHead;
        if (ph) {
          setPerHeadEnabled(ph.enabled !== false);
          setPerHeadAmount(String(ph.amount ?? 100));
          setPerHeadLabel(ph.label || "Per head");
        }
      })
      .catch(() => undefined);
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const amount = Math.max(0, Number(perHeadAmount) || 0);
      await api("/system/settings", {
        method: "PATCH",
        body: JSON.stringify({
          tipSplit,
          billShowOrderBy: billShowOrderBy ? "1" : "0",
          billShowServedBy: billShowServedBy ? "1" : "0",
          billShowCashier: billShowCashier ? "1" : "0",
          billShowTip: billShowTip ? "1" : "0",
          billFooter,
          kotShowOrderBy: kotShowOrderBy ? "1" : "0",
          kotFooter,
          perHeadEnabled: perHeadEnabled ? "1" : "0",
          perHeadAmount: amount,
          perHeadLabel: perHeadLabel.trim() || "Per head",
        }),
      });
      toast.push(t("settings.saved"), "ok");
    } catch (err) {
      toast.push(errMsg(err, t("settings.saveFailed")), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel panel-pad" onSubmit={save} style={{ marginBottom: "1rem" }}>
      <h2 className="settings-h">{t("settings.tipsPrint")}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("settings.tipsPrintHint")}
      </p>

      <div className="field">
        <label htmlFor="tip-split">{t("settings.tipSplit")}</label>
        <select id="tip-split" value={tipSplit} onChange={(e) => setTipSplit(e.target.value)}>
          <option value="ORDER_TAKER">{t("settings.tipOrderTaker")}</option>
          <option value="POOL">{t("settings.tipPool")}</option>
        </select>
      </div>

      <h3 className="settings-h" style={{ fontSize: "1rem" }}>
        {t("settings.perHead")}
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("settings.perHeadHint")}
      </p>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={perHeadEnabled}
          onChange={(e) => setPerHeadEnabled(e.target.checked)}
        />
        <span>{t("settings.perHeadEnabled")}</span>
      </label>
      <div className="field">
        <label htmlFor="per-head-amount">{t("settings.perHeadAmount")}</label>
        <input
          id="per-head-amount"
          type="number"
          min={0}
          step={1}
          value={perHeadAmount}
          onChange={(e) => setPerHeadAmount(e.target.value)}
          disabled={!perHeadEnabled}
        />
      </div>
      <div className="field">
        <label htmlFor="per-head-label">{t("settings.perHeadLabel")}</label>
        <input
          id="per-head-label"
          value={perHeadLabel}
          onChange={(e) => setPerHeadLabel(e.target.value)}
          maxLength={40}
          disabled={!perHeadEnabled}
        />
      </div>

      <h3 className="settings-h" style={{ fontSize: "1rem" }}>
        {t("settings.billFields")}
      </h3>
      <label className="switch-row">
        <input type="checkbox" checked={billShowOrderBy} onChange={(e) => setBillShowOrderBy(e.target.checked)} />
        <span>{t("settings.showOrderBy")}</span>
      </label>
      <label className="switch-row">
        <input type="checkbox" checked={billShowServedBy} onChange={(e) => setBillShowServedBy(e.target.checked)} />
        <span>{t("settings.showServedBy")}</span>
      </label>
      <label className="switch-row">
        <input type="checkbox" checked={billShowCashier} onChange={(e) => setBillShowCashier(e.target.checked)} />
        <span>{t("settings.showCashier")}</span>
      </label>
      <label className="switch-row">
        <input type="checkbox" checked={billShowTip} onChange={(e) => setBillShowTip(e.target.checked)} />
        <span>{t("settings.showTip")}</span>
      </label>
      <div className="field">
        <label>{t("settings.billFooter")}</label>
        <input value={billFooter} onChange={(e) => setBillFooter(e.target.value)} maxLength={120} />
      </div>

      <h3 className="settings-h" style={{ fontSize: "1rem" }}>
        {t("settings.kotFields")}
      </h3>
      <label className="switch-row">
        <input type="checkbox" checked={kotShowOrderBy} onChange={(e) => setKotShowOrderBy(e.target.checked)} />
        <span>{t("settings.showOrderBy")}</span>
      </label>
      <div className="field">
        <label>{t("settings.kotFooter")}</label>
        <input value={kotFooter} onChange={(e) => setKotFooter(e.target.value)} maxLength={120} />
      </div>

      <div className="form-footer">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

function PrintersSection() {
  const toast = useToast();
  const t = useT();
  const ask = useConfirm();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [system, setSystem] = useState<SystemPrinter[]>([]);
  const [edit, setEdit] = useState<(Omit<Printer, "id"> & { id?: string }) | null>(null);

  const load = useCallback(async () => {
    try {
      setPrinters(await api<Printer[]>("/printers"));
    } catch (e) {
      toast.push(errMsg(e, t("settings.printersLoadFailed")), "err");
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openEditor(p?: Printer) {
    setEdit(p ? { ...p } : { ...EMPTY_PRINTER });
    try {
      setSystem(await api<SystemPrinter[]>("/printers/system"));
    } catch {
      setSystem([]);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const { id, ...body } = edit;
    try {
      if (id) await api(`/printers/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/printers", { method: "POST", body: JSON.stringify(body) });
      toast.push(t("settings.printerSaved"), "ok");
      setEdit(null);
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("settings.saveFailed")), "err");
    }
  }

  async function test(p: Printer) {
    try {
      await api(`/printers/${p.id}/test`, { method: "POST", body: "{}" });
      toast.push(t("settings.testSent"), "info");
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  async function remove(p: Printer) {
    if (!(await ask({ title: t("settings.removePrinter"), body: t("settings.removePrinterConfirm", { name: p.name }), danger: true }))) return;
    try {
      await api(`/printers/${p.id}`, { method: "DELETE" });
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  async function toggle(p: Printer, patch: Partial<Printer>) {
    try {
      await api(`/printers/${p.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  function kindLabel(kind: Printer["kind"]) {
    if (kind === "WINDOWS") return t("settings.usb");
    if (kind === "NETWORK") return t("settings.lan");
    return t("settings.previewFile");
  }

  return (
    <div className="panel panel-pad settings-block">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 className="settings-h" style={{ margin: 0 }}>{t("settings.printers")}</h2>
          <p className="tiny muted" style={{ margin: "0.2rem 0 0" }}>
            {t("settings.printersHint")}
          </p>
          <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
            {t("settings.printersIndustrial")}
          </p>
        </div>
        <button type="button" className="btn sm" onClick={() => void openEditor()}>
          {t("settings.addPrinter")}
        </button>
      </div>
      <table style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>{t("common.name")}</th>
            <th>{t("settings.station")}</th>
            <th>{t("common.type")}</th>
            <th>{t("settings.target")}</th>
            <th>{t("settings.kitchenSlip")}</th>
            <th>{t("settings.bill")}</th>
            <th>{t("common.active")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {printers.map((p) => (
            <tr key={p.id}>
              <td>
                {p.name}
                {p.categories && <div className="tiny muted">{t("settings.only")} {p.categories}</div>}
              </td>
              <td className="tiny">{p.station || "—"}</td>
              <td>{kindLabel(p.kind)}</td>
              <td className="tiny">{p.target || (p.kind === "FILE" ? "data/prints" : "—")}</td>
              <td>
                <input type="checkbox" checked={p.printsKot} onChange={(e) => void toggle(p, { printsKot: e.target.checked })} />
              </td>
              <td>
                <input type="checkbox" checked={p.printsBill} onChange={(e) => void toggle(p, { printsBill: e.target.checked })} />
              </td>
              <td>
                <input type="checkbox" checked={p.active} onChange={(e) => void toggle(p, { active: e.target.checked })} />
              </td>
              <td className="row">
                <button type="button" className="btn ghost sm" onClick={() => void test(p)}>
                  {t("settings.testPrint")}
                </button>
                <button type="button" className="btn ghost sm" onClick={() => void openEditor(p)}>
                  {t("common.edit")}
                </button>
                <button type="button" className="btn danger sm" onClick={() => void remove(p)}>
                  {t("common.remove")}
                </button>
              </td>
            </tr>
          ))}
          {!printers.length && (
            <tr>
              <td colSpan={8} className="empty">
                {t("settings.noPrinters")}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Modal open={!!edit} title={edit?.id ? t("settings.editPrinter") : t("settings.addPrinterTitle")} onClose={() => setEdit(null)}>
        {edit && (
          <form onSubmit={save}>
            <div className="modal-scroll">
            <div className="field">
              <label>{t("common.name")}</label>
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>{t("settings.station")}</label>
              <input
                value={edit.station}
                onChange={(e) => setEdit({ ...edit, station: e.target.value })}
                placeholder={t("settings.stationPh")}
              />
              <p className="tiny muted">{t("settings.stationHint")}</p>
            </div>
            <div className="field">
              <label>{t("settings.connOptions")}</label>
              <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Printer["kind"], target: "" })}>
                <option value="NETWORK">{t("settings.lan")}</option>
                <option value="WINDOWS">{t("settings.usb")}</option>
                <option value="FILE">{t("settings.previewFile")}</option>
              </select>
            </div>
            {edit.kind === "WINDOWS" && (
              <div className="field">
                <label>{t("settings.windowsPrinter")}</label>
                <select value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value })} required>
                  <option value="">{t("settings.selectPrinter")}</option>
                  {system.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} {s.isDefault ? t("settings.default") : ""} — {s.port}
                    </option>
                  ))}
                </select>
                {!system.length && (
                  <p className="tiny muted">{t("settings.noWinPrinters")}</p>
                )}
              </div>
            )}
            {edit.kind === "NETWORK" && (
              <div className="field">
                <label>{t("settings.printerIp")}</label>
                <input
                  value={edit.target}
                  onChange={(e) => setEdit({ ...edit, target: e.target.value })}
                  placeholder="192.168.100.51:9100"
                  required
                />
                <p className="tiny muted">{t("settings.networkPrinterHint")}</p>
              </div>
            )}
            {edit.kind === "FILE" && (
              <div className="field">
                <label>{t("settings.folder")}</label>
                <input value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value })} placeholder={t("common.optional")} />
              </div>
            )}
            <div className="field">
              <label>{t("settings.paper")}</label>
              <select value={edit.paperWidth} onChange={(e) => setEdit({ ...edit, paperWidth: Number(e.target.value) })}>
                <option value={80}>{t("settings.paper80")}</option>
                <option value={58}>{t("settings.paper58")}</option>
              </select>
            </div>
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={edit.printsKot} onChange={(e) => setEdit({ ...edit, printsKot: e.target.checked })} /> {t("settings.kitchenSlip")}
              </label>
              <label className="check">
                <input type="checkbox" checked={edit.printsBill} onChange={(e) => setEdit({ ...edit, printsBill: e.target.checked })} /> {t("settings.bill")}
              </label>
              <label className="check">
                <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> {t("common.active")}
              </label>
            </div>
            <div className="field">
              <label>{t("settings.categoriesHint")}</label>
              <input value={edit.categories} onChange={(e) => setEdit({ ...edit, categories: e.target.value })} />
            </div>
            </div>
            <div className="form-actions">
              <button className="btn" type="submit">
                {t("common.save")}
              </button>
              <button className="btn ghost" type="button" onClick={() => setEdit(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function JobsSection() {
  const toast = useToast();
  const t = useT();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs(await api<Job[]>("/print/jobs"));
    } catch {
      /* section stays empty */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [load]);

  useSocketEvent("print.failed", () => void load());
  useSocketEvent("print.done", () => void load());

  async function retry(id: string) {
    try {
      await api(`/print/jobs/${id}/retry`, { method: "POST", body: "{}" });
      toast.push(t("settings.queuedRetry"), "info");
      void load();
    } catch (e) {
      toast.push(errMsg(e, t("common.failed")), "err");
    }
  }

  async function show(id: string) {
    try {
      const r = await api<{ text: string }>(`/print/jobs/${id}/preview`);
      setPreview(r.text);
    } catch (e) {
      toast.push(errMsg(e, t("kot.previewFailed")), "err");
    }
  }

  function jobTypeLabel(type: string) {
    if (type === "KOT") return t("settings.kitchenSlip");
    if (type === "BILL") return t("settings.bill");
    return t("settings.testPrint");
  }

  return (
    <div className="panel panel-pad settings-block">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="settings-h" style={{ margin: 0 }}>{t("settings.printQueue")}</h2>
        <button type="button" className="btn ghost sm" onClick={() => void load()}>
          {t("common.refresh")}
        </button>
      </div>
      <table style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>{t("common.time")}</th>
            <th>{t("common.type")}</th>
            <th>{t("common.order")}</th>
            <th>{t("settings.printer")}</th>
            <th>{t("common.status")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td className="tiny">{new Date(j.createdAt).toLocaleTimeString("en-PK")}</td>
              <td>{jobTypeLabel(j.type)}</td>
              <td>{j.orderNo ? `#${j.orderNo} ${j.tableNo ?? ""}` : "—"}</td>
              <td>{j.printer ?? "—"}</td>
              <td>
                <span className={`badge ${j.status === "DONE" ? "paid" : j.status === "FAILED" ? "unpaid" : "pending"}`}>
                  {j.status}
                </span>
                {j.lastError && <div className="tiny" style={{ color: "var(--danger)" }}>{j.lastError}</div>}
              </td>
              <td className="row">
                {j.status !== "FAILED" || j.lastError?.startsWith("No ") ? null : (
                  <button type="button" className="btn ghost sm" onClick={() => void retry(j.id)}>
                    {t("settings.retryJob")}
                  </button>
                )}
                {j.printer && (
                  <button type="button" className="btn ghost sm" onClick={() => void show(j.id)}>
                    {t("settings.preview")}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!jobs.length && (
            <tr>
              <td colSpan={6} className="empty">
                {t("settings.noJobs")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Modal open={preview != null} title={t("settings.printPreview")} onClose={() => setPreview(null)}>
        <div className="modal-scroll">
          <pre className="print-preview">{preview}</pre>
        </div>
      </Modal>
    </div>
  );
}

function TablesSection() {
  const toast = useToast();
  const t = useT();
  const [tables, setTables] = useState<Table[]>([]);
  const [partitions, setPartitions] = useState<Partition[]>([]);
  const [name, setName] = useState("");
  const [partitionId, setPartitionId] = useState("");
  const [partName, setPartName] = useState("");

  const load = useCallback(async () => {
    try {
      const [all, parts] = await Promise.all([
        api<Table[]>("/tables/all"),
        api<Partition[]>("/tables/partitions"),
      ]);
      setTables(all);
      setPartitions(parts);
      setPartitionId((prev) => prev || parts[0]?.id || "");
    } catch (e) {
      toast.push(errMsg(e, t("settings.printersLoadFailed")), "err");
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <div className="panel panel-pad settings-block">
      <h2 className="settings-h">{t("settings.tables")}</h2>

      <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>{t("settings.partitions")}</h3>
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
      <div className="chips" style={{ marginTop: "0.6rem", marginBottom: "1rem" }}>
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
      </div>

      <form className="row tables-add" onSubmit={add}>
        <div className="field" style={{ margin: 0, flex: "1 1 140px" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.tableNamePh")} />
        </div>
        <div className="field" style={{ margin: 0, flex: "1 1 160px" }}>
          <select value={partitionId} onChange={(e) => setPartitionId(e.target.value)} required>
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
      <div className="chips" style={{ marginTop: "0.75rem" }}>
        {tables.map((tbl) => (
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
      </div>
    </div>
  );
}

function BackupSection() {
  const toast = useToast();
  const t = useT();
  const ask = useConfirm();
  const [dir, setDir] = useState("");
  const [files, setFiles] = useState<Backup[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ dir: string; files: Backup[] }>("/system/backups");
      setDir(r.dir);
      setFiles(r.files);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function backupNow() {
    setBusy(true);
    try {
      await api("/system/backups", { method: "POST", body: "{}" });
      toast.push(t("settings.backupCreated"), "ok");
      void load();
    } catch (e) {
      toast.push(errMsg(e, t("common.failed")), "err");
    } finally {
      setBusy(false);
    }
  }

  async function restore(b: Backup) {
    if (!(await ask({ title: t("settings.restoreTitle"), body: t("settings.restoreConfirm", { file: b.file }), danger: true, confirmLabel: t("settings.restore") }))) return;
    setBusy(true);
    try {
      await api(`/system/backups/${encodeURIComponent(b.file)}/restore`, { method: "POST", body: "{}" });
      toast.push(t("settings.restoreOk"), "ok");
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      toast.push(errMsg(e, t("common.failed")), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-pad settings-block">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 className="settings-h" style={{ margin: 0 }}>{t("settings.backup")}</h2>
          <p className="tiny muted" style={{ margin: "0.2rem 0 0" }}>
            {t("settings.backupHint")} <code>{dir}</code>
          </p>
        </div>
        <button type="button" className="btn sm" disabled={busy} onClick={() => void backupNow()}>
          {busy ? t("settings.working") : t("settings.backupNow")}
        </button>
      </div>
      <table style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>{t("settings.file")}</th>
            <th>{t("settings.size")}</th>
            <th>{t("settings.date")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.map((b) => (
            <tr key={b.file}>
              <td className="tiny">
                {b.file}{" "}
                <span className={`badge ${b.kind === "monthly" ? "paid" : "ready"}`}>
                  {t(BACKUP_KIND_KEY[b.kind || (b.auto ? "daily" : "manual")] ?? "settings.kindManual")}
                </span>
              </td>
              <td>{(b.size / 1024).toFixed(0)} KB</td>
              <td className="tiny">{new Date(b.createdAt).toLocaleString("en-PK")}</td>
              <td>
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void restore(b)}>
                  {t("settings.restore")}
                </button>
              </td>
            </tr>
          ))}
          {!files.length && (
            <tr>
              <td colSpan={4} className="empty">
                {t("settings.noBackups")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
