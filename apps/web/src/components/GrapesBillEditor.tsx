import { useEffect, useRef } from "react";
import grapesjs, { type Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import {
  BILL_FIELD_CHIPS,
  DEFAULT_BILL_CSS,
  billBlockDefs,
  buildDefaultBillHtml,
  logoBlockInnerHtml,
  type BillBrandPreview,
} from "../bill-builder/default-bill";
import {
  exportBillTemplate,
  exportDesignSnapshot,
  exportGrapesProject,
} from "../bill-builder/export-template";
import {
  CANVAS_THERMAL_CSS,
  fullStyleManagerSectors,
  registerBillComponents,
} from "../bill-builder/grapes-setup";
import {
  listBillLayers,
  moveBillLayer,
  openAllLayers,
  removeBillLayer,
  renameBillLayer,
  selectBillLayer,
  setBillLayerLocked,
  setBillLayerVisible,
  type BillLayerRow,
} from "../bill-builder/bill-layers";

export type GrapesBillEditorHandle = {
  getTemplate: () => string;
  getProjectJson: () => string;
  getHtml: () => string;
  getCss: () => string;
  getDesignSnapshot: () => { html: string; css: string };
  resetDefault: () => void;
  setLogoUrl: (url: string | null) => void;
  setCustomCss: (css: string) => void;
  undo: () => void;
  redo: () => void;
  insertToken: (token: string) => void;
  listLayers: () => BillLayerRow[];
  selectLayer: (id: string) => void;
  moveLayer: (id: string, dir: -1 | 1) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  setLayerLocked: (id: string, locked: boolean) => void;
  removeLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  /** Apply CSS to selection (and nested text if a section is selected). */
  applySelectedStyle: (style: Record<string, string>) => void;
  /** Apply CSS to the whole .bill-slip (bill size / padding). */
  applySlipStyle: (style: Record<string, string>) => void;
  getSelectedName: () => string | null;
};

export type { BillLayerRow };

type Props = {
  paperWidth: 58 | 72 | 80 | 112;
  projectJson?: string | null;
  brand?: BillBrandPreview;
  customCss?: string;
  onReady?: (api: GrapesBillEditorHandle) => void;
  onChange?: (template: string, design: { html: string; css: string }) => void;
  onSelectName?: (name: string | null) => void;
  onSelectLayerId?: (id: string | null) => void;
  onLayersChange?: () => void;
};

function paperPx(mm: number) {
  if (mm <= 58) return 32 * 7 + 24;
  if (mm <= 72) return 42 * 7 + 24;
  if (mm <= 80) return 48 * 7 + 24;
  return 64 * 7 + 28;
}

function applyDefault(editor: Editor, brand?: BillBrandPreview, customCss = "") {
  editor.setComponents(buildDefaultBillHtml(brand));
  editor.setStyle(`${DEFAULT_BILL_CSS}\n${customCss}`);
}

function syncLogoInCanvas(editor: Editor, logoUrl: string | null) {
  const comps = editor.getWrapper()?.find?.('[data-bill-block="logo"]') || [];
  for (const comp of comps) {
    comp.components(logoBlockInnerHtml(logoUrl));
  }
  const bm = editor.BlockManager;
  const logoDef = billBlockDefs(logoUrl).find((d) => d.id === "bill-logo");
  if (logoDef) {
    try {
      bm.remove("bill-logo");
    } catch {
      /* */
    }
    bm.add(logoDef.id, {
      label: logoDef.label,
      category: logoDef.category,
      content: logoDef.content,
    });
  }
}

function enableTextEditing(editor: Editor) {
  const domc = editor.DomComponents;
  try {
    const textType = domc.getType("text");
    if (textType?.model) {
      const defs = textType.model.prototype.defaults || {};
      textType.model.prototype.defaults = {
        ...defs,
        editable: true,
        highlightable: true,
        selectable: true,
        hoverable: true,
      };
    }
  } catch {
    /* */
  }
}

export function GrapesBillEditor({
  paperWidth,
  projectJson,
  brand,
  customCss = "",
  onReady,
  onChange,
  onSelectName,
  onSelectLayerId,
  onLayersChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const brandRef = useRef(brand);
  brandRef.current = brand;
  const customCssRef = useRef(customCss);
  customCssRef.current = customCss;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectRef = useRef(onSelectName);
  onSelectRef.current = onSelectName;
  const onSelectLayerIdRef = useRef(onSelectLayerId);
  onSelectLayerIdRef.current = onSelectLayerId;
  const onLayersRef = useRef(onLayersChange);
  onLayersRef.current = onLayersChange;

  useEffect(() => {
    if (!hostRef.current || editorRef.current) return;

    const editor = grapesjs.init({
      container: hostRef.current,
      height: "100%",
      width: "auto",
      fromElement: false,
      storageManager: false,
      noticeOnUnload: false,
      // Keep text editable; avoid clearing selection on every style tweak
      canvas: {
        styles: [CANVAS_THERMAL_CSS],
      },
      deviceManager: {
        devices: [
          { id: "mm58", name: "58 mm", width: `${paperPx(58)}px` },
          { id: "mm72", name: "72 mm", width: `${paperPx(72)}px` },
          { id: "mm80", name: "80 mm", width: `${paperPx(80)}px` },
          { id: "mm112", name: "112 mm", width: `${paperPx(112)}px` },
        ],
      },
      panels: { defaults: [] },
      blockManager: { appendTo: "#ghl-blocks" },
      layerManager: {
        appendTo: "#ghl-layers-native",
        sortable: true,
        hidable: true,
        root: ".bill-slip",
      },
      styleManager: {
        appendTo: "#ghl-styles",
        sectors: fullStyleManagerSectors(),
      },
      selectorManager: { appendTo: "#ghl-selectors" },
      traitManager: { appendTo: "#ghl-traits" },
      // Rich text toolbar for double-click edits
      richTextEditor: {
        actions: ["bold", "italic", "underline", "wrap"],
      },
    });

    registerBillComponents(editor);
    enableTextEditing(editor);

    const bm = editor.BlockManager;
    for (const b of billBlockDefs(brand?.logoUrl)) {
      bm.add(b.id, { label: b.label, category: b.category, content: b.content });
    }
    for (const f of BILL_FIELD_CHIPS) {
      bm.add(`field-${f.token}`, {
        label: f.label,
        category: "Keys / values",
        content: `<span class="bill-field" data-bill-field="${f.token}" data-gjs-type="text">{{${f.token}}}</span>`,
      });
    }

    try {
      if (projectJson?.trim()) {
        editor.loadProjectData(JSON.parse(projectJson));
        if (brand?.logoUrl) syncLogoInCanvas(editor, brand.logoUrl);
        if (customCss.trim()) {
          editor.setStyle(`${editor.getCss() || ""}\n${customCss}`);
        }
      } else {
        applyDefault(editor, brand, customCss);
      }
    } catch {
      applyDefault(editor, brand, customCss);
    }

    const deviceId =
      paperWidth <= 58 ? "mm58" : paperWidth <= 72 ? "mm72" : paperWidth <= 80 ? "mm80" : "mm112";
    editor.setDevice(deviceId);

    let emitTimer: number | undefined;
    const emit = (immediate = false) => {
      const run = () => {
        const snap = exportDesignSnapshot(editor);
        onChangeRef.current?.(exportBillTemplate(editor), snap);
        onLayersRef.current?.();
      };
      window.clearTimeout(emitTimer);
      if (immediate) {
        run();
        return;
      }
      // Debounce so typing / RTE doesn't thrash React state mid-edit
      emitTimer = window.setTimeout(run, 280);
    };

    editor.on("update", () => emit(false));
    editor.on("component:add", () => emit(true));
    editor.on("component:remove", () => emit(true));
    editor.on("component:drag:end", () => emit(true));
    editor.on("rte:disable", () => emit(true));
    editor.on("component:selected", (comp) => {
      const name = comp?.getName?.() || comp?.get?.("name") || null;
      onSelectRef.current?.(name);
      const id = (comp?.getId?.() || comp?.cid || null) as string | null;
      onSelectLayerIdRef.current?.(id);
      const free = comp?.getAttributes?.()?.["data-free-move"] === "1" || comp?.get?.("freeMove");
      editor.setDragMode(free ? "absolute" : "");
    });
    editor.on("component:deselected", () => {
      onSelectRef.current?.(null);
      onSelectLayerIdRef.current?.(null);
    });

    // Double-click section → select first text child so RTE can open
    editor.on("component:dblclick", (comp) => {
      if (!comp || comp.get?.("type") === "text") return;
      try {
        const nested = (comp.find?.('[data-gjs-type="text"]') || comp.find?.("div") || [])[0];
        if (nested && nested.get?.("type") === "text") {
          editor.select(nested);
        }
      } catch {
        /* native Grapes path */
      }
    });

    try {
      editor.Layers?.setRoot?.(".bill-slip");
    } catch {
      /* */
    }
    openAllLayers(editor);
    emit(true);

    const api: GrapesBillEditorHandle = {
      getTemplate: () => exportBillTemplate(editor),
      getProjectJson: () => exportGrapesProject(editor),
      getHtml: () => editor.getHtml() || "",
      getCss: () => editor.getCss() || "",
      getDesignSnapshot: () => exportDesignSnapshot(editor),
      resetDefault: () => {
        applyDefault(editor, brandRef.current, customCssRef.current);
        editor.setDragMode("");
        openAllLayers(editor);
        emit(true);
      },
      setLogoUrl: (url) => {
        syncLogoInCanvas(editor, url);
        emit(true);
      },
      setCustomCss: (css) => {
        customCssRef.current = css;
        const base = DEFAULT_BILL_CSS;
        editor.setStyle(`${base}\n${css}`);
        emit(true);
      },
      undo: () => editor.runCommand("core:undo"),
      redo: () => editor.runCommand("core:redo"),
      insertToken: (token) => {
        const selected = editor.getSelected();
        const chip = `{{${token}}}`;
        if (selected && selected.get("type") === "text") {
          const cur = String(selected.get("content") || "");
          selected.set("content", `${cur}${chip}`);
        } else {
          const slip = editor.getWrapper()?.find?.(".bill-slip")?.[0];
          const target = slip || editor.getWrapper();
          target?.append(
            `<div data-gjs-type="text" class="bill-text"><span class="bill-field" data-bill-field="${token}">${chip}</span></div>`
          );
        }
        emit(true);
      },
      listLayers: () => listBillLayers(editor),
      selectLayer: (id) => {
        selectBillLayer(editor, id);
        onLayersRef.current?.();
      },
      moveLayer: (id, dir) => {
        moveBillLayer(editor, id, dir);
        emit(true);
      },
      setLayerVisible: (id, visible) => {
        setBillLayerVisible(editor, id, visible);
        emit(true);
      },
      setLayerLocked: (id, locked) => {
        setBillLayerLocked(editor, id, locked);
        emit(true);
      },
      removeLayer: (id) => {
        removeBillLayer(editor, id);
        emit(true);
      },
      renameLayer: (id, name) => {
        renameBillLayer(editor, id, name);
        emit(true);
      },
      applySelectedStyle: (style) => {
        const sel = editor.getSelected();
        if (!sel) return;
        sel.addStyle(style);
        // Section select → also apply typography to nested text so size actually shows
        const typoKeys = ["font-size", "font-family", "font-weight", "color", "line-height", "text-align"];
        const hasTypo = typoKeys.some((k) => style[k] != null);
        if (hasTypo && sel.get("type") === "bill-section") {
          try {
            const nested = sel.find('[data-gjs-type="text"]') || [];
            nested.forEach((c) => c.addStyle(style));
          } catch {
            /* */
          }
        }
        emit(true);
      },
      applySlipStyle: (style) => {
        const slip = editor.getWrapper()?.find?.(".bill-slip")?.[0] || editor.getWrapper();
        slip?.addStyle?.(style);
        emit(true);
      },
      getSelectedName: () => {
        const sel = editor.getSelected();
        return (sel?.getName?.() || sel?.get?.("name") || null) as string | null;
      },
    };
    editorRef.current = editor;
    onReady?.(api);

    return () => {
      window.clearTimeout(emitTimer);
      editor.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const deviceId =
      paperWidth <= 58 ? "mm58" : paperWidth <= 72 ? "mm72" : paperWidth <= 80 ? "mm80" : "mm112";
    editor.setDevice(deviceId);
  }, [paperWidth]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    syncLogoInCanvas(editor, brand?.logoUrl ?? null);
  }, [brand?.logoUrl]);

  return <div ref={hostRef} className="ghl-gjs-host" />;
}
