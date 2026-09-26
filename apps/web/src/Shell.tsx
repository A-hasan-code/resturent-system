import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth";

type Tab = { to: string; label: string; perms: string[] };

const TABS: Tab[] = [
  { to: "/", label: "Dashboard", perms: [] },
  { to: "/orders", label: "Orders / POS", perms: ["order.create"] },
  { to: "/bills", label: "Billing", perms: ["bill.view", "order.pay"] },
  { to: "/kitchen", label: "Kitchen", perms: ["kitchen.view"] },
  { to: "/store", label: "Inventory", perms: ["store.view", "store.manage"] },
  { to: "/recipes", label: "Recipes", perms: ["recipe.view", "recipe.manage"] },
  { to: "/menu", label: "Menu Rates", perms: ["menu.view", "menu.manage"] },
];

export function Shell() {
  const { user, logout, can } = useAuth();
  const tabs = TABS.filter((t) => !t.perms.length || can(...t.perms));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <h1>Hotel System</h1>
          <p>Offline POS · Store · Kitchen</p>
        </div>
        <nav className="side-nav">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) =>
                isActive ? "side-link active" : "side-link"
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-user">
          <strong>{user?.name}</strong>
          <span>
            {user?.roleCode} · @{user?.username}
          </span>
          <button
            type="button"
            className="btn ghost sm"
            style={{ marginTop: "0.75rem", width: "100%" }}
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </aside>
      <div className="content">
        <Outlet />
      </div>
    </div>
  );
}
