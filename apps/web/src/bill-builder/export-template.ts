import type { Editor } from "grapesjs";

type AnyComp = {
  getAttributes?: () => Record<string, string>;
  get?: (k: string) => unknown;
  getClasses?: () => string[];
  getStyle?: () => Record<string, string>;
  getName?: () => string;
  components?: () => { length: number; forEach: (fn: (c: AnyComp) => void) => void };
  find?: (sel: string) => AnyComp[];
};

/** Blocks that always expand from live order data — keep as {{token}} in print template. */
const DYNAMIC_BLOCKS = new Set([
  "logo",
  "meta",
  "staff",
  "items",
  "totals",
  "stamp",
  "vendor",
  "rule",
  "rule_eq",
]);

/**
 * Soft / brand blocks: if the canvas still looks like a placeholder token-only block,
 * keep {{token}}. If the user typed custom lines, export those lines so print matches design.
 */
const SOFT_BLOCKS = new Set(["name", "phone", "address", "tagline", "title", "footer"]);

function isHidden(comp: AnyComp) {
  const style = comp.getStyle?.() || {};
  if (String(style.display || "").toLowerCase() === "none") return true;
  if (comp.get?.("hidden") === true) return true;
  return false;
}

function isCentered(comp: AnyComp) {
  const classes = comp.getClasses?.() || [];
  return classes.includes("bill-block--center") || comp.getStyle?.()?.["text-align"] === "center";
}

function pushTextLines(lines: string[], raw: string, center: boolean) {
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const t = line.trimEnd();
    if (!t.trim()) continue;
    lines.push(center ? `>>${t}` : t);
  }
}

function collectText(comp: AnyComp, lines: string[], center: boolean) {
  if (isHidden(comp)) return;
  const type = String(comp.get?.("type") || "");
  const tag = String(comp.get?.("tagName") || "").toLowerCase();
  const attrs = comp.getAttributes?.() || {};

  if (attrs["data-bill-field"]) {
    lines.push(`{{${String(attrs["data-bill-field"])}}}`);
    return;
  }

  if (type === "textnode") {
    pushTextLines(lines, String(comp.get?.("content") ?? ""), center);
    return;
  }

  const children = comp.components?.();
  const childCount = children?.length ?? 0;
  const isTextish =
    type === "text" || type === "textnode" || tag === "span" || tag === "p" || tag === "div";

  if (isTextish && childCount === 0) {
    pushTextLines(lines, String(comp.get?.("content") || ""), center || isCentered(comp));
    return;
  }

  if (childCount && children) {
    const nextCenter = center || isCentered(comp);
    children.forEach((c) => collectText(c, lines, nextCenter));
  }
}

function looksLikeTokenOnly(lines: string[], block: string) {
  if (!lines.length) return true;
  const joined = lines.map((l) => l.replace(/^>>/, "").trim()).join("\n");
  // Placeholder / key-only content → keep dynamic block token
  if (/^\{\{[a-z0-9_.]+\}\}$/i.test(joined)) return true;
  if (block === "name" && /restaurant\.name/i.test(joined)) return true;
  if (block === "phone" && /restaurant\.phone/i.test(joined)) return true;
  if (block === "address" && /restaurant\.address/i.test(joined)) return true;
  if (block === "tagline" && /restaurant\.tagline/i.test(joined)) return true;
  if (block === "title" && /bill_title|^=+$/m.test(joined) && lines.length <= 3) {
    // default title block with rules + {{bill_title}} still counts as soft token
    if (lines.some((l) => /\{\{\s*bill_title\s*\}\}/i.test(l))) return true;
  }
  if (block === "footer" && /footer_text/i.test(joined)) return true;
  return false;
}

/**
 * Walk GrapesJS components top→bottom and build the ESC/POS mail-merge template.
 * Dynamic sections stay as {{logo}} / {{items}}…; custom / edited text is exported as lines.
 */
export function exportBillTemplate(editor: Editor): string {
  const lines: string[] = [];
  const wrapper = editor.getWrapper() as unknown as AnyComp | undefined;
  if (!wrapper) return "";

  const visit = (comp: AnyComp | undefined) => {
    if (!comp || isHidden(comp)) return;
    const attrs = comp.getAttributes?.() || {};
    const block = attrs["data-bill-block"];

    if (block) {
      const token = String(block).toLowerCase();
      if (token === "stamp-unpaid") {
        // Unpaid is a design overlay twin of PAID — print expands one {{stamp}} from paid block
        return;
      }
      if (DYNAMIC_BLOCKS.has(token)) {
        // Only one {{stamp}} line even if multiple stamp layers exist
        if (token === "stamp" && lines.some((l) => l.trim() === "{{stamp}}")) return;
        lines.push(`{{${token}}}`);
        return;
      }
      if (SOFT_BLOCKS.has(token)) {
        const soft: string[] = [];
        collectText(comp, soft, isCentered(comp));
        if (looksLikeTokenOnly(soft, token)) {
          lines.push(`{{${token}}}`);
        } else {
          lines.push(...soft);
        }
        return;
      }
      // Unknown bill-block → export inner text
      collectText(comp, lines, isCentered(comp));
      return;
    }

    if (attrs["data-bill-field"]) {
      lines.push(`{{${String(attrs["data-bill-field"])}}}`);
      return;
    }

    const type = String(comp.get?.("type") || "");
    const tag = String(comp.get?.("tagName") || "").toLowerCase();
    const isTextish =
      type === "text" || type === "textnode" || tag === "span" || tag === "p" || tag === "div";

    if (type === "textnode") {
      pushTextLines(lines, String(comp.get?.("content") ?? ""), false);
      return;
    }

    const children = comp.components?.();
    const childCount = children?.length ?? 0;

    if (isTextish && childCount === 0) {
      pushTextLines(lines, String(comp.get?.("content") || ""), isCentered(comp));
      return;
    }

    if (childCount && children) {
      children.forEach((c) => visit(c));
    }
  };

  const slip = wrapper.find?.(".bill-slip")?.[0] || wrapper;
  const kids = slip.components?.();
  if (kids?.length) kids.forEach((c) => visit(c));
  else visit(wrapper);

  return `${lines.join("\n")}\n`;
}

export function exportGrapesProject(editor: Editor): string {
  return JSON.stringify(editor.getProjectData());
}

export function exportDesignSnapshot(editor: Editor): { html: string; css: string } {
  return {
    html: editor.getHtml() || "",
    css: editor.getCss() || "",
  };
}
