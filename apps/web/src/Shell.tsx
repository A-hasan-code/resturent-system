import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AccountModal } from "./components/AccountModal";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { PoweredBy } from "./components/PoweredBy";
import { useAuth } from "./auth";
import {
  DEVELOPER_UNLOCK_EVENT,
  isDeveloperUnlocked,
  unlockDeveloper,
} from "./developer/dev-unlock";
import { HotelGateProvider, useHotelGate } from "./hotel-gate";
import { MessageKey, useT } from "./i18n";
import { useToast } from "./toast";
import { useSocketEvent } from "./socket";
import { alertBeep } from "./printing";
import { money } from "./api";
import { useBrand } from "./brand";
import { acquireScrollLock, releaseScrollLock } from "./scroll-lock";

type Tab = { to: string; labelKey: MessageKey; perms: string[]; hideFor?: string[] };

const GROUPS: { titleKey: MessageKey; tabs: Tab[] }[] = [
  {
    titleKey: "nav.group.service",
    tabs: [
      { to: "/", labelKey: "nav.dashboard", perms: [], hideFor: ["WAITER", "SUPERVISOR"] },
      { to: "/waiter", labelKey: "nav.waiter", perms: ["order.viewOwn", "order.addItems", "order.create"] },
      { to: "/bills", labelKey: "nav.bills", perms: ["bill.view", "order.pay"] },
      { to: "/credit", labelKey: "nav.credit", perms: ["bill.view", "order.pay"] },
      { to: "/kitchen", labelKey: "nav.kitchen", perms: ["kitchen.view"] },
    ],
  },
  {
    titleKey: "nav.group.backOffice",
    tabs: [
      { to: "/store", labelKey: "nav.store", perms: ["store.view", "store.manage"] },
      { to: "/recipes", labelKey: "nav.recipes", perms: ["recipe.view", "recipe.manage"] },
      { to: "/menu", labelKey: "nav.menu", perms: ["menu.view", "menu.manage"] },
      { to: "/specials", labelKey: "nav.specials", perms: ["menu.view", "menu.manage", "close.view", "close.manage", "store.manage"] },
    ],
  },
  {
    titleKey: "nav.group.admin",
    tabs: [
      { to: "/payments", labelKey: "nav.payments", perms: ["payments.view"] },
      { to: "/finance", labelKey: "nav.finance", perms: ["payments.view", "close.view", "reports.view"] },
      { to: "/audit", labelKey: "nav.audit", perms: ["payments.view"] },
      { to: "/expenses", labelKey: "nav.expenses", perms: ["expense.view", "expense.manage"] },
      { to: "/workers", labelKey: "nav.workers", perms: ["expense.view", "expense.manage"] },
      { to: "/close", labelKey: "nav.close", perms: ["close.view", "close.manage"] },
      { to: "/users", labelKey: "nav.users", perms: ["users.manage"] },
      { to: "/table-settings", labelKey: "nav.tableSettings", perms: ["tables.manage"] },
      { to: "/developer", labelKey: "nav.developer", perms: ["system.manage"] },
      { to: "/settings", labelKey: "nav.settings", perms: ["printers.manage", "system.manage"] },
    ],
  },
];

const ROLE_KEY: Record<string, MessageKey> = {
  ADMIN: "role.ADMIN",
  SYSTEM_MANAGER: "role.SYSTEM_MANAGER",
  SUPERVISOR: "role.SUPERVISOR",
  MAIN_CASHIER: "role.MAIN_CASHIER",
  MANAGER: "role.MANAGER",
  CASHIER: "role.CASHIER",
  WAITER: "role.WAITER",
  KITCHEN: "role.KITCHEN",
  STORE: "role.STORE",
};

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

type OrderEv = { orderNo: number; tableNo: string | null; waiter?: string | null };
type KitchenSlowEv = OrderEv & { waitSeconds?: number };
type KitchenLateEv = OrderEv & {
  targetMinutes?: number;
  lateByMinutes?: number;
  elapsedMinutes?: number;
};
type PrintEv = { type: string; error?: string; printer?: string | null; orderNo?: number | null };
type CashEv = { amount: number; orderNo: number; tableNo?: string | null; from?: string; by?: string };

function LiveAlerts() {
  const toast = useToast();
  const { user } = useAuth();

  useSocketEvent<OrderEv>("bill.requested", (o) => {
    toast.push(`Bill request: ${o.tableNo || `#${o.orderNo}`}${o.waiter ? ` (${o.waiter})` : ""}`, "info");
    alertBeep();
  });

  useSocketEvent<OrderEv>("order.ready", (o) => {
    toast.push(`Order ready — pick up: ${o.tableNo || "Walk-in"} · #${o.orderNo}`, "ok");
    if (user?.roleCode === "WAITER" || user?.roleCode === "SUPERVISOR") alertBeep();
  });

  useSocketEvent<KitchenSlowEv>("kitchen.pending.slow", (o) => {
    const where = o.tableNo || `Walk-in`;
    toast.push(`Kitchen delay: ${where} · #${o.orderNo} still pending — start cooking`, "err");
    alertBeep();
  });

  useSocketEvent<KitchenLateEv>("kitchen.prep.late", (o) => {
    const where = o.tableNo || `Walk-in`;
    const late = o.lateByMinutes ?? 1;
    const target = o.targetMinutes ?? 15;
    toast.push(
      `Kitchen late: ${where} · #${o.orderNo} — ${late}m over target (${target}m)`,
      "err"
    );
    alertBeep();
  });

  useSocketEvent<PrintEv>("print.failed", (j) => {
    const what = j.type === "KOT" ? "Kitchen slip" : j.type === "BILL" ? "Bill" : "Test print";
    toast.push(`${what} failed to print${j.orderNo ? ` (#${j.orderNo})` : ""}: ${j.error || "printer error"}`, "err");
  });

  useSocketEvent<PrintEv>("print.done", (j) => {
    if (j.type === "TEST") toast.push(`Test print OK — ${j.printer ?? ""}`, "ok");
  });

  useSocketEvent<CashEv>("cash.handover", (p) => {
    toast.push(`${p.from} handed you ${money(p.amount)} for bill #${p.orderNo} — confirm in Billing`, "info");
    alertBeep();
  });

  useSocketEvent<CashEv>("cash.confirmed", (p) => {
    toast.push(`${p.by} confirmed receiving ${money(p.amount)} (bill #${p.orderNo})`, "ok");
  });

  return null;
}

export function Shell() {
  return (
    <HotelGateProvider>
      <ShellFrame />
    </HotelGateProvider>
  );
}

function ShellFrame() {
  const { user, logout, can } = useAuth();
  const { gate } = useHotelGate();
  const { brand, logoSrc } = useBrand();
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [account, setAccount] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [devUnlocked, setDevUnlocked] = useState(() => isDeveloperUnlocked());
  const role = user?.roleCode ?? "";
  const groups = GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((tab) => {
      if (tab.hideFor?.includes(role)) return false;
      if (tab.perms.length && !can(...tab.perms)) return false;
      // Developer tab stays hidden until Ctrl+Shift+D (or unlock phrase)
      if (tab.to === "/developer" && !devUnlocked) return false;
      return true;
    }),
  })).filter((g) => g.tabs.length);
  const showTitles = groups.length > 1;
  const { pathname } = useLocation();
  const roleKey = ROLE_KEY[role];

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const sync = () => setDevUnlocked(isDeveloperUnlocked());
    window.addEventListener(DEVELOPER_UNLOCK_EVENT, sync);
    return () => window.removeEventListener(DEVELOPER_UNLOCK_EVENT, sync);
  }, []);

  /** Ctrl+Shift+D — unlock + open Developer setup (system.manage only). */
  useEffect(() => {
    if (!can("system.manage")) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey && (e.key === "d" || e.key === "D"))) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      unlockDeveloper();
      setDevUnlocked(true);
      navigate("/developer");
      toast.push(t("dev.tabUnlocked"), "ok");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [can, navigate, t, toast]);

  useEffect(() => {
    if (!navOpen) return;
    document.querySelector(".side-link.active")?.scrollIntoView({ block: "nearest" });
  }, [pathname, navOpen]);

  useEffect(() => {
    if (account) setNavOpen(false);
  }, [account]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 981px)");
    const onChange = () => {
      if (mq.matches) setNavOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    acquireScrollLock();
    return () => releaseScrollLock();
  }, [navOpen]);

  return (
    <div className={`shell${navOpen ? " nav-open" : ""}`}>
      <LiveAlerts />
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-menu-btn"
          aria-label={navOpen ? t("shell.closeMenu") : t("shell.openMenu")}
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
          onClick={() => setNavOpen((v) => !v)}
        >
          <span className="mobile-menu-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        <div className="mobile-topbar-brand">
          {logoSrc ? <img className="brand-logo" src={logoSrc} alt="" /> : null}
          <strong>{brand.name || t("brand.name")}</strong>
        </div>
        <LanguageSwitcher compact />
      </header>
      <button
        type="button"
        className="nav-backdrop"
        aria-label={t("shell.closeMenu")}
        tabIndex={navOpen ? 0 : -1}
        onClick={() => setNavOpen(false)}
      />
      <aside id="app-sidebar" className="sidebar">
        <div className="brand-mark">
          <div className="brand-mark-row">
            {logoSrc ? <img className="brand-logo" src={logoSrc} alt="" /> : null}
            <div className="brand-mark-text">
              <h1>{brand.name || t("brand.name")}</h1>
              {(brand.tagline || t("brand.tagline")) && (
                <p>{brand.tagline || t("brand.tagline")}</p>
              )}
            </div>
          </div>
        </div>
        <nav className="side-nav">
          {groups.map((g) => (
            <div key={g.titleKey} className="side-group">
              {showTitles && <div className="side-group-title">{t(g.titleKey)}</div>}
              {g.tabs.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.to === "/"}
                  className={({ isActive }) => (isActive ? "side-link active" : "side-link")}
                >
                  {t(tab.labelKey)}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-user">
          <LanguageSwitcher compact />
          <div className="side-user-id">
            <span className="side-avatar" aria-hidden="true">
              {initials(user?.name)}
            </span>
            <div className="side-user-text">
              <strong>{user?.name}</strong>
              <span>
                {roleKey ? t(roleKey) : role} · @{user?.username}
              </span>
            </div>
          </div>
          <div className="side-user-actions">
            <button type="button" className="side-user-btn" onClick={() => setAccount(true)}>
              {t("shell.myAccount")}
            </button>
            <button type="button" className="side-user-btn" onClick={logout}>
              {t("shell.logout")}
            </button>
          </div>
        </div>
      </aside>
      <AccountModal open={account} onClose={() => setAccount(false)} />
      <div className="content">
        <div className="content-main">
          {gate && !gate.acceptingOrders && (
            <div className="hotel-banner" role="status">
              {t("hotel.bannerClosed")}
            </div>
          )}
          <Outlet />
        </div>
        <PoweredBy className="no-print" />
      </div>
    </div>
  );
}
