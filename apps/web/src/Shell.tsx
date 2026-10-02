import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { AccountModal } from "./components/AccountModal";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { useAuth } from "./auth";
import { MessageKey, useT } from "./i18n";
import { useToast } from "./toast";
import { useSocketEvent } from "./socket";
import { alertBeep } from "./printing";
import { money } from "./api";
import { useBrand } from "./brand";

type Tab = { to: string; labelKey: MessageKey; perms: string[]; hideFor?: string[] };

const GROUPS: { titleKey: MessageKey; tabs: Tab[] }[] = [
  {
    titleKey: "nav.group.service",
    tabs: [
      { to: "/", labelKey: "nav.dashboard", perms: [], hideFor: ["WAITER", "MANAGER"] },
      { to: "/waiter", labelKey: "nav.waiter", perms: ["order.viewOwn", "order.addItems"] },
      { to: "/orders", labelKey: "nav.orders", perms: ["order.create"], hideFor: ["WAITER"] },
      { to: "/bills", labelKey: "nav.bills", perms: ["bill.view", "order.pay"] },
      { to: "/kitchen", labelKey: "nav.kitchen", perms: ["kitchen.view"] },
    ],
  },
  {
    titleKey: "nav.group.backOffice",
    tabs: [
      { to: "/store", labelKey: "nav.store", perms: ["store.view", "store.manage"] },
      { to: "/recipes", labelKey: "nav.recipes", perms: ["recipe.view", "recipe.manage"] },
      { to: "/menu", labelKey: "nav.menu", perms: ["menu.view", "menu.manage"] },
    ],
  },
  {
    titleKey: "nav.group.admin",
    tabs: [
      { to: "/payments", labelKey: "nav.payments", perms: ["payments.view"] },
      { to: "/audit", labelKey: "nav.audit", perms: ["payments.view"] },
      { to: "/users", labelKey: "nav.users", perms: ["users.manage"] },
      { to: "/settings", labelKey: "nav.settings", perms: ["printers.manage", "system.manage", "tables.manage"] },
    ],
  },
];

const ROLE_KEY: Record<string, MessageKey> = {
  ADMIN: "role.ADMIN",
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
    toast.push(`Food ready: ${o.tableNo || "Walk-in"} · #${o.orderNo}`, "ok");
    if (user?.roleCode === "WAITER") alertBeep();
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
  const { user, logout, can } = useAuth();
  const { brand, logoSrc } = useBrand();
  const t = useT();
  const [account, setAccount] = useState(false);
  const role = user?.roleCode ?? "";
  const groups = GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((tab) => !tab.hideFor?.includes(role) && (!tab.perms.length || can(...tab.perms))),
  })).filter((g) => g.tabs.length);
  const showTitles = groups.length > 1;
  const { pathname } = useLocation();
  const roleKey = ROLE_KEY[role];

  useEffect(() => {
    document.querySelector(".side-link.active")?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  return (
    <div className="shell">
      <LiveAlerts />
      <aside className="sidebar">
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
        <Outlet />
      </div>
    </div>
  );
}
