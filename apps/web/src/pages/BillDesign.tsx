import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, uploadApi } from "../api";
import { useAuth } from "../auth";
import { useBrand } from "../brand";
import { BILL_FIELD_CHIPS } from "../bill-builder/default-bill";
import { isBillBuilderUnlocked } from "../bill-builder/dev-unlock";
import {
  GrapesBillEditor,
  type BillLayerRow,
  type GrapesBillEditorHandle,
} from "../components/GrapesBillEditor";
import { ThermalPreview } from "../components/ThermalPreview";
import { useT } from "../i18n";
import { useToast } from "../toast";
import { acquireScrollLock, releaseScrollLock } from "../scroll-lock";

type LeftTab = "elements" | "keys" | "layers";
type RightTab = "general" | "styles" | "css" | "html" | "preview";

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

export function BillDesignPage() {
  const { can } = useAuth();
  const toast = useToast();
  const t = useT();
  const { brand, logoSrc, refresh } = useBrand();
  const editorApi = useRef<GrapesBillEditorHandle | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [loaded, setLoaded] = useState(false);
  const [projectJson, setProjectJson] = useState<string | null>(null);
  const [title, setTitle] = useState("Customer Bill");
  const [footer, setFooter] = useState("Thanks for your Visit..");
  const [customCss, setCustomCss] = useState("");
  const [htmlDraft, setHtmlDraft] = useState("");
  const [cssDraft, setCssDraft] = useState("");
  const [paperWidth, setPaperWidth] = useState<58 | 72 | 80 | 112>(80);
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("elements");
  const [rightTab, setRightTab] = useState<RightTab>("preview");
  const [previewMode, setPreviewMode] = useState<"design" | "print">("design");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [layers, setLayers] = useState<BillLayerRow[]>([]);
  const [keySearch, setKeySearch] = useState("");

  function refreshLayers() {
    const rows = editorApi.current?.listLayers() || [];
    setLayers(rows);
  }
  const [preview, setPreview] = useState<{
    text: string;
    paperWidth: number;
    logoUrl?: string | null;
    paidStampUrl?: string | null;
    unpaidStampUrl?: string | null;
  } | null>(null);

  const designPreviewDoc = useMemo(() => {
    const css = cssDraft || "";
    const html = htmlDraft || "<div class='bill-slip'><p>Add sections from Elements</p></div>";
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
html,body{margin:0;background:#e8eef3;min-height:100%;}
body{display:flex;justify-content:center;padding:12px 8px 24px;box-sizing:border-box;}
.bill-slip{width:${paperWidth}mm;max-width:100%;margin:0 auto;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.08);box-sizing:content-box;}
${css}
</style></head><body>${html}</body></html>`;
  }, [htmlDraft, cssDraft, paperWidth]);

  const brandPreview = useMemo(
    () => ({
      name: brand.name,
      phone: brand.phone,
      address: brand.address,
      tagline: brand.tagline,
      logoUrl: logoSrc,
      title,
      footer,
    }),
    [brand, logoSrc, title, footer]
  );

  const keys = useMemo(() => {
    const q = keySearch.trim().toLowerCase();
    return BILL_FIELD_CHIPS.filter(
      (f) => !q || f.token.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
    );
  }, [keySearch]);

  useEffect(() => {
    acquireScrollLock();
    return () => releaseScrollLock();
  }, []);

  useEffect(() => {
    api<{
      print: {
        bill: {
          template?: string;
          grapesProject?: string | null;
          title?: string;
          footer?: string;
          customCss?: string;
        };
      };
    }>("/system/settings")
      .then((s) => {
        setProjectJson(s.print?.bill?.grapesProject || null);
        setTitle(s.print?.bill?.title || "Customer Bill");
        setFooter(s.print?.bill?.footer || "Thanks for your Visit..");
        setCustomCss(s.print?.bill?.customCss || "");
        if (s.print?.bill?.template) setTemplate(s.print.bill.template);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (previewMode !== "print" || !template.trim()) {
      if (previewMode !== "print") return;
      setPreview(null);
      return;
    }
    const handle = window.setTimeout(() => {
      api<{
        text: string;
        paperWidth: number;
        logoUrl?: string | null;
        paidStampUrl?: string | null;
        unpaidStampUrl?: string | null;
      }>("/system/bill-preview", {
        method: "POST",
        body: JSON.stringify({ template, title, footer, paperWidth }),
      })
        .then(setPreview)
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [template, title, footer, paperWidth, logoSrc, previewMode]);

  async function onLogoFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await uploadApi("/system/logo", form);
      await refresh();
      toast.push(t("settings.logoSaved"), "ok");
    } catch (e) {
      toast.push(errMsg(e, t("settings.logoFailed")), "err");
    } finally {
      setUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function removeLogo() {
    setUploading(true);
    try {
      await api("/system/logo", { method: "DELETE" });
      await refresh();
      editorApi.current?.setLogoUrl(null);
      toast.push(t("settings.logoRemoved"), "ok");
    } catch (e) {
      toast.push(errMsg(e, t("settings.logoFailed")), "err");
    } finally {
      setUploading(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const apiHandle = editorApi.current;
    if (!apiHandle) return;
    setBusy(true);
    try {
      const nextTemplate = apiHandle.getTemplate();
      const nextProject = apiHandle.getProjectJson();
      await api("/system/settings", {
        method: "PATCH",
        body: JSON.stringify({
          billTemplate: nextTemplate,
          billGrapesProject: nextProject,
          billCustomCss: customCss,
          billTitle: title.trim() || "Customer Bill",
          billFooter: footer,
        }),
      });
      setTemplate(nextTemplate);
      setProjectJson(nextProject);
      toast.push(t("settings.saved"), "ok");
    } catch (err) {
      toast.push(errMsg(err, t("settings.saveFailed")), "err");
    } finally {
      setBusy(false);
    }
  }

  if (!can("system.manage")) return <Navigate to="/" replace />;
  // Builder is developer-only — unlock via special key on /developer
  if (!isBillBuilderUnlocked()) return <Navigate to="/developer" replace />;

  return (
    <form className="ghl-builder" onSubmit={save}>
      {/* TOP BAR — GHL style */}
      <header className="ghl-topbar">
        <div className="ghl-topbar-left">
          <Link to="/developer" className="ghl-exit">
            ← Developer
          </Link>
          <div className="ghl-topbar-title">
            <strong>{t("billBuilder.title")}</strong>
            <span className="tiny muted">{brand.name} · {t("dev.billBuilderBadge")}</span>
          </div>
        </div>

        <div className="ghl-topbar-center">
          <div className="paper-size-tabs ghl-devices" role="tablist">
            {(
              [
                [58, "58"],
                [72, "72"],
                [80, "80"],
                [112, "112"],
              ] as const
            ).map(([mm, label]) => (
              <button
                key={mm}
                type="button"
                className={paperWidth === mm ? "active" : undefined}
                onClick={() => setPaperWidth(mm)}
              >
                {label}mm
              </button>
            ))}
          </div>
          <button type="button" className="btn ghost" onClick={() => editorApi.current?.undo()}>
            Undo
          </button>
          <button type="button" className="btn ghost" onClick={() => editorApi.current?.redo()}>
            Redo
          </button>
        </div>

        <div className="ghl-topbar-right">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(ev) => void onLogoFile(ev.target.files?.[0] || null)}
          />
          <button type="button" className="btn ghost" disabled={uploading} onClick={() => logoInputRef.current?.click()}>
            {uploading ? t("common.loading") : t("settings.uploadLogo")}
          </button>
          {logoSrc ? (
            <button type="button" className="btn ghost" disabled={uploading} onClick={() => void removeLogo()}>
              {t("settings.removeLogo")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              if (!window.confirm("Reset to new seeded design? (table + PAID/UNPAID stamps with z-index)")) return;
              editorApi.current?.resetDefault();
              toast.push("Design reset — Save to keep", "ok");
            }}
          >
            {t("billBuilder.resetTemplate")}
          </button>
          <button type="button" className="btn ghost" onClick={() => setRightTab("preview")}>
            Preview
          </button>
          <button className="btn" type="submit" disabled={busy || !loaded}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </header>

      <div className="ghl-workspace">
        {/* LEFT — Elements / Keys / Layers */}
        <aside className="ghl-left">
          <div className="ghl-tabs">
            {(
              [
                ["elements", "Elements"],
                ["keys", "Keys"],
                ["layers", "Layers"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={leftTab === id ? "active" : undefined}
                onClick={() => setLeftTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={`ghl-left-pane ${leftTab === "elements" ? "is-on" : ""}`}>
            <p className="ghl-hint">Drag sections onto the bill canvas</p>
            <div id="ghl-blocks" className="ghl-blocks-host" />
          </div>

          <div className={`ghl-left-pane ${leftTab === "keys" ? "is-on" : ""}`}>
            <p className="ghl-hint">Predefined item keys — click to insert into design</p>
            <input
              className="ghl-search"
              value={keySearch}
              onChange={(e) => setKeySearch(e.target.value)}
              placeholder="Search keys…"
            />
            <ul className="ghl-keys">
              {keys.map((f) => (
                <li key={f.token}>
                  <button
                    type="button"
                    className="ghl-key-btn"
                    onClick={() => editorApi.current?.insertToken(f.token)}
                    title={`Insert {{${f.token}}}`}
                  >
                    <span>{f.label}</span>
                    <code>{`{{${f.token}}}`}</code>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className={`ghl-left-pane ${leftTab === "layers" ? "is-on" : ""}`}>
            <p className="ghl-hint">
              Full layer access — select, rename, ↑↓ reorder, show/hide, lock, delete. Drag also works in the tree
              below.
            </p>
            <ul className="ghl-layer-list">
              {layers.length === 0 ? (
                <li className="tiny muted">No layers yet — reset design or add Elements</li>
              ) : (
                layers.map((row) => (
                  <li
                    key={row.id}
                    className={`ghl-layer-row ${selectedLayerId === row.id ? "is-selected" : ""} ${
                      !row.visible ? "is-hidden" : ""
                    } ${row.locked ? "is-locked" : ""}`}
                  >
                    <button
                      type="button"
                      className="ghl-layer-select"
                      onClick={() => {
                        editorApi.current?.selectLayer(row.id);
                        setSelectedLayerId(row.id);
                        setSelectedName(row.name);
                      }}
                    >
                      <input
                        className="ghl-layer-name"
                        value={row.name}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const name = e.target.value;
                          setLayers((prev) => prev.map((r) => (r.id === row.id ? { ...r, name } : r)));
                        }}
                        onBlur={(e) => {
                          editorApi.current?.renameLayer(row.id, e.target.value);
                          refreshLayers();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                      {row.block ? <code className="ghl-layer-token">{`{{${row.block}}}`}</code> : null}
                    </button>
                    <div className="ghl-layer-actions">
                      <button
                        type="button"
                        title="Move up"
                        disabled={row.index === 0 || row.locked}
                        onClick={() => {
                          editorApi.current?.moveLayer(row.id, -1);
                          refreshLayers();
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        disabled={row.index >= row.total - 1 || row.locked}
                        onClick={() => {
                          editorApi.current?.moveLayer(row.id, 1);
                          refreshLayers();
                        }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        title={row.visible ? "Hide" : "Show"}
                        onClick={() => {
                          editorApi.current?.setLayerVisible(row.id, !row.visible);
                          refreshLayers();
                        }}
                      >
                        {row.visible ? "◉" : "○"}
                      </button>
                      <button
                        type="button"
                        title={row.locked ? "Unlock" : "Lock"}
                        onClick={() => {
                          editorApi.current?.setLayerLocked(row.id, !row.locked);
                          refreshLayers();
                        }}
                      >
                        {row.locked ? "🔒" : "🔓"}
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        disabled={row.locked}
                        onClick={() => {
                          if (!window.confirm(`Delete layer “${row.name}”?`)) return;
                          editorApi.current?.removeLayer(row.id);
                          if (selectedLayerId === row.id) setSelectedLayerId(null);
                          refreshLayers();
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
            <details className="ghl-native-layers">
              <summary>GrapesJS tree (drag reorder)</summary>
              <div id="ghl-layers-native" className="ghl-layers-host" />
            </details>
          </div>
        </aside>

        {/* CENTER — Canvas */}
        <main className="ghl-canvas">
          {logoSrc ? <img src={logoSrc} alt="" className="ghl-canvas-logo-badge" /> : null}
          {loaded ? (
            <GrapesBillEditor
              paperWidth={paperWidth}
              projectJson={projectJson}
              brand={brandPreview}
              customCss={customCss}
              onReady={(apiHandle) => {
                editorApi.current = apiHandle;
                const snap = apiHandle.getDesignSnapshot();
                setTemplate(apiHandle.getTemplate());
                setHtmlDraft(snap.html);
                setCssDraft(snap.css);
                setLayers(apiHandle.listLayers());
              }}
              onChange={(tpl, design) => {
                setTemplate(tpl);
                setHtmlDraft(design.html);
                setCssDraft(design.css);
              }}
              onSelectName={setSelectedName}
              onSelectLayerId={setSelectedLayerId}
              onLayersChange={refreshLayers}
            />
          ) : (
            <p className="tiny muted" style={{ padding: "2rem" }}>
              {t("settings.billPreviewLoading")}
            </p>
          )}
        </main>

        {/* RIGHT — General / Styles / CSS / HTML / Preview */}
        <aside className="ghl-right">
          <div className="ghl-tabs ghl-tabs--wrap">
            {(
              [
                ["general", "General"],
                ["styles", "Styles"],
                ["css", "Custom CSS"],
                ["html", "HTML"],
                ["preview", "Preview"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={rightTab === id ? "active" : undefined}
                onClick={() => setRightTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={`ghl-right-pane ${rightTab === "general" ? "is-on" : ""}`}>
            <div className="ghl-selected">
              Selected: <strong>{selectedName || "Bill slip"}</strong>
            </div>
            <div className="field">
              <label>{t("settings.billTitle")}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />
            </div>
            <div className="field">
              <label>{t("settings.billFooter")}</label>
              <input value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={120} />
            </div>
            <p className="ghl-hint">
              Canvas pe text pe <strong>double-click</strong> karke edit karo. Styles tab se font/size/color.
              Free move (General → traits) se overlay.
            </p>
            <div id="ghl-traits" />
            {logoSrc ? (
              <div className="ghl-logo-card">
                <img src={logoSrc} alt="" />
                <span className="tiny muted">Current logo</span>
              </div>
            ) : (
              <p className="tiny muted">No logo — upload from top bar</p>
            )}
          </div>

          <div className={`ghl-right-pane ${rightTab === "styles" ? "is-on" : ""}`}>
            <p className="ghl-hint">
              Pehle canvas pe section / text select karo, phir size dabao. Stamps ke liye{" "}
              <strong>z-index 90+</strong> (General → Free move).
            </p>
            <div className="ghl-style-quick">
              <span className="ghl-style-quick-label">Font size</span>
              <div className="ghl-style-quick-row">
                {["9px", "10px", "11px", "12px", "14px", "16px", "18px", "22px", "28px"].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    title={`Font ${sz}`}
                    onClick={() => editorApi.current?.applySelectedStyle({ "font-size": sz })}
                  >
                    {sz.replace("px", "")}
                  </button>
                ))}
              </div>
              <span className="ghl-style-quick-label">Weight / align</span>
              <div className="ghl-style-quick-row">
                <button type="button" onClick={() => editorApi.current?.applySelectedStyle({ "font-weight": "400" })}>
                  Normal
                </button>
                <button type="button" onClick={() => editorApi.current?.applySelectedStyle({ "font-weight": "700" })}>
                  Bold
                </button>
                <button type="button" onClick={() => editorApi.current?.applySelectedStyle({ "text-align": "left" })}>
                  Left
                </button>
                <button type="button" onClick={() => editorApi.current?.applySelectedStyle({ "text-align": "center" })}>
                  Center
                </button>
                <button type="button" onClick={() => editorApi.current?.applySelectedStyle({ "text-align": "right" })}>
                  Right
                </button>
              </div>
              <span className="ghl-style-quick-label">Stamp layer (z-index)</span>
              <div className="ghl-style-quick-row">
                <button
                  type="button"
                  onClick={() =>
                    editorApi.current?.applySelectedStyle({
                      position: "absolute",
                      "z-index": "90",
                      top: "40%",
                      left: "10%",
                      width: "80%",
                    })
                  }
                >
                  PAID ↑90
                </button>
                <button
                  type="button"
                  onClick={() =>
                    editorApi.current?.applySelectedStyle({
                      position: "absolute",
                      "z-index": "91",
                      top: "55%",
                      left: "10%",
                      width: "80%",
                    })
                  }
                >
                  UNPAID ↑91
                </button>
                <button
                  type="button"
                  onClick={() =>
                    editorApi.current?.applySelectedStyle({
                      position: "relative",
                      "z-index": "auto",
                      top: "auto",
                      left: "auto",
                      width: "100%",
                    })
                  }
                >
                  Normal flow
                </button>
              </div>
              <span className="ghl-style-quick-label">Bill size (whole slip)</span>
              <div className="ghl-style-quick-row">
                <button
                  type="button"
                  onClick={() =>
                    editorApi.current?.applySlipStyle({
                      "font-size": "10px",
                      padding: "4px",
                      "line-height": "1.15",
                      "min-height": "0",
                    })
                  }
                >
                  Compact
                </button>
                <button
                  type="button"
                  onClick={() =>
                    editorApi.current?.applySlipStyle({
                      "font-size": "11px",
                      padding: "6px",
                      "line-height": "1.25",
                    })
                  }
                >
                  Default
                </button>
                <button
                  type="button"
                  onClick={() =>
                    editorApi.current?.applySlipStyle({
                      "font-size": "13px",
                      padding: "8px",
                      "line-height": "1.35",
                    })
                  }
                >
                  Large
                </button>
              </div>
            </div>
            <div id="ghl-selectors" />
            <div id="ghl-styles" className="ghl-styles-host" />
          </div>

          <div className={`ghl-right-pane ${rightTab === "css" ? "is-on" : ""}`}>
            <p className="ghl-hint">Custom CSS (GHL-style) — applies to the bill canvas</p>
            <textarea
              className="ghl-code"
              value={customCss}
              onChange={(e) => {
                const v = e.target.value;
                setCustomCss(v);
                editorApi.current?.setCustomCss(v);
              }}
              spellCheck={false}
              placeholder={`.bill-slip {\n  /* your overrides */\n}\n.bill-block--bold {\n  font-size: 14px;\n}`}
              rows={18}
            />
          </div>

          <div className={`ghl-right-pane ${rightTab === "html" ? "is-on" : ""}`}>
            <p className="ghl-hint">Live HTML from the canvas (read for debug / copy)</p>
            <textarea className="ghl-code" value={htmlDraft} readOnly spellCheck={false} rows={18} />
          </div>

          <div className={`ghl-right-pane ${rightTab === "preview" ? "is-on" : ""}`}>
            <div className="ghl-preview-modes" role="tablist">
              <button
                type="button"
                className={previewMode === "design" ? "active" : undefined}
                onClick={() => setPreviewMode("design")}
              >
                Design (live)
              </button>
              <button
                type="button"
                className={previewMode === "print" ? "active" : undefined}
                onClick={() => setPreviewMode("print")}
              >
                Print sample
              </button>
            </div>
            <p className="ghl-hint">
              {previewMode === "design"
                ? "Live canvas — jo edit karoge yahan turant dikhega."
                : "Thermal print sample — live order tokens ({{items}}, {{totals}}…)."}
            </p>
            {previewMode === "design" ? (
              <iframe
                title="Bill design preview"
                className="ghl-design-preview"
                sandbox=""
                srcDoc={designPreviewDoc}
              />
            ) : (
              <div className="bill-design-preview-frame" style={{ ["--preview-mm" as string]: `${paperWidth}mm` }}>
                {preview?.text ? (
                  <ThermalPreview
                    text={preview.text}
                    paperWidth={preview.paperWidth || paperWidth}
                    logoUrl={logoSrc || preview.logoUrl}
                    paidStampUrl={preview.paidStampUrl}
                    unpaidStampUrl={preview.unpaidStampUrl}
                  />
                ) : (
                  <p className="tiny muted">{t("settings.billPreviewLoading")}</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </form>
  );
}
