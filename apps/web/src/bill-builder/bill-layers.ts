import type { Editor } from "grapesjs";

export type BillLayerRow = {
  id: string;
  name: string;
  block?: string;
  visible: boolean;
  locked: boolean;
  index: number;
  total: number;
};

type AnyComp = {
  cid?: string;
  getId?: () => string;
  get?: (k: string) => unknown;
  getName?: () => string;
  getAttributes?: () => Record<string, string>;
  getStyle?: () => Record<string, string>;
  addStyle?: (s: Record<string, string>) => void;
  set?: (k: string, v: unknown) => void;
  components?: () => { length: number; at: (i: number) => AnyComp; forEach: (fn: (c: AnyComp, i: number) => void) => void };
  parent?: () => AnyComp | undefined;
  move?: (parent: AnyComp, opts: { at: number }) => void;
  remove?: () => void;
  select?: () => void;
};

function getSlip(editor: Editor): AnyComp | null {
  const wrap = editor.getWrapper() as unknown as AnyComp;
  const found = (wrap as { find?: (s: string) => AnyComp[] })?.find?.(".bill-slip")?.[0];
  return found || wrap || null;
}

function compId(c: AnyComp) {
  return c.getId?.() || c.cid || String(c.get?.("name") || Math.random());
}

function isVisible(c: AnyComp) {
  const style = c.getStyle?.() || {};
  const d = String(style.display || "").toLowerCase();
  if (d === "none") return false;
  // grapes layer visibility
  if (c.get?.("layerable") === false) return true;
  try {
    return (c as { isVisible?: () => boolean }).isVisible?.() !== false;
  } catch {
    return true;
  }
}

export function listBillLayers(editor: Editor): BillLayerRow[] {
  const slip = getSlip(editor);
  if (!slip) return [];
  const kids = slip.components?.();
  if (!kids?.length) return [];
  const rows: BillLayerRow[] = [];
  const total = kids.length;
  kids.forEach((c, index) => {
    const attrs = c.getAttributes?.() || {};
    const name =
      (typeof c.getName === "function" ? c.getName() : "") ||
      String(c.get?.("name") || attrs["data-gjs-name"] || attrs["data-bill-block"] || `Layer ${index + 1}`);
    rows.push({
      id: compId(c),
      name,
      block: attrs["data-bill-block"],
      visible: isVisible(c),
      locked: !!c.get?.("locked"),
      index,
      total,
    });
  });
  return rows;
}

function findById(editor: Editor, id: string): AnyComp | null {
  const slip = getSlip(editor);
  const kids = slip?.components?.();
  if (!kids) return null;
  let found: AnyComp | null = null;
  kids.forEach((c) => {
    if (compId(c) === id) found = c;
  });
  return found;
}

export function selectBillLayer(editor: Editor, id: string) {
  const c = findById(editor, id);
  if (!c) return;
  editor.select(c as never);
}

export function moveBillLayer(editor: Editor, id: string, dir: -1 | 1) {
  const slip = getSlip(editor);
  if (!slip) return;
  // Prefer Grapes collection API for reliable sibling reorder
  const coll = slip.components?.() as unknown as {
    length: number;
    models?: AnyComp[];
    at: (i: number) => AnyComp;
    remove: (c: AnyComp, opts?: { temporary?: boolean }) => AnyComp;
    add: (c: AnyComp, opts?: { at?: number }) => void;
    forEach: (fn: (c: AnyComp, i: number) => void) => void;
  };
  if (!coll?.length) return;
  let from = -1;
  coll.forEach((c, i) => {
    if (compId(c) === id) from = i;
  });
  if (from < 0) return;
  const to = from + dir;
  if (to < 0 || to >= coll.length) return;
  const comp = coll.at(from);
  if (!comp) return;
  try {
    coll.remove(comp, { temporary: true });
    coll.add(comp, { at: to });
  } catch {
    comp.move?.(slip, { at: to });
  }
}

export function setBillLayerVisible(editor: Editor, id: string, visible: boolean) {
  const c = findById(editor, id);
  if (!c) return;
  if (visible) {
    c.addStyle?.({ display: "block" });
    c.set?.("hidden", false);
  } else {
    c.addStyle?.({ display: "none" });
    c.set?.("hidden", true);
  }
  try {
    editor.Layers?.setVisible?.(c as never, visible);
  } catch {
    /* older API */
  }
}

export function setBillLayerLocked(editor: Editor, id: string, locked: boolean) {
  const c = findById(editor, id);
  if (!c) return;
  c.set?.("locked", locked);
  c.set?.("draggable", locked ? false : ".bill-slip, [data-gjs-type=wrapper]");
  c.set?.("selectable", !locked);
  c.set?.("hoverable", !locked);
  c.set?.("editable", !locked);
  c.set?.("removable", !locked);
  try {
    editor.Layers?.setLocked?.(c as never, locked);
  } catch {
    /* */
  }
}

export function removeBillLayer(editor: Editor, id: string) {
  const c = findById(editor, id);
  c?.remove?.();
}

export function renameBillLayer(editor: Editor, id: string, name: string) {
  const c = findById(editor, id);
  if (!c || !name.trim()) return;
  c.set?.("name", name.trim());
}

export function openAllLayers(editor: Editor) {
  const walk = (c: AnyComp) => {
    try {
      editor.Layers?.setOpen?.(c as never, true);
    } catch {
      /* */
    }
    c.components?.().forEach((child) => walk(child));
  };
  const root = editor.getWrapper() as unknown as AnyComp;
  if (root) walk(root);
}
