import type { Editor } from "grapesjs";
import { DEFAULT_BILL_CSS } from "./default-bill";

/** CSS injected into the Grapes canvas iframe — no !important on fonts so Style Manager wins. */
export const CANVAS_THERMAL_CSS = `
${DEFAULT_BILL_CSS}

body {
  margin: 0;
  background: #e8eef3;
  display: flex;
  justify-content: center;
  padding: 16px 8px 40px;
  min-height: 100%;
  box-sizing: border-box;
}

.bill-slip {
  position: relative !important;
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  background: #fff;
  color: #111;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  box-sizing: border-box;
  padding: 6px 6px 14px;
  min-height: 0;
}

.gjs-selected {
  outline: 2px solid #0f766e !important;
  outline-offset: 1px;
}

.gjs-hovered {
  outline: 1px dashed #0f766e !important;
}
`.trim();

const TEXT_STYLABLE = [
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "color",
  "line-height",
  "text-align",
  "text-decoration",
  "text-transform",
  "background-color",
  "padding",
  "margin",
  "width",
  "opacity",
];

const SECTION_STYLABLE = [
  ...TEXT_STYLABLE,
  "width",
  "height",
  "min-height",
  "max-width",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "z-index",
  "border",
  "border-radius",
  "box-shadow",
  "display",
];

function anyFreeMove(editor: Editor) {
  try {
    return (editor.getWrapper()?.find?.('[data-free-move="1"]') || []).length > 0;
  } catch {
    return false;
  }
}

export function registerBillComponents(editor: Editor) {
  const domc = editor.DomComponents;

  // Ensure default text type is fully stylable / editable
  try {
    const textType = domc.getType("text");
    if (textType?.model) {
      const prev = textType.model.prototype.defaults || {};
      textType.model.prototype.defaults = {
        ...prev,
        editable: true,
        stylable: TEXT_STYLABLE,
        highlightable: true,
        selectable: true,
        hoverable: true,
      };
    }
  } catch {
    /* */
  }

  // Professional thermal tables stay selectable / layerable in the builder
  for (const type of ["table", "thead", "tbody", "tr", "th", "td"]) {
    try {
      const t = domc.getType(type);
      if (!t?.model) continue;
      const prev = t.model.prototype.defaults || {};
      t.model.prototype.defaults = {
        ...prev,
        selectable: true,
        hoverable: true,
        highlightable: true,
        layerable: true,
        stylable: SECTION_STYLABLE,
      };
    } catch {
      /* */
    }
  }

  domc.addType("bill-section", {
    isComponent: (el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (!el.getAttribute("data-bill-block")) return false;
      return { type: "bill-section" };
    },
    model: {
      defaults: {
        tagName: "div",
        name: "Bill section",
        editable: false,
        stylable: SECTION_STYLABLE,
        draggable: ".bill-slip, [data-gjs-type=wrapper]",
        droppable: true,
        layerable: true,
        highlightable: true,
        selectable: true,
        hoverable: true,
        removable: true,
        copyable: true,
        resizable: {
          tl: 1,
          tc: 1,
          tr: 1,
          cl: 1,
          cr: 1,
          bl: 1,
          bc: 1,
          br: 1,
        },
        traits: [
          {
            type: "checkbox",
            label: "Free move (overlay)",
            name: "freeMove",
            changeProp: true,
          },
          {
            type: "number",
            label: "Z-index (stamp = 90+)",
            name: "layerZ",
            changeProp: true,
            min: 0,
            max: 999,
            placeholder: "90",
          },
        ],
      },
      init() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = this as any;
        model.on("change:freeMove", () => applyFreeMove(editor, model));
        model.on("change:layerZ", () => applyZ(model));
        const attrs = model.getAttributes?.() || {};
        const isStamp =
          attrs["data-bill-block"] === "stamp" ||
          attrs["data-bill-block"] === "stamp-unpaid" ||
          attrs["data-stamp"] === "paid" ||
          attrs["data-stamp"] === "unpaid";
        if (attrs["data-free-move"] === "1" || isStamp) {
          const z =
            attrs["data-bill-block"] === "stamp-unpaid" || attrs["data-stamp"] === "unpaid"
              ? 91
              : isStamp
                ? 90
                : 80;
          model.set("layerZ", model.get("layerZ") || z);
          model.set("freeMove", true);
          // defer so styles apply after parse
          setTimeout(() => applyFreeMove(editor, model), 0);
        }
      },
    },
  });

  domc.addType("bill-slip", {
    isComponent: (el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (!el.classList?.contains("bill-slip")) return false;
      return { type: "bill-slip" };
    },
    model: {
      defaults: {
        tagName: "div",
        name: "Bill slip",
        droppable: true,
        draggable: false,
        layerable: true,
        stylable: [
          "background-color",
          "padding",
          "font-size",
          "font-family",
          "font-weight",
          "color",
          "line-height",
          "min-height",
          "width",
          "max-width",
        ],
      },
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFreeMove(editor: Editor, model: any) {
  const on = !!model.get("freeMove");
  const attrs = { ...model.getAttributes(), "data-free-move": on ? "1" : "0" };
  model.setAttributes(attrs);
  const isStamp =
    attrs["data-bill-block"] === "stamp" ||
    attrs["data-bill-block"] === "stamp-unpaid" ||
    attrs["data-stamp"];
  const defaultZ = isStamp
    ? attrs["data-stamp"] === "unpaid" || attrs["data-bill-block"] === "stamp-unpaid"
      ? 91
      : 90
    : 80;
  if (on) {
    const style = model.getStyle() || {};
    model.addStyle({
      position: "absolute",
      top: style.top && style.top !== "auto" ? style.top : isStamp ? "42%" : "35%",
      left: style.left && style.left !== "auto" ? style.left : "10%",
      width: style.width && style.width !== "100%" ? style.width : "80%",
      zIndex: String(model.get("layerZ") || defaultZ),
    });
    editor.setDragMode("absolute");
  } else {
    model.addStyle({
      position: "relative",
      top: "auto",
      left: "auto",
      width: "100%",
      zIndex: "auto",
    });
    if (!anyFreeMove(editor)) editor.setDragMode("");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyZ(model: any) {
  const z = model.get("layerZ");
  if (z != null && z !== "") model.addStyle({ zIndex: String(z) });
}

export function fullStyleManagerSectors() {
  return [
    {
      name: "Typography",
      open: true,
      properties: [
        {
          property: "font-family",
          type: "select",
          default: "Courier New, Courier, monospace",
          options: [
            { id: "Courier New, Courier, monospace", label: "Courier (thermal)" },
            { id: "monospace", label: "Monospace" },
            { id: "Arial, Helvetica, sans-serif", label: "Arial" },
            { id: "Georgia, serif", label: "Georgia" },
            { id: "Times New Roman, Times, serif", label: "Times" },
          ],
        },
        {
          property: "font-size",
          type: "select",
          default: "11px",
          options: [
            { id: "8px", label: "8 px" },
            { id: "9px", label: "9 px" },
            { id: "10px", label: "10 px" },
            { id: "11px", label: "11 px" },
            { id: "12px", label: "12 px" },
            { id: "13px", label: "13 px" },
            { id: "14px", label: "14 px" },
            { id: "16px", label: "16 px" },
            { id: "18px", label: "18 px" },
            { id: "20px", label: "20 px" },
            { id: "24px", label: "24 px" },
            { id: "28px", label: "28 px" },
            { id: "32px", label: "32 px" },
          ],
        },
        {
          property: "font-weight",
          type: "select",
          default: "400",
          options: [
            { id: "400", label: "Normal" },
            { id: "600", label: "Semi-bold" },
            { id: "700", label: "Bold" },
            { id: "800", label: "Extra bold" },
          ],
        },
        { property: "color", type: "color", default: "#111111" },
        {
          property: "line-height",
          type: "select",
          default: "1.25",
          options: [
            { id: "1", label: "1.0" },
            { id: "1.15", label: "1.15" },
            { id: "1.25", label: "1.25" },
            { id: "1.4", label: "1.4" },
            { id: "1.6", label: "1.6" },
          ],
        },
        {
          property: "text-align",
          type: "radio",
          default: "left",
          options: [
            { id: "left", label: "Left" },
            { id: "center", label: "Center" },
            { id: "right", label: "Right" },
          ],
        },
        { property: "letter-spacing", type: "integer", units: ["px", "em"], defaults: "0", min: -2, max: 8 },
        {
          property: "text-decoration",
          type: "select",
          default: "none",
          options: [
            { id: "none", label: "None" },
            { id: "underline", label: "Underline" },
            { id: "line-through", label: "Strike" },
          ],
        },
      ],
    },
    {
      name: "Size & space",
      open: true,
      properties: [
        { property: "width", type: "integer", units: ["%", "px", "mm"], defaults: "auto" },
        { property: "height", type: "integer", units: ["px", "%", "auto"], defaults: "auto" },
        { property: "max-width", type: "integer", units: ["%", "px", "mm"], defaults: "100%" },
        { property: "min-height", type: "integer", units: ["px", "%"], defaults: "0", min: 0 },
        { property: "padding", type: "composite", properties: [
          { property: "padding-top", type: "integer", units: ["px"], defaults: "0" },
          { property: "padding-right", type: "integer", units: ["px"], defaults: "0" },
          { property: "padding-bottom", type: "integer", units: ["px"], defaults: "0" },
          { property: "padding-left", type: "integer", units: ["px"], defaults: "0" },
        ]},
        { property: "margin", type: "composite", properties: [
          { property: "margin-top", type: "integer", units: ["px"], defaults: "0" },
          { property: "margin-right", type: "integer", units: ["px"], defaults: "0" },
          { property: "margin-bottom", type: "integer", units: ["px"], defaults: "0" },
          { property: "margin-left", type: "integer", units: ["px"], defaults: "0" },
        ]},
      ],
    },
    {
      name: "Overlay / stamp (z-index)",
      open: true,
      properties: [
        {
          property: "position",
          type: "select",
          default: "relative",
          options: [
            { id: "relative", label: "Normal" },
            { id: "absolute", label: "Overlay" },
            { id: "static", label: "Static" },
          ],
        },
        { property: "top", type: "integer", units: ["%", "px"], defaults: "auto" },
        { property: "left", type: "integer", units: ["%", "px"], defaults: "auto" },
        { property: "right", type: "integer", units: ["%", "px"], defaults: "auto" },
        { property: "bottom", type: "integer", units: ["%", "px"], defaults: "auto" },
        {
          property: "z-index",
          type: "integer",
          defaults: "1",
          min: 0,
          max: 999,
        },
        { property: "opacity", type: "slider", defaults: "1", min: 0, max: 1, step: 0.05 },
      ],
    },
    {
      name: "Decorations",
      open: false,
      buildProps: ["background-color", "border", "border-radius", "box-shadow"],
    },
  ];
}
