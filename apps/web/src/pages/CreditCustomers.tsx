import { useEffect, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useBrand } from "../brand";
import { Modal } from "../components/Modal";
import { SearchField } from "../components/SearchField";
import { useI18n, useT, type MessageKey } from "../i18n";
import { useToast } from "../toast";

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  cnic: string | null;
  openInvoices: number;
  outstanding: number;
};

type Invoice = {
  id: string;
  orderNo: number;
  tableNo: string | null;
  createdAt: string;
  total: number;
  paidAmount: number;
  due: number;
  paymentStatus: string;
  items: { name: string; quantity: number; unit: string; amount: number }[];
};

type Day = { date: string; invoices: Invoice[]; total: number; outstanding: number };

type Account = {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  cnic: string | null;
  outstanding: number;
  days: Day[];
};

type Slip = {
  restaurant: { name: string; tagline: string; address: string; phone: string };
  customer: { name: string; phone: string; address: string | null; cnic: string | null };
  collectedBy: string;
  paidAt: string;
  days: {
    date: string;
    total: number;
    invoices: {
      orderNo: number;
      tableNo: string | null;
      total: number;
      paid: number;
      dueAfter: number;
      items: { name: string; quantity: number; unit: string; amount: number }[];
    }[];
  }[];
  total: number;
  outstandingBefore: number;
  remaining: number;
  cleared: boolean;
};

const emptyForm = { name: "", phone: "", address: "", cnic: "" };

function statusBadge(status: string, t: (k: MessageKey) => string) {
  if (status === "PAID") return { cls: "paid", label: t("credit.paid") };
  if (status === "PARTIAL") return { cls: "pending", label: t("credit.partial") };
  return { cls: "unpaid", label: t("credit.open") };
}

export function CreditCustomersPage() {
  const t = useT();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [slip, setSlip] = useState<Slip | null>(null);
  const [preview, setPreview] = useState<Slip | null>(null);
  const [openBill, setOpenBill] = useState<string | null>(null);

  async function loadList(term = q) {
    const list = await api<CustomerRow[]>(`/credit-customers${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ""}`);
    setRows(list);
    return list;
  }

  async function openAccount(id: string) {
    setSelectedId(id);
    setEditing(false);
    setSlip(null);
    const detail = await api<Account>(`/credit-customers/${id}`);
    setAccount(detail);
    setPayAmount(detail.outstanding > 0 ? String(detail.outstanding) : "");
    setForm({
      name: detail.name,
      phone: detail.phone,
      address: detail.address ?? "",
      cnic: detail.cnic ?? "",
    });
  }

  useEffect(() => {
    let cancelled = false;
    const term = q.trim();
    const handle = window.setTimeout(() => {
      void api<CustomerRow[]>(`/credit-customers${term ? `?q=${encodeURIComponent(term)}` : ""}`)
        .then((list) => {
          if (!cancelled) setRows(list);
        })
        .catch((e) => {
          if (!cancelled) toast.push(e instanceof Error ? e.message : t("credit.loadFailed"), "err");
        });
    }, term ? 280 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [q]);

  async function saveCustomer() {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.push(t("credit.needNamePhone"), "err");
      return;
    }
    setBusy(true);
    try {
      const saved = await api<{ id: string }>(editing && selectedId ? `/credit-customers/${selectedId}` : "/credit-customers", {
        method: editing && selectedId ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });
      toast.push(t("credit.saved"), "ok");
      await loadList("");
      setQ("");
      await openAccount(saved.id);
      setEditing(false);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("credit.saveFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    if (!account || account.outstanding <= 0) return;
    const value = Math.round(Number(payAmount) * 100) / 100;
    if (!(value > 0)) {
      toast.push(t("credit.enterAmount"), "err");
      return;
    }
    const amount = Math.min(value, account.outstanding);
    setBusy(true);
    try {
      const paid = await api<Slip>(`/credit-customers/${account.id}/settle`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      toast.push(paid.cleared ? t("credit.settledClear") : t("credit.settled"), "ok");
      await loadList(q);
      await openAccount(account.id);
      setSlip(paid);
      setPreview(paid);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("credit.settleFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const payValue = Math.max(0, Number(payAmount) || 0);
  const payNow = account ? Math.min(payValue, account.outstanding) : 0;
  const remainingAfter = account ? Math.max(0, Math.round((account.outstanding - payNow) * 100) / 100) : 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t("credit.title")}</h1>
          <p>{t("credit.subtitle")}</p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setSelectedId(null);
            setAccount(null);
            setEditing(true);
            setForm(emptyForm);
            setPayAmount("");
            setSlip(null);
            setPreview(null);
          }}
        >
          {t("credit.new")}
        </button>
      </div>
      <div className="credit-layout">
        <section className="panel panel-pad">
          <SearchField value={q} onChange={setQ} placeholder={t("credit.searchPh")} />
          {q.trim() && !rows.length && (
            <div className="tiny muted" style={{ marginTop: "0.45rem" }}>
              {t("credit.noMatch")}
            </div>
          )}
          <div className="suggest-list" style={{ marginTop: "0.75rem", maxHeight: 480 }}>
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`suggest-item credit-suggest-item ${selectedId === r.id ? "active" : ""}`}
                onClick={() => void openAccount(r.id)}
              >
                <span className="credit-suggest-main">
                  <strong>{r.name}</strong>
                  <span className="tiny muted">{r.phone}</span>
                </span>
                <span className="tiny credit-suggest-bal">
                  {r.outstanding > 0 ? money(r.outstanding) : t("credit.clear")}
                </span>
              </button>
            ))}
            {!rows.length && !q.trim() && <div className="empty">{t("credit.empty")}</div>}
          </div>
        </section>

        <section className="panel panel-pad">
          {editing && !account ? (
            <CustomerForm form={form} setForm={setForm} busy={busy} onSave={() => void saveCustomer()} />
          ) : account ? (
            <>
              <div className="credit-account-head">
                <div>
                  <h2 style={{ margin: 0 }}>{account.name}</h2>
                  <div className="tiny muted">
                    {account.phone}
                    {account.cnic ? ` · ${account.cnic}` : ""}
                  </div>
                  {account.address && <div className="tiny muted">{account.address}</div>}
                </div>
                <div className="panel stat credit-outstanding">
                  <span>{t("credit.outstanding")}</span>
                  <strong>{money(account.outstanding)}</strong>
                </div>
              </div>
              <div className="row page-head-actions" style={{ marginTop: "0.7rem" }}>
                <button type="button" className="btn ghost sm" onClick={() => setEditing((v) => !v)}>
                  {t("credit.edit")}
                </button>
                {slip && (
                  <button type="button" className="btn ghost sm" onClick={() => setPreview(slip)}>
                    {t("credit.printSlip")}
                  </button>
                )}
              </div>
              {account.outstanding > 0 && (
                <div className="credit-pay-box">
                  <div className="field">
                    <label htmlFor="credit-pay-amount">{t("credit.payAmount")}</label>
                    <input
                      id="credit-pay-amount"
                      type="number"
                      min={0.01}
                      step={0.01}
                      inputMode="decimal"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                    />
                  </div>
                  <div className="credit-pay-meta">
                    <div className="tiny muted">
                      {t("credit.outstanding")}: {money(account.outstanding)}
                    </div>
                    <div className="tiny">
                      {t("credit.remaining")}: <strong>{money(remainingAfter)}</strong>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => setPayAmount(String(account.outstanding))}
                    >
                      {t("credit.payAll")}
                    </button>
                    <button
                      type="button"
                      className="btn ok sm"
                      disabled={busy || payNow <= 0}
                      onClick={() => void settle()}
                    >
                      {t("credit.pay")} · {money(payNow)}
                    </button>
                  </div>
                </div>
              )}
              {editing && (
                <div style={{ marginTop: "0.8rem" }}>
                  <CustomerForm form={form} setForm={setForm} busy={busy} onSave={() => void saveCustomer()} />
                </div>
              )}
              {!account.days.length && <div className="empty">{t("credit.noInvoices")}</div>}
              {account.days.map((day) => (
                <div key={day.date} className="credit-day">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{day.date}</strong>
                    <span className="tiny muted">
                      {t("credit.dayTotal")} {money(day.total)}
                      {day.outstanding > 0 ? ` · ${t("credit.due")} ${money(day.outstanding)}` : ""}
                    </span>
                  </div>
                  {day.invoices.map((inv) => {
                    const badge = statusBadge(inv.paymentStatus, t);
                    return (
                      <div key={inv.id} className="credit-invoice">
                        <button
                          type="button"
                          className="credit-invoice-head"
                          onClick={() => setOpenBill(openBill === inv.id ? null : inv.id)}
                        >
                          <span>
                            #{inv.orderNo} · {inv.tableNo || "—"}
                          </span>
                          <span>
                            {money(inv.total)}
                            {inv.due > 0 && inv.paymentStatus !== "UNPAID" ? ` · ${t("credit.due")} ${money(inv.due)}` : ""}
                            {" · "}
                            <span className={`badge ${badge.cls}`}>{badge.label}</span>
                          </span>
                        </button>
                        {openBill === inv.id && (
                          <ul className="tiny" style={{ margin: "0.25rem 0 0.4rem", paddingLeft: "1.1rem" }}>
                            {inv.items.map((item, i) => (
                              <li key={`${inv.id}-${i}`}>
                                {item.quantity} {unitLabel(item.unit)} {item.name}
                                <span className="muted"> — {money(item.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          ) : (
            <div className="empty">{t("credit.pick")}</div>
          )}
        </section>
      </div>
      <CreditPaidModal slip={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function CreditPaidModal({ slip, onClose }: { slip: Slip | null; onClose: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const { brand, logoSrc } = useBrand();
  const dateLocale = locale === "ur" ? "ur-PK" : "en-PK";
  const when = slip ? new Date(slip.paidAt) : new Date();
  const cleared = !!slip?.cleared;

  return (
    <Modal open={!!slip} title={t("credit.paidSlip")} onClose={onClose}>
      {slip && (
        <>
          <div className="modal-scroll">
            <div className="receipt-wrap">
              <div className="receipt" id="bill-print-area">
                <div className="receipt-head">
                  {logoSrc && <img className="receipt-logo" src={logoSrc} alt="" />}
                  <div className="receipt-hotel">{brand.name || slip.restaurant.name}</div>
                  {(brand.tagline || slip.restaurant.tagline) && (
                    <div className="receipt-sub">{brand.tagline || slip.restaurant.tagline}</div>
                  )}
                  {(brand.address || slip.restaurant.address) && (
                    <div className="receipt-sub">{brand.address || slip.restaurant.address}</div>
                  )}
                  {(brand.phone || slip.restaurant.phone) && (
                    <div className="receipt-sub">
                      {t("bill.tel")} {brand.phone || slip.restaurant.phone}
                    </div>
                  )}
                </div>
                <div className="receipt-rule" />
                <div className="receipt-stamp">{cleared ? t("credit.paidStamp") : t("credit.partialStamp")}</div>
                <div className="receipt-meta" style={{ textAlign: "center" }}>
                  <strong>{t("credit.settlement")}</strong>
                </div>
                <div className="receipt-meta">
                  <div>
                    <strong>{slip.customer.name}</strong>
                  </div>
                  <div>{slip.customer.phone}</div>
                  {slip.customer.address && <div>{slip.customer.address}</div>}
                  {slip.customer.cnic && <div>CNIC {slip.customer.cnic}</div>}
                  <div>
                    {when.toLocaleDateString(dateLocale)}{" "}
                    {when.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div>
                    {t("credit.collectedBy")}: {slip.collectedBy}
                  </div>
                </div>
                {slip.days.map((day) => (
                  <div key={day.date}>
                    <div className="receipt-rule" />
                    <div className="receipt-day">
                      <span>{day.date}</span>
                      <span>{money(day.total)}</span>
                    </div>
                    {day.invoices.map((inv) => (
                      <div key={inv.orderNo}>
                        <div className="receipt-sub">
                          #{inv.orderNo} · {inv.tableNo || "—"} · {t("credit.paidNow")} {money(inv.paid)}
                          {inv.dueAfter > 0 ? ` · ${t("credit.due")} ${money(inv.dueAfter)}` : ""}
                        </div>
                        {inv.items.map((item, i) => (
                          <div key={`${inv.orderNo}-${i}`} className="receipt-item">
                            <div className="receipt-item-name">{item.name}</div>
                            <div className="receipt-item-row pair">
                              <span>
                                {item.quantity} {unitLabel(item.unit)}
                              </span>
                              <span>{money(item.amount)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
                <div className="receipt-rule" />
                <div className="receipt-total">
                  <span>{t("credit.wasDue")}</span>
                  <strong>{money(slip.outstandingBefore)}</strong>
                </div>
                <div className="receipt-total">
                  <span>{t("credit.paidNow")}</span>
                  <strong>{money(slip.total)}</strong>
                </div>
                <div className="receipt-total">
                  <span>{t("credit.remainingBill")}</span>
                  <strong>{money(slip.remaining)}</strong>
                </div>
                <div className="receipt-pay">
                  <strong>*** {cleared ? t("credit.paidStamp") : t("credit.partialStamp")} ***</strong>
                </div>
              </div>
            </div>
          </div>
          <div className="form-footer no-print">
            <button type="button" className="btn ghost" onClick={onClose}>
              {t("common.close")}
            </button>
            <button type="button" className="btn" onClick={() => window.print()}>
              {t("common.print")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function CustomerForm({
  form,
  setForm,
  busy,
  onSave,
}: {
  form: typeof emptyForm;
  setForm: (f: typeof emptyForm) => void;
  busy: boolean;
  onSave: () => void;
}) {
  const t = useT();
  return (
    <div className="credit-form">
      <div className="field">
        <label htmlFor="credit-name">{t("credit.name")}</label>
        <input
          id="credit-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="credit-phone">{t("credit.phone")}</label>
        <input
          id="credit-phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="credit-address">{t("credit.address")}</label>
        <input
          id="credit-address"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="credit-cnic">{t("credit.cnic")}</label>
        <input id="credit-cnic" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} />
      </div>
      <div className="form-actions">
        <button type="button" className="btn" disabled={busy} onClick={onSave}>
          {busy ? t("common.saving") : t("credit.save")}
        </button>
      </div>
    </div>
  );
}
