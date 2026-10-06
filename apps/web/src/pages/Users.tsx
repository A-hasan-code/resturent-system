import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, money } from "../api";
import { useAuth } from "../auth";
import { useI18n, useT, type MessageKey } from "../i18n";
import { useToast } from "../toast";
import { useConfirm } from "../components/ConfirmModal";
import { Modal } from "../components/Modal";
import { Pagination, paginate } from "../components/Pagination";
import { SearchField, matchesSearch } from "../components/SearchField";

const PAGE_SIZE = 15;

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

type UserStats = {
  billHistory: number;
  billsAsCashier: number;
  billsAsWaiter: number;
  billsAssigned: number;
  billsCancelled: number;
  paymentsCollected: number;
  paymentsCollectedAmount: number;
  tipsCollectedOnPayments: number;
  cashHandovers: number;
  tipShares: number;
  tipSharesAmount: number;
  billEdits: number;
};

type RecentBill = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  status: string;
  paymentStatus: string;
  total: number;
  paidAmount: number;
  createdAt: string;
  roles: string[];
};

type UserDetail = StaffUser & {
  stats: UserStats;
  recentBills: RecentBill[];
};

type Role = { code: string; name: string };
type BillPrinter = {
  id: string;
  name: string;
  station: string;
  printsBill: boolean;
  active: boolean;
  kind?: string;
  agent?: { displayName: string; hostname: string; online: boolean } | null;
};

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
  SYSTEM_MANAGER: "users.helpSystemManager",
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

function fmtWhen(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleString(locale === "ur" ? "ur-PK" : "en-PK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const ask = useConfirm();
  const t = useT();
  const { ts, locale } = useI18n();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [billPrinters, setBillPrinters] = useState<BillPrinter[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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
  const pageRows = paginate(shown, page, PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [q]);

  async function openDetail(u: StaffUser) {
    setDetailLoading(true);
    setDetail({
      ...u,
      stats: {
        billHistory: 0,
        billsAsCashier: 0,
        billsAsWaiter: 0,
        billsAssigned: 0,
        billsCancelled: 0,
        paymentsCollected: 0,
        paymentsCollectedAmount: 0,
        tipsCollectedOnPayments: 0,
        cashHandovers: 0,
        tipShares: 0,
        tipSharesAmount: 0,
        billEdits: 0,
      },
      recentBills: [],
    });
    try {
      const d = await api<UserDetail>(`/users/${u.id}`);
      setDetail(d);
    } catch (err) {
      setDetail(null);
      toast.push(errMsg(err, t("users.loadFailed")), "err");
    } finally {
      setDetailLoading(false);
    }
  }

  function edit(u: StaffUser) {
    setDetail(null);
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
      if (detail?.id === u.id) void openDetail({ ...u, active });
    } catch (err) {
      toast.push(errMsg(err, t("common.failed")), "err");
    }
  }

  async function removeUser(u: StaffUser) {
    if (
      !(await ask({
        title: t("users.deleteTitle"),
        body: t("users.deleteConfirm", { name: u.name }),
        confirmLabel: t("common.delete"),
        danger: true,
      }))
    ) {
      return;
    }
    try {
      await api(`/users/${u.id}`, { method: "DELETE" });
      toast.push(t("users.deleted", { name: u.name }), "ok");
      if (draft?.id === u.id) setDraft(null);
      if (detail?.id === u.id) setDetail(null);
      void load();
    } catch (err) {
      toast.push(errMsg(err, t("users.deleteFailed")), "err");
    }
  }

  const locked = (u: StaffUser) => u.roleCode === "ADMIN" && !isAdmin;

  function roleLabel(code: string, fallback: string) {
    const key = roleKey(code);
    const translated = t(key);
    return translated === key ? fallback : translated;
  }

  function billRoleLabel(code: string) {
    if (code === "cashier") return t("users.roleCashier");
    if (code === "waiter") return t("users.roleWaiter");
    if (code === "assigned") return t("users.roleAssigned");
    if (code === "cancelled") return t("users.roleCancelled");
    return code;
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
            {pageRows.map((u) => (
              <tr key={u.id} className={u.active ? "" : "inactive-row"}>
                <td>
                  <button
                    type="button"
                    className="linkish"
                    disabled={locked(u)}
                    onClick={() => void openDetail(u)}
                  >
                    <strong>{u.name}</strong>
                  </button>
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
                  <button type="button" className="btn ghost sm" disabled={locked(u)} onClick={() => void openDetail(u)}>
                    {t("users.view")}
                  </button>
                  <button type="button" className="btn ghost sm" disabled={locked(u)} onClick={() => edit(u)}>
                    {t("common.edit")}
                  </button>
                  {u.id !== user?.id && (
                    <>
                      <button
                        type="button"
                        className={`btn sm ${u.active ? "ghost" : "ok"}`}
                        disabled={locked(u)}
                        onClick={() => void setActive(u, !u.active)}
                      >
                        {u.active ? t("users.disable") : t("users.enable")}
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={locked(u)}
                        onClick={() => void removeUser(u)}
                      >
                        {t("common.delete")}
                      </button>
                    </>
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
        <Pagination page={page} pageSize={PAGE_SIZE} total={shown.length} onChange={setPage} />
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          {t("users.footer")}
        </p>
      </div>

      <Modal
        wide
        open={!!detail}
        title={detail ? `${t("users.details")} · ${detail.name}` : t("users.details")}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="user-form user-detail">
            <div className="modal-scroll">
              <section className="form-section">
                <h3>{t("users.profile")}</h3>
                <dl className="user-detail-meta">
                  <div>
                    <dt>{t("common.name")}</dt>
                    <dd>{detail.name}</dd>
                  </div>
                  <div>
                    <dt>{t("users.username")}</dt>
                    <dd>@{detail.username}</dd>
                  </div>
                  <div>
                    <dt>{t("users.role")}</dt>
                    <dd>{roleLabel(detail.roleCode, detail.roleName)}</dd>
                  </div>
                  <div>
                    <dt>{t("common.status")}</dt>
                    <dd>
                      <span className={`badge ${detail.active ? "ready" : "unpaid"}`}>
                        {detail.active ? t("common.active") : t("common.disabled")}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("users.pinLogin")}</dt>
                    <dd>{detail.hasPin ? t("users.set") : "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("users.createdAt")}</dt>
                    <dd>{fmtWhen(detail.createdAt, locale)}</dd>
                  </div>
                  <div className="user-detail-meta-wide">
                    <dt>{t("users.billPrinter")}</dt>
                    <dd>{detail.billPrinterName || t("users.billPrinterDefault")}</dd>
                  </div>
                </dl>
              </section>

              <section className="form-section">
                <h3>{t("users.activity")}</h3>
                {detailLoading ? (
                  <p className="hint">{t("common.loading")}</p>
                ) : (
                  <div className="user-stats">
                    {(
                      [
                        { label: t("users.statBillHistory"), value: detail.stats.billHistory },
                        { label: t("users.statAsCashier"), value: detail.stats.billsAsCashier },
                        { label: t("users.statAsWaiter"), value: detail.stats.billsAsWaiter },
                        { label: t("users.statAssigned"), value: detail.stats.billsAssigned },
                        {
                          label: t("users.statPayments"),
                          value: detail.stats.paymentsCollected,
                          sub: money(detail.stats.paymentsCollectedAmount),
                        },
                        {
                          label: t("users.statTips"),
                          value: detail.stats.tipShares,
                          sub: money(detail.stats.tipSharesAmount),
                        },
                        { label: t("users.statCancelled"), value: detail.stats.billsCancelled },
                        { label: t("users.statBillEdits"), value: detail.stats.billEdits },
                      ] as { label: string; value: number; sub?: string }[]
                    ).map((s) => (
                      <div key={s.label} className="user-stat">
                        <span>{s.label}</span>
                        <strong>{s.value}</strong>
                        <small>{s.sub ?? "\u00a0"}</small>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="form-section form-section-last">
                <h3>{t("users.recentBills")}</h3>
                {detailLoading ? (
                  <p className="hint">{t("common.loading")}</p>
                ) : detail.recentBills.length ? (
                  <div className="table-wrap user-bills-wrap">
                    <table className="user-bills-table">
                      <thead>
                        <tr>
                          <th>{t("users.billNo")}</th>
                          <th>{t("users.table")}</th>
                          <th>{t("common.status")}</th>
                          <th>{t("users.payment")}</th>
                          <th>{t("users.onBillAs")}</th>
                          <th className="num">{t("users.amount")}</th>
                          <th>{t("users.when")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.recentBills.map((b) => (
                          <tr key={b.id}>
                            <td className="num">#{b.orderNo}</td>
                            <td>{b.tableNo || "—"}</td>
                            <td>
                              <span className="badge pending">{ts(b.status)}</span>
                            </td>
                            <td>
                              <span className={`badge ${b.paymentStatus === "PAID" ? "paid" : "unpaid"}`}>
                                {ts(b.paymentStatus)}
                              </span>
                            </td>
                            <td>{b.roles.map(billRoleLabel).join(", ") || "—"}</td>
                            <td className="num">{money(b.total)}</td>
                            <td className="when">{fmtWhen(b.createdAt, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="hint">{t("users.noBills")}</p>
                )}
              </section>
            </div>
            <div className="form-footer user-detail-footer">
              <button className="btn ghost" type="button" onClick={() => setDetail(null)}>
                {t("common.close")}
              </button>
              <button className="btn ghost" type="button" onClick={() => edit(detail)}>
                {t("common.edit")}
              </button>
              {detail.id !== user?.id && (
                <>
                  <button
                    type="button"
                    className={`btn ${detail.active ? "ghost" : "ok"}`}
                    disabled={locked(detail)}
                    onClick={() => void setActive(detail, !detail.active)}
                  >
                    {detail.active ? t("users.disable") : t("users.enable")}
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={locked(detail)}
                    onClick={() => void removeUser(detail)}
                  >
                    {t("common.delete")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

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
                  {billPrinters.map((p) => {
                    const pc =
                      p.agent?.displayName || p.agent?.hostname || p.station || "";
                    const online =
                      p.agent == null
                        ? ""
                        : p.agent.online
                          ? ` · ${t("settings.agentOnline")}`
                          : ` · ${t("settings.agentOffline")}`;
                    return (
                      <option key={p.id} value={p.id}>
                        {pc ? `${pc} — ${p.name}${online}` : p.name}
                      </option>
                    );
                  })}
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
