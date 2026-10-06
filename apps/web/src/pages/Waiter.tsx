import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, formatKg, money, unitLabel } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../toast";
import { useSocketEvent } from "../socket";
import { serverPrint, useKotPreviewPref } from "../printing";
import { SearchField, matchesSearch } from "../components/SearchField";
import { KotPreviewModal, type KotTarget } from "../components/KotPreviewModal";
import { PayModal } from "../components/PayModal";
import { PickServerModal } from "../components/PickServerModal";
import { PickCashierModal } from "../components/PickCashierModal";
import { EditBillForm, serverNames, withCurrent, type EditBillMeta, type EditBillPerson } from "../components/EditBillForm";
import { useConfirm, usePrompt } from "../components/ConfirmModal";
import { useHotelGate } from "../hotel-gate";
import { Modal } from "../components/Modal";
import { MessageKey, useI18n, useT } from "../i18n";
import {
  allowCustomOf,
  bumpQty,
  clampQty,
  listPriceLabel,
  maxQtyOf,
  minQtyOf,
  qtyIssueOf,
  qtyStepOf,
  quickQtys,
  startQtyOf,
  type QtyRules,
} from "../menuQty";

type OrderSummary = {
  id: string;
  orderNo: number;
  status: string;
  paymentStatus: string;
  total: number;
  billRequested: boolean;
  waiterId: string | null;
  waiter: string | null;
  assignedCashierId: string | null;
  assignedCashier: { id: string; name: string; roleCode: string } | null;
  since: string;
  label?: string;
};

type TableCard = {
  id: string;
  name: string;
  label: string;
  area: string | null;
  partitionId: string;
  partitionName: string;
  seats: number;
  order: OrderSummary | null;
};

type TakeawayCard = OrderSummary & { label: string };

type PartitionBoard = {
  id: string;
  name: string;
  sortOrder: number;
  tables: TableCard[];
};

type TablesBoard = {
  partitions: PartitionBoard[];
  tables: TableCard[];
  takeaway?: TakeawayCard[];
};

const twKey = (orderId: string) => `tw:${orderId}`;
const isTwKey = (sel: string | null) => !!sel && sel.startsWith("tw:");
const twId = (sel: string) => sel.slice(3);

type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  kind?: "NORMAL" | "SPECIAL" | "MIX";
  sellUnit: string;
  sellingPrice: number;
  listPortionQty?: number;
  listAmount?: number;
  specialProductId?: string | null;
  mixSpecialPlates?: number | null;
  specialProduct?: {
    id: string;
    name: string;
    platePrice: number;
    plateGrams: number;
    servingLabel?: string;
    sellMode?: "BOTH" | "SERVING_ONLY" | "RS_ONLY";
  } | null;
  minQty?: number;
  maxQty?: number | null;
  qtyStep?: number | null;
  allowCustomQty?: boolean;
};

type TodaySpecial = {
  id: string;
  name: string;
  platePrice: number;
  plateGrams: number;
  servingLabel?: string;
  sellMode?: "BOTH" | "SERVING_ONLY" | "RS_ONLY";
  remainingGrams: number;
  remainingPlates: number;
  maxRs: number;
  status: string | null;
};

type OrderItem = {
  id: string;
  lineKind?: "MENU" | "PER_HEAD";
  name: string;
  sellUnit: string;
  quantity: number;
  amount: number;
  notes: string | null;
  kotRound: number;
  addedBy: string | null;
};

type Order = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  tableId?: string | null;
  status: string;
  paymentStatus: string;
  total: number;
  paidAmount: number;
  tipAmount?: number;
  kotRounds: number;
  billRequestedAt: string | null;
  waiter: string | null;
  waiterId?: string | null;
  servedByName?: string | null;
  servedBy?: string | null;
  orderedBy?: { id: string; name: string; roleCode: string; roleName: string } | null;
  assignedCashier?: { id: string; name: string; roleCode: string; roleName: string } | null;
  creditCustomer?: { id: string; name: string; phone: string } | null;
  items: OrderItem[];
};

type CartLine = {
  cartKey: string;
  kind: "MENU" | "PER_HEAD";
  menuItemId?: string;
  name: string;
  sellUnit: string;
  rate: number;
  quantity: number;
  notes: string;
  saleMode?: "PLATE" | "RS" | "MIX";
  amountRs?: number;
  /** SPECIAL RS: grams taken from pot (display; API still uses quantity as plates). */
  specialGrams?: number;
  soloStoreFallback?: boolean;
  minQty?: number;
  maxQty?: number | null;
  qtyStep?: number | null;
  allowCustomQty?: boolean;
  listPortionQty?: number;
  /** Included with per-head (Rs 0); sent as packageLines on the PER_HEAD line. */
  fromPerHead?: boolean;
  /** Fixed package line — cart shows name only, no qty/remove. */
  perHeadLocked?: boolean;
};

type PerHeadPkgItem = {
  menuItemId: string;
  name: string;
  sellUnit: string;
  qty: number;
  variable: boolean;
  minQty?: number;
  maxQty?: number | null;
  qtyStep?: number | null;
  allowCustomQty?: boolean;
  listPortionQty?: number;
};

type PerHeadCfg = {
  enabled: boolean;
  amount: number;
  label: string;
  items: PerHeadPkgItem[];
};

const WALK_IN = "__walkin__";
const PER_HEAD_KEY = "__per_head__";
const phPkgKey = (menuItemId: string) => `__ph__${menuItemId}`;

function rulesOf(m: QtyRules): QtyRules {
  return {
    sellUnit: m.sellUnit,
    minQty: m.minQty,
    maxQty: m.maxQty,
    qtyStep: m.qtyStep,
    allowCustomQty: m.allowCustomQty,
    listPortionQty: m.listPortionQty,
  };
}

function minutesSince(
  iso: string,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return t("dash.minN", { n: m });
  return t("dash.hm", { h: Math.floor(m / 60), m: m % 60 });
}

function roundTakers(items: OrderItem[]) {
  return [...new Set(items.map((i) => i.addedBy).filter(Boolean))].join(", ");
}

function orderCardState(o: OrderSummary | null | undefined) {
  if (!o) return "free";
  if (o.billRequested) return "bill";
  if (o.status === "READY") return "ready";
  return "busy";
}

function tableState(t: TableCard) {
  return orderCardState(t.order);
}

export function WaiterPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const t = useT();
  const { ts } = useI18n();
  const askPrompt = usePrompt();
  const ask = useConfirm();
  const { gate } = useHotelGate();
  const hotelClosed = !!gate && !gate.acceptingOrders;
  const [previewFirst, setPreviewFirst] = useKotPreviewPref(user);
  const [kot, setKot] = useState<KotTarget | null>(null);
  const closeKot = useCallback(() => setKot(null), []);
  const [partitions, setPartitions] = useState<PartitionBoard[]>([]);
  const [tables, setTables] = useState<TableCard[]>([]);
  /** Empty = all walls/partitions (Lawn, Hall…). */
  const [partitionFilter, setPartitionFilter] = useState("");
  const [takeaways, setTakeaways] = useState<TakeawayCard[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [specialsToday, setSpecialsToday] = useState<TodaySpecial[]>([]);
  const [specialPick, setSpecialPick] = useState<MenuItem | null>(null);
  const [specialMode, setSpecialMode] = useState<"PLATE" | "RS">("PLATE");
  const [specialRs, setSpecialRs] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [walkInName, setWalkInName] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [paying, setPaying] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [cat, setCat] = useState("ALL");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [pickServer, setPickServer] = useState(false);
  const [pickCashier, setPickCashier] = useState(false);
  const [pendingServer, setPendingServer] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editQty, setEditQty] = useState<Record<string, number>>({});
  const [editMeta, setEditMeta] = useState<EditBillMeta | null>(null);
  const [editStaff, setEditStaff] = useState<EditBillPerson[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [perHead, setPerHead] = useState<PerHeadCfg | null>(null);
  const [perHeadWizard, setPerHeadWizard] = useState<
    | { step: "persons"; persons: string }
    | { step: "itemQty"; persons: number; item: PerHeadPkgItem; qty: string }
    | null
  >(null);
  const [creditOn, setCreditOn] = useState(false);
  const [creditPick, setCreditPick] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [creditQ, setCreditQ] = useState("");
  const [creditHits, setCreditHits] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [creditLookup, setCreditLookup] = useState<"idle" | "loading" | "done">("idle");

  useEffect(() => {
    setCreditOn(false);
    setCreditPick(null);
    setCreditQ("");
    setCreditHits([]);
  }, [selected]);

  const selectedTable = tables.find((tbl) => tbl.id === selected) ?? null;
  const selectedTakeaway = isTwKey(selected)
    ? takeaways.find((tw) => tw.id === twId(selected!)) ?? null
    : null;
  const selectedLabel =
    selected === WALK_IN
      ? t("waiter.takeaway")
      : selectedTakeaway
        ? selectedTakeaway.label || t("waiter.takeaway")
        : selectedTable?.label || selectedTable?.name || "";

  const needsCashierPick = !order && !can("cash.keep");
  const isCashierRole = ["CASHIER", "MAIN_CASHIER"].includes(user?.roleCode ?? "");
  const isTakeawayView = selected === WALK_IN || isTwKey(selected);
  /** Kitchen KOT reprint is for floor/kitchen — not cashier counters. */
  const canReprintKot = can("print.kot") && !isCashierRole;
  /** Counter takeaway: customer is at cashier — skip request/print unpaid bill; Take payment prints PAID. */
  const showTakeawayCashierBillActions = !(isTakeawayView && isCashierRole);
  const canAddPerHead =
    ["SUPERVISOR", "ADMIN", "MANAGER"].includes(user?.roleCode ?? "") || can("users.manage");
  const showPerHeadBtn = canAddPerHead && !!perHead?.enabled && (perHead?.amount ?? 0) > 0;
  const cartHasMenu = cart.some((c) => c.kind === "MENU");

  const loadTables = useCallback(async () => {
    try {
      const board = await api<TablesBoard>("/tables");
      setPartitions(board.partitions ?? []);
      setTables(board.tables ?? []);
      setTakeaways(board.takeaway ?? []);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("waiter.loadFailed"), "err");
    }
  }, [toast, t]);

  const loadOrder = useCallback(async (orderId: string | null | undefined) => {
    if (!orderId) {
      setOrder(null);
      return;
    }
    try {
      setOrder(await api<Order>(`/orders/${orderId}`));
    } catch {
      setOrder(null);
    }
  }, []);

  useEffect(() => {
    void loadTables();
    api<MenuItem[]>("/menu")
      .then(setMenu)
      .catch((e) => toast.push(e instanceof Error ? e.message : t("waiter.loadFailed"), "err"));
    api<{ products: TodaySpecial[] }>("/specials/today")
      .then((d) => setSpecialsToday(d.products || []))
      .catch(() => setSpecialsToday([]));
    const timer = setInterval(() => {
      void loadTables();
      api<{ products: TodaySpecial[] }>("/specials/today")
        .then((d) => setSpecialsToday(d.products || []))
        .catch(() => undefined);
    }, 30000);
    return () => clearInterval(timer);
  }, [loadTables, toast, t]);

  const specialById = useMemo(() => new Map(specialsToday.map((s) => [s.id, s])), [specialsToday]);

  useEffect(() => {
    if (!canAddPerHead) {
      setPerHead(null);
      return;
    }
    let cancelled = false;
    const apply = (cfg: PerHeadCfg | null | undefined) => {
      if (!cancelled && cfg) {
        setPerHead({ ...cfg, items: Array.isArray(cfg.items) ? cfg.items : [] });
      }
    };
    api<PerHeadCfg>("/orders/per-head")
      .then(apply)
      .catch(() =>
        api<{ billing?: { perHead?: PerHeadCfg } }>("/system/settings")
          .then((s) => apply(s.billing?.perHead))
          .catch(() => {
            if (!cancelled) setPerHead(null);
          })
      );
    return () => {
      cancelled = true;
    };
  }, [canAddPerHead, user?.id]);

  useEffect(() => {
    if (isTwKey(selected)) {
      void loadOrder(twId(selected!));
      return;
    }
    void loadOrder(selectedTable?.order?.id);
  }, [selected, selectedTable?.order?.id, loadOrder]);

  useSocketEvent("orders.changed", () => {
    void loadTables();
    if (order) void loadOrder(order.id);
  });

  const categories = useMemo(() => {
    const cats = Array.from(new Set(menu.map((m) => m.category || "General")));
    const hasSpecial = menu.some((m) => m.kind === "SPECIAL" || m.kind === "MIX");
    return hasSpecial ? ["ALL", "SPECIAL", ...cats] : ["ALL", ...cats];
  }, [menu]);

  const shownMenu = menu.filter((m) => {
    if (cat === "SPECIAL") {
      return (m.kind === "SPECIAL" || m.kind === "MIX") && matchesSearch(q, m.name, m.category);
    }
    return (cat === "ALL" || (m.category || "General") === cat) && matchesSearch(q, m.name, m.category);
  });

  const cartTotal = cart.reduce((s, l) => {
    if (l.saleMode === "RS" && l.amountRs != null) return s + l.amountRs;
    return s + l.rate * l.quantity;
  }, 0);

  function canOpenOrder(o: OrderSummary | null | undefined) {
    if (!o) return true;
    if (!o.waiterId || o.waiterId === user?.id) return true;
    if (o.assignedCashierId === user?.id) return true;
    if (can("order.edit") || can("users.manage") || can("order.pay")) return true;
    return false;
  }

  function openTable(tbl: TableCard) {
    if (!canOpenOrder(tbl.order)) {
      toast.push(
        tbl.order?.waiter
          ? t("waiter.tableBooked", { name: tbl.order.waiter })
          : t("waiter.tableBookedGeneric"),
        "err"
      );
      return;
    }
    setSelected(tbl.id);
    setCart([]);
    setQtyDraft({});
    setQ("");
    setNoteFor(null);
    setEditing(false);
  }

  function openTakeaway(tw: TakeawayCard) {
    if (!canOpenOrder(tw)) {
      toast.push(
        tw.waiter ? t("waiter.tableBooked", { name: tw.waiter }) : t("waiter.tableBookedGeneric"),
        "err"
      );
      return;
    }
    setSelected(twKey(tw.id));
    setCart([]);
    setQtyDraft({});
    setQ("");
    setNoteFor(null);
    setEditing(false);
    setWalkInName(tw.label === "Takeaway" ? "" : tw.label);
  }

  function openWalkIn() {
    setSelected(WALK_IN);
    setCart([]);
    setQtyDraft({});
    setQ("");
    setNoteFor(null);
    setOrder(null);
    setEditing(false);
    setWalkInName("");
  }

  function back() {
    setSelected(null);
    setOrder(null);
    setCart([]);
    setQtyDraft({});
    setWalkInName("");
    setEditing(false);
  }

  function addNormal(m: MenuItem, extras?: Partial<CartLine>) {
    const rules = rulesOf(m);
    const cartKey = extras?.cartKey || m.id;
    const hit = cart.find((p) => p.cartKey === cartKey);
    if (hit && !extras?.saleMode) {
      const base = Number(qtyDraft[cartKey] ?? hit.quantity);
      const from = Number.isFinite(base) && base > 0 ? base : hit.quantity;
      const next = bumpQty(rules, from, 1);
      if (next <= from) {
        toast.push(t("waiter.qtyMax"), "err");
        return;
      }
      setCart((prev) => prev.map((p) => (p.cartKey === cartKey ? { ...p, quantity: next } : p)));
      setQtyDraft((d) => ({ ...d, [cartKey]: String(next) }));
      return;
    }
    const start = extras?.quantity ?? startQtyOf(rules);
    setCart((prev) => [
      ...prev.filter((p) => p.cartKey !== cartKey),
      {
        cartKey,
        kind: "MENU" as const,
        menuItemId: m.id,
        name: extras?.name || m.name,
        sellUnit: m.sellUnit,
        rate: extras?.rate ?? m.sellingPrice,
        quantity: start,
        notes: "",
        saleMode: extras?.saleMode,
        amountRs: extras?.amountRs,
        specialGrams: extras?.specialGrams,
        soloStoreFallback: extras?.soloStoreFallback,
        minQty: rules.minQty ?? undefined,
        maxQty: rules.maxQty ?? null,
        qtyStep: rules.qtyStep ?? null,
        allowCustomQty: extras?.saleMode === "RS" ? false : rules.allowCustomQty !== false,
      },
    ]);
    setQtyDraft((d) => ({ ...d, [cartKey]: String(start) }));
  }

  async function add(m: MenuItem) {
    if (m.kind === "SPECIAL") {
      const batch = m.specialProductId ? specialById.get(m.specialProductId) : null;
      if (!batch || batch.remainingGrams <= 0) {
        toast.push(t("waiter.specialOut"), "err");
        return;
      }
      const sellMode = m.specialProduct?.sellMode || batch.sellMode || "BOTH";
      const platePrice = m.specialProduct?.platePrice || batch.platePrice || m.sellingPrice;
      if (sellMode === "SERVING_ONLY") {
        if (batch.remainingPlates < startQtyOf(rulesOf(m))) {
          toast.push(t("waiter.specialOut"), "err");
          return;
        }
        addNormal(m, {
          cartKey: m.id,
          saleMode: "PLATE",
          rate: platePrice,
        });
        return;
      }
      setSpecialPick(m);
      setSpecialMode(sellMode === "RS_ONLY" ? "RS" : "PLATE");
      setSpecialRs("");
      return;
    }
    if (m.kind === "MIX") {
      const batch = m.specialProductId ? specialById.get(m.specialProductId) : null;
      const platesPer = m.mixSpecialPlates || 1;
      const needGrams = (m.specialProduct?.plateGrams || batch?.plateGrams || 1) * platesPer * startQtyOf(rulesOf(m));
      if (!batch || batch.remainingGrams + 0.0005 < needGrams) {
        const ok = await ask({
          title: t("waiter.mixFallbackTitle"),
          body: t("waiter.mixFallbackBody", { name: m.name }),
        });
        if (!ok) return;
        addNormal(m, {
          cartKey: `${m.id}:solo`,
          saleMode: "MIX",
          soloStoreFallback: true,
          name: `${m.name} (${t("waiter.storeOnly")})`,
        });
        return;
      }
      addNormal(m, { saleMode: "MIX" });
      return;
    }
    addNormal(m);
  }

  function confirmSpecialAdd() {
    if (!specialPick) return;
    const m = specialPick;
    const batch = m.specialProductId ? specialById.get(m.specialProductId) : null;
    const sellMode = m.specialProduct?.sellMode || batch?.sellMode || "BOTH";
    if (specialMode === "RS" && sellMode === "SERVING_ONLY") return;
    if (specialMode === "PLATE" && sellMode === "RS_ONLY") return;
    const platePrice = m.specialProduct?.platePrice || batch?.platePrice || m.sellingPrice;
    if (specialMode === "RS") {
      const rs = Number(specialRs);
      if (!Number.isFinite(rs) || rs < 0.01) {
        toast.push(t("waiter.specialRsInvalid"), "err");
        return;
      }
      if (batch && rs > batch.maxRs + 0.01) {
        toast.push(t("waiter.specialRsMax", { n: money(batch.maxRs) }), "err");
        return;
      }
      if (!(platePrice > 0)) {
        toast.push(t("waiter.specialRsInvalid"), "err");
        return;
      }
      const plateGrams = m.specialProduct?.plateGrams || batch?.plateGrams || 1;
      const plates = rs / platePrice;
      const grams = Math.round(plates * plateGrams * 1000) / 1000;
      if (batch && grams > batch.remainingGrams + 0.05) {
        toast.push(t("waiter.specialRsMax", { n: money(batch.maxRs) }), "err");
        return;
      }
      addNormal(m, {
        cartKey: `${m.id}:rs`,
        saleMode: "RS",
        amountRs: rs,
        specialGrams: grams,
        quantity: Math.round(plates * 1000) / 1000,
        rate: platePrice,
        name: `${m.name} (Rs)`,
        allowCustomQty: false,
      });
    } else {
      if (batch && batch.remainingPlates < startQtyOf(rulesOf(m))) {
        toast.push(t("waiter.specialOut"), "err");
        return;
      }
      addNormal(m, {
        cartKey: m.id,
        saleMode: "PLATE",
        rate: platePrice,
      });
    }
    setSpecialPick(null);
  }

  function commitPerHead(opts?: { heads?: number; variableQty?: number; lockVariable?: boolean }) {
    if (!perHead?.enabled || perHead.amount <= 0) {
      toast.push(t("waiter.perHeadDisabled"), "err");
      return;
    }
    const orderAlreadyHasPerHead = !!order?.items.some((i) => i.lineKind === "PER_HEAD");
    const pkgItems = perHead.items ?? [];
    const heads = Math.max(1, Math.floor(Number(opts?.heads) || 1));
    setCart((prev) => {
      const hit = prev.find((p) => p.cartKey === PER_HEAD_KEY);
      if (hit) {
        return prev.map((p) =>
          p.cartKey === PER_HEAD_KEY
            ? { ...p, quantity: p.quantity + 1, rate: perHead.amount, name: perHead.label }
            : p
        );
      }
      const charge: CartLine = {
        cartKey: PER_HEAD_KEY,
        kind: "PER_HEAD",
        name: perHead.label,
        sellUnit: "PCS",
        rate: perHead.amount,
        quantity: heads,
        notes: "",
      };
      if (orderAlreadyHasPerHead || !pkgItems.length) {
        return [...prev, charge];
      }
      const pkgLines: CartLine[] = pkgItems
        .map((pkg) => {
          const quantity = pkg.variable
            ? Math.max(0.001, opts?.variableQty ?? pkg.qty)
            : Math.max(0.001, pkg.qty);
          if (!(quantity > 0)) return null;
          const lockVar = !!pkg.variable && !!opts?.lockVariable;
          return {
            cartKey: phPkgKey(pkg.menuItemId),
            kind: "MENU" as const,
            menuItemId: pkg.menuItemId,
            name: pkg.name,
            sellUnit: pkg.sellUnit,
            rate: 0,
            quantity,
            notes: "Per head",
            fromPerHead: true,
            perHeadLocked: !pkg.variable || lockVar,
            minQty: pkg.minQty,
            maxQty: pkg.maxQty,
            qtyStep: pkg.qtyStep,
            allowCustomQty: pkg.variable && !lockVar ? pkg.allowCustomQty : false,
            listPortionQty: pkg.listPortionQty,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
      return [...prev, charge, ...pkgLines];
    });
    setPerHeadWizard(null);
  }

  function addPerHead() {
    if (!perHead?.enabled || perHead.amount <= 0) {
      toast.push(t("waiter.perHeadDisabled"), "err");
      return;
    }
    if (cart.some((p) => p.cartKey === PER_HEAD_KEY)) {
      commitPerHead();
      return;
    }
    // First add: always ask how many persons.
    setPerHeadWizard({ step: "persons", persons: "1" });
  }

  function continuePerHeadPersons() {
    if (!perHead) return;
    const persons = Math.max(1, Math.floor(Number(perHeadWizard?.step === "persons" ? perHeadWizard.persons : 0) || 0));
    if (!Number.isFinite(persons) || persons < 1) {
      toast.push(t("waiter.qtyFixFirst"), "err");
      return;
    }
    const orderAlreadyHasPerHead = !!order?.items.some((i) => i.lineKind === "PER_HEAD");
    const pkgItems = perHead.items ?? [];
    if (orderAlreadyHasPerHead || !pkgItems.length) {
      commitPerHead({ heads: persons });
      return;
    }
    const variable = pkgItems.find((i) => i.variable);
    if (!variable) {
      commitPerHead({ heads: persons });
      return;
    }
    // 1 person → choose-item must come (default qty), no ask.
    if (persons === 1) {
      commitPerHead({
        heads: 1,
        variableQty: Math.max(0.001, variable.qty || 1),
        lockVariable: true,
      });
      return;
    }
    // 2+ persons → ask how many of the choose-item to give.
    setPerHeadWizard({
      step: "itemQty",
      persons,
      item: variable,
      qty: String(variable.qty || 1),
    });
  }

  function setQty(id: string, qty: number) {
    const line = cart.find((p) => p.cartKey === id);
    if (!line) return;
    if (line.fromPerHead && line.perHeadLocked) return;
    if (qty <= 0) {
      setCart((prev) => {
        let next = prev.filter((p) => p.cartKey !== id);
        if (id === PER_HEAD_KEY) {
          next = next.filter((p) => !p.fromPerHead);
        }
        return next;
      });
      setQtyDraft((d) => {
        const next = { ...d };
        delete next[id];
        if (id === PER_HEAD_KEY) {
          for (const k of Object.keys(next)) {
            if (k.startsWith("__ph__")) delete next[k];
          }
        }
        return next;
      });
      return;
    }
    const next =
      id === PER_HEAD_KEY
        ? Math.max(1, Math.floor(Number(qty) || 1))
        : clampQty(rulesOf(line), qty);
    if (next <= 0) {
      setCart((prev) => prev.filter((p) => p.cartKey !== id));
      setQtyDraft((d) => {
        const n = { ...d };
        delete n[id];
        return n;
      });
      return;
    }
    const chooseId = (perHead?.items ?? []).find((i) => i.variable)?.menuItemId;
    setCart((prev) =>
      prev.map((p) => {
        if (p.cartKey === id) return { ...p, quantity: next };
        // Per head → 1 person: choose-item auto becomes 1 and locks.
        if (id === PER_HEAD_KEY && next === 1 && chooseId && p.fromPerHead && p.menuItemId === chooseId) {
          return { ...p, quantity: 1, perHeadLocked: true, allowCustomQty: false };
        }
        // Per head → 2+: unlock choose-item again so qty can be edited.
        if (id === PER_HEAD_KEY && next > 1 && chooseId && p.fromPerHead && p.menuItemId === chooseId) {
          return { ...p, perHeadLocked: false, allowCustomQty: true };
        }
        return p;
      })
    );
    setQtyDraft((d) => {
      const draft: Record<string, string> = { ...d, [id]: String(next) };
      if (id === PER_HEAD_KEY && next === 1 && chooseId) {
        draft[phPkgKey(chooseId)] = "1";
      }
      return draft;
    });
  }

  /** Free typing — do not clamp; validation blocks send instead. */
  function setQtyTyped(id: string, text: string) {
    const line = cart.find((p) => p.cartKey === id);
    if (line?.fromPerHead && line.perHeadLocked) return;
    setQtyDraft((d) => ({ ...d, [id]: text }));
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    setCart((prev) =>
      prev.map((p) => (p.cartKey === id ? { ...p, quantity: +n.toFixed(3) } : p))
    );
  }

  function qtyTextOf(l: CartLine) {
    return qtyDraft[l.cartKey] ?? String(l.quantity);
  }

  function lineQtyIssue(l: CartLine) {
    if (l.kind === "PER_HEAD") return null;
    if (l.fromPerHead && l.perHeadLocked) return null;
    if (l.saleMode === "RS") return null;
    const text = qtyTextOf(l).trim();
    if (text === "" || text === "." || text === "-") return "invalid" as const;
    const n = Number(text);
    return qtyIssueOf(rulesOf(l), n);
  }

  const cartQtyBlocked = cart.some((l) => lineQtyIssue(l) != null);

  function setNote(id: string, notes: string) {
    setCart((prev) => prev.map((p) => (p.cartKey === id ? { ...p, notes } : p)));
  }

  useEffect(() => {
    if (!creditOn || creditPick) return;
    const term = creditQ.trim();
    if (term.length < 1) {
      setCreditHits([]);
      setCreditLookup("idle");
      return;
    }
    setCreditLookup("loading");
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void api<{ id: string; name: string; phone: string }[]>(`/credit-customers?q=${encodeURIComponent(term)}`)
        .then((rows) => {
          if (cancelled) return;
          setCreditHits(rows);
          setCreditLookup("done");
        })
        .catch((e) => {
          if (cancelled) return;
          setCreditHits([]);
          setCreditLookup("done");
          toast.push(e instanceof Error ? e.message : t("credit.loadFailed"), "err");
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [creditQ, creditOn, creditPick]);

  async function releaseCreditTable() {
    if (!order) return;
    setBusy(true);
    try {
      const updated = await api<Order>(`/orders/${order.id}/release-credit`, { method: "POST" });
      setOrder(null);
      setCart([]);
      setQtyDraft({});
      if (updated.creditCustomer) {
        setCreditOn(true);
        setCreditPick(updated.creditCustomer);
      }
      toast.push(t("waiter.released"), "ok");
      void loadTables();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("waiter.sendFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function sendToKitchen() {
    if (!cart.length) return;
    if (cart.some((l) => lineQtyIssue(l) != null)) {
      toast.push(t("waiter.qtyFixFirst"), "err");
      return;
    }
    if (can("order.pay") && !isTakeawayView && creditOn && !creditPick && !order?.creditCustomer) {
      toast.push(t("waiter.creditNeed"), "err");
      return;
    }
    setPickServer(true);
  }

  function afterServerPicked(serverName: string) {
    setPickServer(false);
    if (needsCashierPick) {
      setPendingServer(serverName);
      setPickCashier(true);
      return;
    }
    void sendOrder(serverName);
  }

  function afterCashierPicked(cashierId: string) {
    setPickCashier(false);
    const serverName = pendingServer || user?.name || "";
    setPendingServer(null);
    void sendOrder(serverName, cashierId);
  }

  async function sendOrder(serverName: string, assignedCashierId?: string) {
    setBusy(true);
    const packageLines = cart
      .filter((c) => c.fromPerHead && c.menuItemId)
      .map((c) => ({ menuItemId: c.menuItemId!, quantity: c.quantity }));
    const hasMenu = cart.some((c) => c.kind === "MENU");
    const items = cart
      .filter((c) => !c.fromPerHead)
      .map((c) =>
        c.kind === "PER_HEAD"
          ? {
              kind: "PER_HEAD" as const,
              quantity: c.quantity,
              notes: c.notes || undefined,
              ...(packageLines.length ? { packageLines } : {}),
            }
          : {
              menuItemId: c.menuItemId!,
              quantity: c.quantity,
              notes: c.notes || undefined,
              ...(c.saleMode ? { saleMode: c.saleMode } : {}),
              ...(c.amountRs != null ? { amountRs: c.amountRs } : {}),
              ...(c.soloStoreFallback ? { soloStoreFallback: true } : {}),
            }
      );
    const preview = hasMenu && previewFirst && canReprintKot;
    try {
      const isNewWalkIn = selected === WALK_IN;
      const isTakeaway = isNewWalkIn || isTwKey(selected);
      const tableNo = isTakeaway
        ? walkInName.trim() || order?.tableNo || "Takeaway"
        : selectedTable?.label || selectedTable?.name || "";
      const visitClosed = !!order?.creditCustomer && order.status === "COMPLETED";
      const openOrder = order && !visitClosed ? order : null;
      const creditId = !isTakeaway && creditPick && (!openOrder || !openOrder.creditCustomer) ? creditPick.id : undefined;
      const body = {
        items,
        printKot: hasMenu && !preview,
        servedByName: serverName,
        ...(creditId ? { creditCustomerId: creditId } : {}),
      };
      const res = openOrder
        ? await api<Order>(`/orders/${openOrder.id}/items`, { method: "POST", body: JSON.stringify(body) })
        : await api<Order>("/orders", {
            method: "POST",
            body: JSON.stringify({
              ...body,
              tableNo,
              ...(selectedTable && !isTakeaway ? { tableId: selectedTable.id } : {}),
              ...(assignedCashierId ? { assignedCashierId } : {}),
            }),
          });
      if (!hasMenu) {
        toast.push(t("waiter.sentBillOnly", { n: res.orderNo }), "ok");
      } else if (preview) {
        toast.push(t("waiter.sent", { n: res.orderNo }), "ok");
        setKot({ orderId: res.id, round: res.kotRounds, reprint: false });
      } else {
        toast.push(t("waiter.sentPrint", { n: res.orderNo }), "ok");
      }
      setCart([]);
      setQtyDraft({});
      setOrder(res);
      if (isTakeaway) setSelected(twKey(res.id));
      void loadTables();
      api<{ products: TodaySpecial[] }>("/specials/today")
        .then((d) => setSpecialsToday(d.products || []))
        .catch(() => undefined);
    } catch (e) {
      if (e instanceof ApiError && e.code === "HOTEL_CLOSED") {
        toast.push(t("waiter.hotelClosed"), "err");
        return;
      }
      if (e instanceof ApiError && (e.code === "BATCH_SHORT" || e.code === "BATCH_UNAVAILABLE")) {
        const mixLines = cart.filter((c) => c.saleMode === "MIX" && !c.soloStoreFallback);
        if (mixLines.length) {
          const ok = await ask({
            title: t("waiter.mixFallbackTitle"),
            body: `${e.message}\n\n${t("waiter.mixFallbackRetry")}`,
          });
          if (ok) {
            setCart((prev) =>
              prev.map((c) =>
                c.saleMode === "MIX" && !c.soloStoreFallback
                  ? {
                      ...c,
                      soloStoreFallback: true,
                      cartKey: `${c.menuItemId}:solo`,
                      name: c.name.includes("(") ? c.name : `${c.name} (${t("waiter.storeOnly")})`,
                    }
                  : c
              )
            );
            toast.push(t("waiter.mixFallbackHint"), "ok");
            setBusy(false);
            return;
          }
        }
      }
      toast.push(e instanceof Error ? e.message : t("waiter.sendFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function startBillEdit() {
    if (!order) return;
    const qmap: Record<string, number> = {};
    for (const i of order.items) qmap[i.id] = i.quantity;
    setEditQty(qmap);
    const table = tables.find((tbl) => tbl.id === order.tableId) ?? tables.find((tbl) => tbl.label === order.tableNo);
    setEditMeta({
      partitionId: table?.partitionId ?? "",
      tableId: table?.id ?? "",
      cashierId: order.assignedCashier?.id ?? "",
      supervisorId: order.orderedBy?.id ?? order.waiterId ?? "",
      servedBy: order.servedByName || order.servedBy || "",
    });
    setEditing(true);
    try {
      const [cashiers, servers] = await Promise.all([
        api<EditBillPerson[]>("/payments/cashiers"),
        api<EditBillPerson[]>("/payments/servers"),
      ]);
      setEditStaff([...cashiers, ...servers]);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.editFailed"), "err");
    }
  }

  async function saveEdit() {
    if (!order || !can("order.edit")) return;
    const items = Object.entries(editQty).map(([id, quantity]) => ({ id, quantity }));
    if (!items.length) return;
    setSavingEdit(true);
    try {
      const updated = await api<Order>(`/orders/${order.id}/edit`, {
        method: "POST",
        body: JSON.stringify({
          items,
          ...(editMeta?.tableId ? { tableId: editMeta.tableId } : {}),
          ...(editMeta?.cashierId ? { assignedCashierId: editMeta.cashierId } : {}),
          ...(editMeta?.supervisorId ? { waiterId: editMeta.supervisorId } : {}),
          servedByName: editMeta?.servedBy ?? "",
        }),
      });
      setOrder(updated);
      setEditing(false);
      if (updated.tableId) setSelected(updated.tableId);
      toast.push(t("bills.editSaved"), "ok");
      void loadTables();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.editFailed"), "err");
    } finally {
      setSavingEdit(false);
    }
  }

  async function cancelOrder() {
    if (!order || !can("order.edit")) return;
    if (order.paymentStatus === "PAID" || order.status === "CANCELLED") return;
    const reason = await askPrompt({
      title: t("bills.cancelConfirmTitle"),
      body: t("bills.cancelConfirmBody", { n: order.orderNo }),
      confirmLabel: t("bills.cancelConfirm"),
      danger: true,
      inputLabel: t("bills.cancelReason"),
      inputPlaceholder: t("bills.cancelReasonPh"),
      inputRequired: true,
      inputMaxLength: 200,
    });
    if (!reason) return;
    setCancelling(true);
    try {
      const res = await api<Order & { printQueued?: number; printError?: string | null }>(
        `/orders/${order.id}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        },
      );
      if ((res.printQueued ?? 0) > 0) {
        toast.push(t("bills.cancelled", { n: res.orderNo }), "ok");
      } else {
        toast.push(
          res.printError
            ? `${t("bills.cancelledNoPrint", { n: res.orderNo })} — ${res.printError}`
            : t("bills.cancelledNoPrint", { n: res.orderNo }),
          "err",
        );
      }
      setEditing(false);
      void loadTables();
      back();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("bills.cancelFailed"), "err");
    } finally {
      setCancelling(false);
    }
  }

  async function reprint(round?: number) {
    if (!order) return;
    if (previewFirst) {
      setKot({ orderId: order.id, round, reprint: true });
      return;
    }
    try {
      await serverPrint("kot", order.id, { round });
      toast.push(t("waiter.reprinting"), "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
    }
  }

  async function requestBill() {
    if (!order) return;
    try {
      await api(`/orders/${order.id}/request-bill`, { method: "POST", body: "{}" });
      toast.push(t("waiter.billAsked"), "ok");
      void loadOrder(order.id);
      void loadTables();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("waiter.requestFailed"), "err");
    }
  }

  async function printBillNow() {
    if (!order) return;
    try {
      await serverPrint("bill", order.id);
      toast.push(t("waiter.printingBill"), "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
    }
  }

  function paid() {
    setPaying(false);
    void loadTables();
    back();
  }

  function catLabel(c: string) {
    if (c === "ALL") return t("common.all");
    if (c === "SPECIAL") return t("waiter.specialTab");
    if (c === "General") return t("common.general");
    return c;
  }

  function renderOrderBits(o: OrderSummary) {
    return (
      <>
        <span className="tiny">
          #{o.orderNo} · {minutesSince(o.since, t)}
        </span>
        <span className="tiny">
          {o.billRequested ? t("waiter.billRequested") : ts(o.status)}
          {o.waiter ? ` · ${o.waiter}` : ""}
        </span>
        {o.assignedCashier && (
          <span className="tiny muted">
            {t("waiter.cashier")}: {o.assignedCashier.name}
          </span>
        )}
        <span className="tiny">{money(o.total)}</span>
      </>
    );
  }

  function renderTableCard(tbl: TableCard) {
    return (
      <button
        key={tbl.id}
        type="button"
        className={`table-card ${tableState(tbl)}`}
        onClick={() => openTable(tbl)}
      >
        <strong>{tbl.name}</strong>
        <span className="tiny">{tbl.partitionName || tbl.area || ""}</span>
        {tbl.order ? renderOrderBits(tbl.order) : <span className="tiny">{t("waiter.free")}</span>}
      </button>
    );
  }

  function renderTakeawayCard(tw: TakeawayCard) {
    return (
      <button
        key={tw.id}
        type="button"
        className={`table-card walkin ${orderCardState(tw)}`}
        onClick={() => openTakeaway(tw)}
      >
        <strong>{tw.label || t("waiter.takeaway")}</strong>
        <span className="tiny">{t("waiter.takeaway")}</span>
        {renderOrderBits(tw)}
      </button>
    );
  }

  const kotModal = (
    <>
      <PickServerModal
        open={pickServer}
        initialName={order?.servedByName || order?.servedBy}
        orderTakenBy={order?.orderedBy?.name || order?.waiter || user?.name}
        onClose={() => setPickServer(false)}
        onPick={(name) => afterServerPicked(name)}
      />
      <PickCashierModal
        open={pickCashier}
        onClose={() => {
          setPickCashier(false);
          setPendingServer(null);
        }}
        onPick={(id) => afterCashierPicked(id)}
      />
      <KotPreviewModal target={kot} onClose={closeKot} />
      <PayModal order={paying ? order : null} onClose={() => setPaying(false)} onPaid={paid} />
    </>
  );

  // ---------- table grid ----------
  if (!selected) {
    const visibleTables = partitionFilter
      ? tables.filter((tbl) => tbl.partitionId === partitionFilter)
      : tables;
    const busyCount = visibleTables.filter((tbl) => tbl.order).length + takeaways.length;
    const sections =
      partitions.length > 0
        ? partitions
            .filter((p) => !partitionFilter || p.id === partitionFilter)
            .map((p) => ({
              ...p,
              tables: p.tables.filter((tbl) => !partitionFilter || tbl.partitionId === partitionFilter),
            }))
        : [{ id: "_all", name: "", sortOrder: 0, tables: visibleTables }];
    return (
      <div className="waiter">
        {kotModal}
        <div className="page-head">
          <div>
            <h1>{t("waiter.title")}</h1>
            <p>
              {t("waiter.occupied", { n: busyCount })} ·{" "}
              {t("waiter.freeCount", { n: visibleTables.length - visibleTables.filter((x) => x.order).length })} ·{" "}
              {t("waiter.takeawayOpen", { n: takeaways.length })} · {t("waiter.hint")}
            </p>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => void loadTables()}>
            {t("common.refresh")}
          </button>
        </div>
        {partitions.length > 0 && (
          <div className="chips" style={{ marginBottom: "0.75rem" }}>
            <button
              type="button"
              className={`chip ${!partitionFilter ? "active" : ""}`}
              onClick={() => setPartitionFilter("")}
            >
              {t("waiter.filterAll")}
            </button>
            {partitions.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip ${partitionFilter === p.id ? "active" : ""}`}
                onClick={() => setPartitionFilter(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        <div className="table-legend tiny muted">
          <span className="dot free" /> {t("waiter.free")}{" "}
          <span className="dot busy" /> {t("waiter.inProgress")}
          <span className="dot ready" /> {t("waiter.foodReady")}{" "}
          <span className="dot bill" /> {t("waiter.billRequested")}
        </div>
        {sections.map((p) => (
          <div key={p.id} className="table-partition" style={{ marginBottom: "1.25rem" }}>
            {p.name ? (
              <h2 style={{ margin: "0 0 0.6rem", fontSize: "1.05rem" }}>{p.name}</h2>
            ) : null}
            <div className="table-grid">
              {p.tables.map(renderTableCard)}
            </div>
          </div>
        ))}
        <div className="table-partition" style={{ marginTop: "0.5rem" }}>
          <h2 style={{ margin: "0 0 0.6rem", fontSize: "1.05rem" }}>{t("waiter.takeawaySection")}</h2>
          <div className="table-grid">
            <button
              type="button"
              className="table-card walkin free"
              disabled={hotelClosed}
              onClick={openWalkIn}
            >
              <strong>+ {t("waiter.newTakeaway")}</strong>
              <span className="tiny">{hotelClosed ? t("waiter.hotelClosed") : t("waiter.walkInParcel")}</span>
            </button>
            {takeaways.map(renderTakeawayCard)}
          </div>
        </div>
      </div>
    );
  }

  // ---------- order screen ----------
  const rounds = order
    ? Array.from({ length: order.kotRounds }, (_, i) => i + 1).map((r) => ({
        round: r,
        items: order.items.filter((i) => i.lineKind !== "PER_HEAD" && i.kotRound === r),
      })).filter((r) => r.items.length)
    : [];
  const billOnlyItems = order?.items.filter((i) => i.lineKind === "PER_HEAD") ?? [];
  const showSentBlock = rounds.length > 0 || billOnlyItems.length > 0 || editing;

  return (
    <div className="waiter">
      {kotModal}
      <div className="page-head">
        <div className="row">
          <button type="button" className="btn ghost" onClick={back}>
            {t("waiter.backTables")}
          </button>
          <div>
            <h1 style={{ margin: 0 }}>{selectedLabel}</h1>
            <p style={{ margin: 0 }}>
              {order
                ? `${t("common.order")} #${order.orderNo} · ${ts(order.status)}${order.billRequestedAt ? ` · ${t("waiter.billRequested")}` : ""}`
                : t("waiter.newOrder")}
              {order?.assignedCashier ? ` · ${t("waiter.cashier")}: ${order.assignedCashier.name}` : ""}
            </p>
          </div>
        </div>
        {(selected === WALK_IN || (isTwKey(selected) && !order)) && (
          <input
            className="walkin-name"
            value={walkInName}
            onChange={(e) => setWalkInName(e.target.value)}
            placeholder={t("waiter.customerName")}
          />
        )}
      </div>

      <div className="waiter-layout">
        <section className="panel panel-pad">
          <SearchField value={q} onChange={setQ} placeholder={t("waiter.searchMenu")} />
          <div className="chips" style={{ marginTop: "0.6rem" }}>
            {categories.map((c) => (
              <button key={c} type="button" className={`chip ${cat === c ? "active" : ""}`} onClick={() => setCat(c)}>
                {catLabel(c)}
              </button>
            ))}
          </div>
          <div className="waiter-menu">
            {showPerHeadBtn && (
              <button
                type="button"
                className={`waiter-item waiter-item-perhead ${cart.some((c) => c.cartKey === PER_HEAD_KEY) ? "in-cart" : ""}`}
                onClick={addPerHead}
                title={t("waiter.perHeadHint")}
              >
                <strong>{perHead!.label || t("waiter.perHead")}</strong>
                <span className="tiny muted">
                  {money(perHead!.amount)} / {unitLabel("PCS")} · {t("waiter.onBill")}
                </span>
                {cart.find((c) => c.cartKey === PER_HEAD_KEY) && (
                  <span className="waiter-item-qty">
                    {cart.find((c) => c.cartKey === PER_HEAD_KEY)!.quantity} {unitLabel("PCS")}
                  </span>
                )}
              </button>
            )}
            {shownMenu.map((m) => {
              const inCart = cart.find(
                (c) => c.menuItemId === m.id || c.cartKey === m.id || c.cartKey.startsWith(`${m.id}:`)
              );
              const batch = m.specialProductId ? specialById.get(m.specialProductId) : null;
              const serving =
                m.specialProduct?.servingLabel || batch?.servingLabel || t("specials.plate");
              const remHint =
                m.kind === "SPECIAL" || m.kind === "MIX"
                  ? batch
                    ? ` · ${batch.remainingPlates.toFixed(1)} ${serving}`
                    : ` · ${t("waiter.specialOutShort")}`
                  : "";
              return (
                <button key={m.id} type="button" className={`waiter-item ${inCart ? "in-cart" : ""}`} onClick={() => void add(m)}>
                  <strong>{m.name}</strong>
                  <span className="tiny muted">
                    {m.kind === "SPECIAL"
                      ? `${money(m.specialProduct?.platePrice ?? m.sellingPrice)} / ${serving}`
                      : listPriceLabel(m, money)}
                    {m.minQty ? ` · ≥${m.minQty}` : ""}
                    {m.maxQty != null ? ` · ≤${m.maxQty}` : ""}
                    {remHint}
                  </span>
                  {inCart && (
                    <span className="waiter-item-qty">
                      {inCart.saleMode === "RS" && inCart.amountRs != null
                        ? money(inCart.amountRs)
                        : `${inCart.quantity} ${unitLabel(m.sellUnit)}`}
                    </span>
                  )}
                </button>
              );
            })}
            {!shownMenu.length && !showPerHeadBtn && <div className="empty">{t("waiter.noItems")}</div>}
          </div>
        </section>

        <aside className="panel panel-pad waiter-cart">
          {showPerHeadBtn && (
            <button
              type="button"
              className="btn ghost waiter-perhead-cart"
              onClick={addPerHead}
              title={t("waiter.perHeadHint")}
              style={{ width: "100%", marginBottom: "0.75rem", justifyContent: "space-between" }}
            >
              <span>+ {perHead!.label || t("waiter.perHead")}</span>
              <span className="tiny muted">
                {money(perHead!.amount)} · {t("waiter.onBill")}
              </span>
            </button>
          )}
          {showSentBlock && (
            <div className="sent-items">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>
                  {rounds.length ? t("waiter.sentKitchen") : t("waiter.billCharges")}
                </h3>
                {can("order.edit") && order && order.paymentStatus !== "PAID" && order.status !== "CANCELLED" && (
                  editing ? (
                    <div className="row" style={{ gap: "0.35rem" }}>
                      <button type="button" className="btn sm" disabled={savingEdit} onClick={() => void saveEdit()}>
                        {savingEdit ? t("common.saving") : t("bills.saveEdit")}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <div className="row" style={{ gap: "0.35rem" }}>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => void startBillEdit()}
                      >
                        {t("bills.editOrder")}
                      </button>
                      <button
                        type="button"
                        className="btn danger sm"
                        disabled={cancelling || (order.paidAmount ?? 0) > 0}
                        onClick={() => void cancelOrder()}
                      >
                        {cancelling ? t("common.saving") : t("bills.cancelOrder")}
                      </button>
                    </div>
                  )
                )}
              </div>
              {editing && order && editMeta ? (
                <div style={{ marginTop: "0.75rem" }}>
                  <EditBillForm
                    meta={editMeta}
                    onChange={setEditMeta}
                    currentOrderId={order.id}
                    partitions={partitions.map((p) => ({ id: p.id, name: p.name }))}
                    tables={tables.map((tbl) => ({
                      id: tbl.id,
                      name: tbl.name,
                      partitionId: tbl.partitionId,
                      orderId: tbl.order?.id ?? null,
                    }))}
                    cashiers={withCurrent(
                      editStaff.filter((s) => s.roleCode === "MAIN_CASHIER" || s.roleCode === "CASHIER"),
                      order.assignedCashier
                    )}
                    supervisors={withCurrent(
                      editStaff.filter((s) => s.roleCode === "SUPERVISOR"),
                      order.orderedBy
                    )}
                    servers={serverNames(editStaff, editMeta.servedBy)}
                    labels={{
                      where: t("bills.editWhere"),
                      who: t("bills.editWho"),
                      partition: t("bills.partition"),
                      table: t("bills.table"),
                      cashier: t("bills.cashier"),
                      supervisor: t("bills.supervisor"),
                      servedBy: t("bills.servedBy"),
                      busy: t("bills.tableBusy"),
                    }}
                  />
                  <div className="edit-bill-items">{t("common.items")}</div>
                  {order.items.map((i) => {
                    const menuHit = menu.find((m) => m.name === i.name && m.sellUnit === i.sellUnit);
                    const rules: QtyRules = menuHit
                      ? rulesOf(menuHit)
                      : { sellUnit: i.sellUnit, allowCustomQty: true };
                    const cur = editQty[i.id] ?? i.quantity;
                    const removed = cur <= 0;
                    return (
                    <div key={i.id} className="waiter-line" style={{ marginBottom: "0.35rem" }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
                        <span>
                          {i.name}
                          <span className="tiny muted"> · {unitLabel(i.sellUnit)}</span>
                          {removed ? (
                            <span className="tiny qty-error-msg"> · {t("bills.itemRemoved")}</span>
                          ) : null}
                        </span>
                        {removed ? (
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() =>
                              setEditQty((prev) => ({
                                ...prev,
                                [i.id]: startQtyOf(rules) || i.quantity || 1,
                              }))
                            }
                          >
                            {t("bills.undoRemove")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="icon-btn waiter-remove"
                            onClick={() => setEditQty((prev) => ({ ...prev, [i.id]: 0 }))}
                            aria-label={t("common.remove")}
                            title={t("common.remove")}
                          >
                            ×
                          </button>
                        )}
                      </div>
                      {!removed && (
                      <div className="row waiter-qty">
                        <button
                          type="button"
                          className="qty-btn"
                          onClick={() =>
                            setEditQty((prev) => {
                              const q = prev[i.id] ?? i.quantity;
                              const proposed = +(q - qtyStepOf(rules)).toFixed(3);
                              const next =
                                proposed + 1e-9 < startQtyOf(rules) ? 0 : clampQty(rules, proposed);
                              return { ...prev, [i.id]: next };
                            })
                          }
                        >
                          −
                        </button>
                        {allowCustomOf(rules) ? (
                          <input
                            className="qty-val"
                            style={{ width: "4.2rem", textAlign: "center" }}
                            type="number"
                            min={0}
                            step="any"
                            value={cur}
                            onChange={(e) => {
                              const raw = Number(e.target.value);
                              setEditQty((prev) => ({
                                ...prev,
                                [i.id]: Number.isFinite(raw) ? (raw <= 0 ? 0 : clampQty(rules, raw)) : 0,
                              }));
                            }}
                          />
                        ) : (
                          <span className="qty-val">{cur}</span>
                        )}
                        <button
                          type="button"
                          className="qty-btn"
                          onClick={() =>
                            setEditQty((prev) => ({
                              ...prev,
                              [i.id]: bumpQty(rules, prev[i.id] ?? i.quantity, 1),
                            }))
                          }
                        >
                          +
                        </button>
                      </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  {billOnlyItems.length > 0 && (
                    <div className="sent-round">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="tiny muted">{t("waiter.onBill")}</span>
                      </div>
                      <ul>
                        {billOnlyItems.map((i) => (
                          <li key={i.id}>
                            <strong>
                              {i.quantity} {unitLabel(i.sellUnit)}
                            </strong>{" "}
                            {i.name}
                            <span className="tiny muted"> — {money(i.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {rounds.map((r) => (
                    <div key={r.round} className="sent-round">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="tiny muted">
                          {roundTakers(r.items)
                            ? t("waiter.roundBy", { n: r.round, name: roundTakers(r.items) })
                            : t("kot.round", { n: r.round })}
                        </span>
                        {canReprintKot && (
                          <button type="button" className="btn ghost sm" onClick={() => void reprint(r.round)}>
                            {t("waiter.reprint")}
                          </button>
                        )}
                      </div>
                      <ul>
                        {r.items.map((i) => (
                          <li key={i.id}>
                            <strong>
                              {i.quantity} {unitLabel(i.sellUnit)}
                            </strong>{" "}
                            {i.name}
                            {i.notes ? <span className="tiny muted"> — {i.notes}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}
              <div className="cart-total">
                <span>{t("waiter.billSoFar")}</span>
                <span>{money(order?.total ?? 0)}</span>
              </div>
            </div>
          )}

          <h3>{order ? t("waiter.newItems") : t("common.order")}</h3>
          {!cart.length && <div className="empty">{t("waiter.tapAdd")}</div>}
          {cart.map((l) => {
            const issue = lineQtyIssue(l);
            const minQ = minQtyOf(rulesOf(l));
            const maxQ = maxQtyOf(rulesOf(l));
            const issueMsg =
              issue === "below_min"
                ? t("waiter.qtyKeepAbove", { n: minQ, u: unitLabel(l.sellUnit) })
                : issue === "above_max" && maxQ != null
                  ? t("waiter.qtyKeepBelow", { n: maxQ, u: unitLabel(l.sellUnit) })
                  : issue === "invalid"
                    ? t("waiter.qtyInvalid")
                    : issue === "bad_step"
                      ? t("waiter.qtyBadStep", {
                          n: qtyStepOf(rulesOf(l)),
                          u: unitLabel(l.sellUnit),
                        })
                      : null;
            if (l.fromPerHead && l.perHeadLocked) {
              return (
                <div className="waiter-line waiter-line-perhead-fixed" key={l.cartKey}>
                  <strong>{l.name}</strong>
                  <span className="tiny muted"> · {t("waiter.perHeadIncl")}</span>
                </div>
              );
            }
            return (
            <div className={`waiter-line${issue ? " qty-error" : ""}`} key={l.cartKey}>
              <div className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
                <strong>
                  {l.name}
                  {l.kind === "PER_HEAD" ? (
                    <span className="tiny muted"> · {t("waiter.onBill")}</span>
                  ) : l.fromPerHead ? (
                    <span className="tiny muted"> · {t("waiter.perHeadIncl")}</span>
                  ) : null}
                </strong>
                <div className="row" style={{ gap: "0.35rem", alignItems: "center", flexShrink: 0 }}>
                  <span>
                    {l.fromPerHead
                      ? t("waiter.perHeadIncl")
                      : l.saleMode === "RS" && l.amountRs != null
                        ? money(l.amountRs)
                        : money(l.rate * Math.max(0, l.quantity))}
                  </span>
                  <button
                    type="button"
                    className="icon-btn waiter-remove"
                    onClick={() => setQty(l.cartKey, 0)}
                    aria-label={t("common.remove")}
                    title={t("common.remove")}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="row waiter-qty">
                {l.saleMode === "RS" ? (
                  <>
                    <span className="qty-val">
                      {l.specialGrams != null
                        ? `${Math.round(l.specialGrams * 1000) / 1000} g`
                        : "—"}
                    </span>
                    <span className="tiny muted">{t("waiter.specialGramsLocked")}</span>
                  </>
                ) : (
                  <>
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => {
                    const rules = rulesOf(l);
                    const cur = Number(qtyTextOf(l));
                    const base = Number.isFinite(cur) ? cur : l.quantity;
                    const proposed = +(base - qtyStepOf(rules)).toFixed(3);
                    setQty(l.cartKey, proposed + 1e-9 < startQtyOf(rules) ? 0 : proposed);
                  }}
                >
                  −
                </button>
                {l.kind === "PER_HEAD" || !allowCustomOf(l) ? (
                  <span className="qty-val">{l.quantity}</span>
                ) : (
                  <input
                    className={`field-ctrl sm${issue ? " qty-error-input" : ""}`}
                    style={{ textAlign: "center" }}
                    type="text"
                    inputMode="decimal"
                    value={qtyTextOf(l)}
                    onChange={(e) => setQtyTyped(l.cartKey, e.target.value)}
                    aria-label={t("waiter.qtyCustom")}
                    aria-invalid={!!issue}
                  />
                )}
                <span className="tiny muted">{unitLabel(l.sellUnit)}</span>
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => {
                    const cur = Number(qtyTextOf(l));
                    const base = Number.isFinite(cur) && cur > 0 ? cur : l.quantity;
                    setQty(l.cartKey, bumpQty(rulesOf(l), base, 1));
                  }}
                >
                  +
                </button>
                {quickQtys(rulesOf(l)).map((qv) => (
                  <button
                    key={qv}
                    type="button"
                    className={`chip ${Number(qtyTextOf(l)) === qv ? "active" : ""}`}
                    onClick={() => setQty(l.cartKey, qv)}
                  >
                    {qv}
                  </button>
                ))}
                  </>
                )}
              </div>
              {l.saleMode === "RS" ? (
                <div className="tiny muted">
                  {l.amountRs != null ? money(l.amountRs) : null}
                  {l.specialGrams != null ? ` · ${formatKg(l.specialGrams)}` : ""}
                </div>
              ) : issueMsg ? (
                <div className="tiny qty-error-msg">{issueMsg}</div>
              ) : l.kind === "MENU" && (l.minQty || l.maxQty != null) ? (
                <div className="tiny muted">
                  {l.minQty ? t("waiter.qtyMin", { n: l.minQty, u: unitLabel(l.sellUnit) }) : null}
                  {l.maxQty != null
                    ? `${l.minQty ? " · " : ""}${t("waiter.qtyMaxHint", { n: l.maxQty, u: unitLabel(l.sellUnit) })}`
                    : null}
                </div>
              ) : null}
              {l.kind === "MENU" &&
                (noteFor === l.cartKey || l.notes ? (
                  <input
                    className="waiter-note field-ctrl wide"
                    value={l.notes}
                    onChange={(e) => setNote(l.cartKey, e.target.value)}
                    placeholder={t("waiter.notePh")}
                    autoFocus={noteFor === l.cartKey}
                  />
                ) : (
                  <button type="button" className="btn ghost sm" onClick={() => setNoteFor(l.cartKey)}>
                    {t("waiter.addNote")}
                  </button>
                ))}
            </div>
            );
          })}

          {cart.length > 0 && (
            <div className="cart-total">
              <span>{t("waiter.newItems")}</span>
              <span>{money(cartTotal)}</span>
            </div>
          )}

          {can("order.pay") && !isTakeawayView && !order?.creditCustomer && (
            <div className="waiter-credit">
              <label className="check tiny">
                <input type="checkbox" checked={creditOn} onChange={(e) => setCreditOn(e.target.checked)} />
                {t("waiter.credit")}
              </label>
              {creditOn && (
                <>
                  <p className="tiny muted" style={{ margin: "0.35rem 0" }}>
                    {t("waiter.creditHint")}
                  </p>
                  {creditPick ? (
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong>
                        {creditPick.name} <span className="tiny muted">{creditPick.phone}</span>
                      </strong>
                      <button type="button" className="btn ghost sm" onClick={() => setCreditPick(null)}>
                        {t("credit.change")}
                      </button>
                    </div>
                  ) : (
                    <>
                      <SearchField value={creditQ} onChange={setCreditQ} placeholder={t("waiter.creditSearch")} />
                      {creditLookup === "done" && creditQ.trim() && !creditHits.length && (
                        <div className="tiny muted" style={{ marginTop: "0.35rem" }}>
                          {t("credit.noMatch")}
                        </div>
                      )}
                      {creditHits.length > 0 && (
                        <div className="suggest-list">
                          {creditHits.map((hit) => (
                            <button
                              key={hit.id}
                              type="button"
                              className="suggest-item"
                              onClick={() => setCreditPick(hit)}
                            >
                              <strong>{hit.name}</strong>
                              <span className="tiny muted">{hit.phone}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {order?.creditCustomer && (
            <div className="waiter-credit">
              <strong>
                {t("waiter.onCredit")}: {order.creditCustomer.name}
              </strong>
              <div className="tiny muted">{order.creditCustomer.phone}</div>
              {order.status !== "COMPLETED" && order.paymentStatus !== "PAID" && (
                <button type="button" className="btn ghost sm" style={{ marginTop: "0.4rem" }} disabled={busy} onClick={() => void releaseCreditTable()}>
                  {t("waiter.guestLeft")}
                </button>
              )}
            </div>
          )}

          {hotelClosed && <p className="hotel-note">{t("waiter.hotelClosed")}</p>}
          <button
            type="button"
            className="btn waiter-send"
            disabled={busy || !cart.length || cartQtyBlocked || hotelClosed}
            onClick={() => void sendToKitchen()}
          >
            {busy
              ? t("waiter.sending")
              : cartHasMenu
                ? t("waiter.sendKitchen", { n: cart.length })
                : t("waiter.addToBill", { n: cart.length })}
          </button>
          {canReprintKot && cartHasMenu && (
            <label className="check tiny muted" style={{ marginTop: "0.5rem" }}>
              <input type="checkbox" checked={previewFirst} onChange={(e) => setPreviewFirst(e.target.checked)} />
              {t("waiter.previewKot")}
            </label>
          )}

          {order && (canReprintKot || (can("bill.request") && showTakeawayCashierBillActions)) && (
            <div className="row" style={{ marginTop: "0.6rem" }}>
              {canReprintKot && (
                <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => void reprint()}>
                  {t("waiter.reprintFull")}
                </button>
              )}
              {can("bill.request") && showTakeawayCashierBillActions && (
                <button
                  type="button"
                  className="btn warn"
                  style={{ flex: 1 }}
                  disabled={!!order.billRequestedAt}
                  onClick={() => void requestBill()}
                >
                  {order.billRequestedAt ? t("waiter.billRequested") : t("waiter.requestBill")}
                </button>
              )}
            </div>
          )}
          {order &&
            order.paymentStatus !== "PAID" &&
            order.status !== "CANCELLED" &&
            ((isCashierRole && can("print.bill")) || can("order.pay")) && (
            <div className="row" style={{ marginTop: "0.6rem" }}>
              {/* Bill thermal print = cashier counter only; supervisor uses Request bill. */}
              {isCashierRole && can("print.bill") && showTakeawayCashierBillActions && (
                <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => void printBillNow()}>
                  {t("waiter.printBill")}
                </button>
              )}
              {can("order.pay") && !order.creditCustomer && (
                <button type="button" className="btn ok" style={{ flex: 1 }} onClick={() => setPaying(true)}>
                  {t("waiter.takePayment")} {money(order.total - (order.paidAmount ?? 0))}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      <Modal
        open={!!specialPick}
        title={specialPick ? specialPick.name : t("waiter.specialTab")}
        onClose={() => setSpecialPick(null)}
      >
        {specialPick && (
          <div>
            <p className="tiny muted">
              {(() => {
                const b = specialPick.specialProductId
                  ? specialById.get(specialPick.specialProductId)
                  : null;
                const unit =
                  specialPick.specialProduct?.servingLabel || b?.servingLabel || t("specials.plate");
                return b
                  ? t("waiter.specialRemain", {
                      kg: formatKg(b.remainingGrams),
                      p: b.remainingPlates.toFixed(1),
                      unit,
                      rs: money(b.maxRs),
                    })
                  : t("waiter.specialOut");
              })()}
            </p>
            {(() => {
              const b = specialPick.specialProductId
                ? specialById.get(specialPick.specialProductId)
                : null;
              const sellMode = specialPick.specialProduct?.sellMode || b?.sellMode || "BOTH";
              const unit =
                specialPick.specialProduct?.servingLabel || b?.servingLabel || t("specials.plate");
              if (sellMode !== "BOTH") return null;
              return (
            <div className="chips" style={{ margin: "0.75rem 0" }}>
              <button
                type="button"
                className={`chip ${specialMode === "PLATE" ? "active" : ""}`}
                onClick={() => setSpecialMode("PLATE")}
              >
                {t("waiter.saleServing", { unit })}
              </button>
              <button
                type="button"
                className={`chip ${specialMode === "RS" ? "active" : ""}`}
                onClick={() => setSpecialMode("RS")}
              >
                {t("waiter.saleRs")}
              </button>
            </div>
              );
            })()}
            {specialMode === "RS" && (
              <>
                <div className="field">
                  <label>{t("waiter.amountRs")}</label>
                  <input
                    value={specialRs}
                    onChange={(e) => setSpecialRs(e.target.value)}
                    placeholder="500"
                    inputMode="decimal"
                    autoFocus
                  />
                </div>
                {(() => {
                  const b = specialPick.specialProductId
                    ? specialById.get(specialPick.specialProductId)
                    : null;
                  const platePrice =
                    specialPick.specialProduct?.platePrice || b?.platePrice || specialPick.sellingPrice;
                  const plateGrams =
                    specialPick.specialProduct?.plateGrams || b?.plateGrams || 1;
                  const rs = Number(specialRs);
                  if (!(rs > 0) || !(platePrice > 0)) {
                    return (
                      <p className="tiny muted" style={{ marginTop: 0 }}>
                        {t("waiter.specialGramsHint")}
                      </p>
                    );
                  }
                  const grams = Math.round((rs / platePrice) * plateGrams * 1000) / 1000;
                  return (
                    <div className="field">
                      <label>{t("waiter.specialGrams")}</label>
                      <div
                        className="field-ctrl"
                        style={{
                          padding: "0.55rem 0.75rem",
                          background: "var(--panel-2, rgba(0,0,0,0.04))",
                          fontWeight: 700,
                        }}
                      >
                        {grams} g
                        <span className="tiny muted" style={{ marginLeft: "0.5rem", fontWeight: 500 }}>
                          ({formatKg(grams)})
                        </span>
                      </div>
                      <p className="tiny muted" style={{ margin: "0.35rem 0 0" }}>
                        {t("waiter.specialGramsAuto", {
                          price: money(platePrice),
                          plateG: String(plateGrams),
                        })}
                      </p>
                    </div>
                  );
                })()}
              </>
            )}
            <div className="form-actions">
              <button type="button" className="btn ghost" onClick={() => setSpecialPick(null)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn" onClick={confirmSpecialAdd}>
                {t("waiter.addToCart")}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!perHeadWizard}
        title={
          perHeadWizard?.step === "itemQty"
            ? t("waiter.perHeadVarTitle")
            : t("waiter.perHeadPersonsTitle")
        }
        onClose={() => setPerHeadWizard(null)}
        size="sm"
      >
        {perHeadWizard?.step === "persons" && (
          <div>
            <p style={{ marginTop: 0 }}>{t("waiter.perHeadPersonsHint")}</p>
            <div className="field">
              <label>{t("waiter.perHeadPersonsLabel")}</label>
              <input
                type="number"
                min={1}
                step={1}
                value={perHeadWizard.persons}
                autoFocus
                onChange={(e) =>
                  setPerHeadWizard({ step: "persons", persons: e.target.value })
                }
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn ghost" onClick={() => setPerHeadWizard(null)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn" onClick={continuePerHeadPersons}>
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
        {perHeadWizard?.step === "itemQty" && (
          <div>
            <p style={{ marginTop: 0 }}>
              {t("waiter.perHeadVarBody", {
                name: perHeadWizard.item.name,
                n: perHeadWizard.persons,
              })}
            </p>
            <p className="tiny muted">
              {t("waiter.perHeadPersonsCount", { n: perHeadWizard.persons })}
            </p>
            {(perHead?.items ?? [])
              .filter((i) => !i.variable)
              .map((i) => (
                <div key={i.menuItemId} className="tiny muted">
                  {i.name}: {i.qty} {unitLabel(i.sellUnit)} · {t("waiter.perHeadIncl")}
                </div>
              ))}
            <div className="field" style={{ marginTop: "0.75rem" }}>
              <label>
                {t("waiter.perHeadVarLabel", {
                  unit: unitLabel(perHeadWizard.item.sellUnit),
                })}
              </label>
              <input
                type="number"
                min={0.001}
                step="any"
                value={perHeadWizard.qty}
                autoFocus
                onChange={(e) =>
                  setPerHeadWizard((p) =>
                    p?.step === "itemQty" ? { ...p, qty: e.target.value } : p
                  )
                }
              />
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setPerHeadWizard({ step: "persons", persons: String(perHeadWizard.persons) })}
              >
                {t("common.back")}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const n = Number(perHeadWizard.qty);
                  if (!Number.isFinite(n) || n <= 0) {
                    toast.push(t("waiter.qtyFixFirst"), "err");
                    return;
                  }
                  commitPerHead({ heads: perHeadWizard.persons, variableQty: n });
                }}
              >
                {t("waiter.addToCart")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
