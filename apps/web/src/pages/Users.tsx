import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useT, type MessageKey } from "../i18n";
import { useToast } from "../toast";
import { Modal } from "../components/Modal";
import { SearchField, matchesSearch } from "../components/SearchField";

type StaffUser = {
  id: string;
  name: string;
  username: string;
  active: boolean;
  hasPin: boolean;
  billPrinterId: string | null;
  billPrinterName: string | null;
  roleCode: string;
  roleName: string;
  createdAt: string;
};

type Role = { code: string; name: string };
type BillPrinter = { id: string; name: string; station: string; printsBill: boolean; active: boolean };

type Draft = {
  id?: string;
  name: string;
  username: string;
  roleCode: string;
  password: string;
  pin: string;
  removePin: boolean;
  active: boolean;
  hasPin: boolean;
  billPrinterId: string;
};

const ROLE_HELP: Record<string, MessageKey> = {
  ADMIN: "users.helpAdmin",
  SUPERVISOR: "users.helpSupervisor",
  MAIN_CASHIER: "users.helpMainCashier",
  MANAGER: "users.helpSupervisor",
  CASHIER: "users.helpCashier",
  WAITER: "users.helpWaiter",
  KITCHEN: "users.helpKitchen",
  STORE: "users.helpStore",
};

const EMPTY: Draft = {
  name: "",
  username: "",
  roleCode: "WAITER",
  password: "",
  pin: "",
  removePin: false,
  active: true,
  hasPin: false,
  billPrinterId: "",
};

function errMsg(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

function roleKey(code: string): MessageKey {
  return `role.${code}` as MessageKey;
}

export function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const t = useT();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [billPrinters, setBillPrinters] = useState<BillPrinter[]>([]);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const isAdmin = user?.roleCode === "ADMIN";

  const load = useCallback(async () => {
    try {
      const [u, r, printers] = await Promise.all([
        api<StaffUser[]>("/users"),
        api<Role[]>("/users/roles"),
        api<BillPrinter[]>("/printers").catch(() => [] as BillPrinter[]),
      ]);
      setUsers(u);
      setRoles(r);
      setBillPrinters(printers.filter((p) => p.active && p.printsBill));
    } catch (e) {
      toast.push(errMsg(e, t("users.loadFailed")), "err");
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignable = roles.filter((r) => isAdmin || r.code !== "ADMIN");
  const shown = users.filter((u) => matchesSearch(q, u.name, u.username, u.roleName, u.roleCode));

  function edit(u: StaffUser) {
    setDraft({
      id: u.id,
      name: u.name,
      username: u.username,
      roleCode: u.roleCode,
      password: "",
      pin: "",
      removePin: false,
      active: u.active,
      hasPin: u.hasPin,
      billPrinterId: u.billPrinterId ?? "",
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      if (draft.id) {
        const body: Record<string, unknown> = {
          name: draft.name,
          username: draft.username,
          roleCode: draft.roleCode,
          active: draft.active,
          billPrinterId: draft.billPrinterId || null,
        };
        if (draft.password) body.password = draft.password;
        if (draft.removePin) body.pin = null;
        else if (draft.pin) body.pin = draft.pin;
        await api(`/users/${draft.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.push(t("users.updated"), "ok");
      } else {
        await api("/users", {
          method: "POST",
          body: JSON.stringify({
            name: draft.name,
            username: draft.username,
            roleCode: draft.roleCode,
            password: draft.password,
            pin: draft.pin || undefined,
            billPrinterId: draft.billPrinterId || undefined,
          }),
        });
        toast.push(t("users.created", { name: draft.username }), "ok");
      }
      setDraft(null);
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("users.saveFailed")), "err");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(u: StaffUser, active: boolean) {
    try {
      await api(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      toast.push(
        active
          ? t("users.enabledToast", { name: u.name })
          : t("users.disabledToast", { name: u.name }),
        "ok"
      );
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  const locked = (u: StaffUser) => u.roleCode === "ADMIN" && !isAdmin;

  function roleLabel(code: string, fallback: string) {
    const key = roleKey(code);
    const translated = t(key);
    return translated === key ? fallback : translated;
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("users.title")}</h1>
          <p>{t("users.subtitle")}</p>
        </div>
        <button type="button" className="btn" onClick={() => setDraft({ ...EMPTY })}>
          {t("users.add")}
        </button>
      </div>

      <div className="panel panel-pad">
        <SearchField value={q} onChange={setQ} placeholder={t("users.search")} />
        <table style={{ marginTop: "0.75rem" }}>
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("users.username")}</th>
              <th>{t("users.role")}</th>
              <th>{t("users.billPrinter")}</th>
              <th>{t("users.pinLogin")}</th>
              <th>{t("common.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={u.active ? "" : "inactive-row"}>
                <td>
                  <strong>{u.name}</strong>
                  {u.id === user?.id && <span className="tiny muted"> {t("common.you")}</span>}
                </td>
                <td>@{u.username}</td>
                <td>{roleLabel(u.roleCode, u.roleName)}</td>
                <td className="tiny">{u.billPrinterName || "—"}</td>
                <td>{u.hasPin ? <span className="badge paid">{t("users.set")}</span> : <span className="tiny muted">—</span>}</td>
                <td>
                  <span className={`badge ${u.active ? "ready" : "unpaid"}`}>
                    {u.active ? t("common.active") : t("common.disabled")}
                  </span>
                </td>
                <td className="row">
                  <button type="button" className="btn ghost sm" disabled={locked(u)} onClick={() => edit(u)}>
                    {t("common.edit")}
                  </button>
                  {u.id !== user?.id && (
                    <button
                      type="button"
                      className={`btn sm ${u.active ? "danger" : "ok"}`}
                      disabled={locked(u)}
                      onClick={() => void setActive(u, !u.active)}
                    >
                      {u.active ? t("users.disable") : t("users.enable")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={7} className="empty">
                  {t("users.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          {t("users.footer")}
        </p>
      </div>

      <Modal
        wide
        open={!!draft}
        title={draft?.id ? `${t("common.edit")} · ${draft.name}` : t("users.add")}
        onClose={() => setDraft(null)}
      >
        {draft && (
          <form onSubmit={save} className="user-form">
            <div className="modal-scroll">
            <section className="form-section">
              <h3>{t("users.profile")}</h3>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="u-name">{t("users.fullName")}</label>
                  <input
                    id="u-name"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder={t("users.namePh")}
                    required
                    minLength={2}
                  />
                  <span className="hint">{t("users.nameHint")}</span>
                </div>
                <div className="field">
                  <label htmlFor="u-username">{t("users.username")}</label>
                  <input
                    id="u-username"
                    value={draft.username}
                    onChange={(e) =>
                      setDraft({ ...draft, username: e.target.value.toLowerCase().replace(/\s/g, "") })
                    }
                    placeholder={t("users.usernamePh")}
                    autoCapitalize="none"
                    required
                    minLength={3}
                  />
                  <span className="hint">{t("users.usernameHint")}</span>
                </div>
              </div>
            </section>

            <section className="form-section">
              <h3>{t("users.role")}</h3>
              {draft.id === user?.id && <p className="hint">{t("users.cannotChangeRole")}</p>}
              <div className="role-picker" role="radiogroup" aria-label={t("users.role")}>
                {assignable.map((r) => (
                  <button
                    key={r.code}
                    type="button"
                    role="radio"
                    aria-checked={draft.roleCode === r.code}
                    disabled={draft.id === user?.id}
                    className={`role-option ${draft.roleCode === r.code ? "selected" : ""}`}
                    onClick={() => setDraft({ ...draft, roleCode: r.code })}
                  >
                    <strong>{roleLabel(r.code, r.name)}</strong>
                    <span>{ROLE_HELP[r.code] ? t(ROLE_HELP[r.code]) : ""}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="form-section">
              <h3>{t("users.signIn")}</h3>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="u-pass">
                    {draft.id ? t("users.newPassword") : t("users.password")}
                  </label>
                  <input
                    id="u-pass"
                    type="password"
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    autoComplete="new-password"
                    minLength={6}
                    required={!draft.id}
                    placeholder={draft.id ? t("users.passwordLeave") : t("users.passwordHint")}
                  />
                </div>
                <div className="field">
                  <label htmlFor="u-pin">
                    {draft.id && draft.hasPin ? t("users.newPin") : t("users.quickPin")}
                  </label>
                  <input
                    id="u-pin"
                    inputMode="numeric"
                    value={draft.pin}
                    disabled={draft.removePin}
                    onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    pattern="\d{4,6}"
                    placeholder={draft.id && draft.hasPin ? t("users.passwordLeave") : t("users.pinHint")}
                    autoComplete="off"
                  />
                </div>
              </div>
              <p className="hint">{t("users.pinStaffHint")}</p>
              {draft.id && draft.hasPin && (
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={draft.removePin}
                    onChange={(e) => setDraft({ ...draft, removePin: e.target.checked, pin: "" })}
                  />
                  <span>
                    <strong>{t("users.removePin")}</strong>
                    <small>{t("users.passwordOnly")}</small>
                  </span>
                </label>
              )}
            </section>

            <section className="form-section">
              <h3>{t("users.billPrinter")}</h3>
              <p className="hint">{t("users.billPrinterHint")}</p>
              <div className="field">
                <label htmlFor="u-bill-printer">{t("users.billPrinter")}</label>
                <select
                  id="u-bill-printer"
                  value={draft.billPrinterId}
                  onChange={(e) => setDraft({ ...draft, billPrinterId: e.target.value })}
                >
                  <option value="">{t("users.billPrinterDefault")}</option>
                  {billPrinters.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.station ? `${p.name} · ${p.station}` : p.name}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            {draft.id && draft.id !== user?.id && (
              <section className="form-section">
                <h3>{t("common.status")}</h3>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                  />
                  <span>
                    <strong>
                      {draft.active ? t("users.accountActive") : t("users.accountDisabled")}
                    </strong>
                    <small>{t("users.disabledHint")}</small>
                  </span>
                </label>
              </section>
            )}

            </div>
            <div className="form-footer">
              <button className="btn ghost" type="button" onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn" type="submit" disabled={saving}>
                {saving
                  ? t("common.saving")
                  : draft.id
                    ? t("users.saveChanges")
                    : t("users.create")}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
