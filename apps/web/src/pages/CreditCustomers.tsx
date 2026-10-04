import { useEffect, useState } from "react";
import { api, money, unitLabel } from "../api";
import { useBrand } from "../brand";
import { Modal } from "../components/Modal";
import { SearchField } from "../components/SearchField";
import { useI18n, useT } from "../i18n";
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
      items: { name: string; quantity: number; unit: string; amount: number }[];
    }[];
  }[];
  total: number;
};

const emptyForm = { name: "", phone: "", address: "", cnic: "" };

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
    setBusy(true);
    try {
      const paid = await api<Slip>(`/credit-customers/${account.id}/settle`, { method: "POST" });
      toast.push(t("credit.settled"), "ok");
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

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("credit.title")}</h1>
          <p className="muted">{t("credit.subtitle")}</p>
        </div>
      </header>
      <div className="credit-layout">
        <section className="panel panel-pad">
          <SearchField value={q} onChange={setQ} placeholder={t("credit.searchPh")} />
          {q.trim() && !rows.length && <div className="tiny muted" style={{ marginTop: "0.45rem" }}>{t("credit.noMatch")}</div>}
          <button
            type="button"
            className="btn sm"
            style={{ marginTop: "0.6rem" }}
            onClick={() => {
              setSelectedId(null);
              setAccount(null);
              setEditing(true);
              setForm(emptyForm);
              setSlip(null);
              setPreview(null);
            }}
          >
            {t("credit.new")}
          </button>
          <ul className="credit-list">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" className={selectedId === r.id ? "active" : ""} onClick={() => void openAccount(r.id)}>
                  <strong>{r.name}</strong>
                  <span className="tiny muted">{r.phone}</span>
                  <span>{r.outstanding > 0 ? money(r.outstanding) : t("credit.clear")}</span>
                </button>
              </li>
            ))}
            {!rows.length && !q.trim() && <li className="empty">{t("credit.empty")}</li>}
          </ul>
        </section>

        <section className="panel panel-pad">
          {editing && !account ? (
            <CustomerForm form={form} setForm={setForm} busy={busy} onSave={() => void saveCustomer()} />
          ) : account ? (
            <>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h2 style={{ margin: 0 }}>{account.name}</h2>
                  <div className="tiny muted">
                    {account.phone}
                    {account.cnic ? ` · ${account.cnic}` : ""}
                  </div>
                  {account.address && <div className="tiny muted">{account.address}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="tiny muted">{t("credit.outstanding")}</div>
                  <strong>{money(account.outstanding)}</strong>
                </div>
              </div>
              <div className="row" style={{ marginTop: "0.7rem" }}>
                <button type="button" className="btn ghost sm" onClick={() => setEditing((v) => !v)}>
                  {t("credit.edit")}
                </button>
                <button type="button" className="btn ok sm" disabled={busy || account.outstanding <= 0} onClick={() => void settle()}>
                  {t("credit.payAll")}
                </button>
                {slip && (
                  <button type="button" className="btn ghost sm" onClick={() => setPreview(slip)}>
                    {t("credit.printSlip")}
                  </button>
                )}
              </div>
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
                  {day.invoices.map((inv) => (
                    <div key={inv.id} className="credit-invoice">
                      <button type="button" className="credit-invoice-head" onClick={() => setOpenBill(openBill === inv.id ? null : inv.id)}>
                        <span>
                          #{inv.orderNo} · {inv.tableNo || "—"}
                        </span>
                        <span>
                          {money(inv.total)} · {inv.paymentStatus === "PAID" ? t("credit.paid") : t("credit.open")}
                        </span>
                      </button>
                      {openBill === inv.id && (
                        <ul>
                          {inv.items.map((item, i) => (
                            <li key={`${inv.id}-${i}`}>
                              {item.quantity} {item.unit} {item.name}
                              <span className="tiny muted"> — {money(item.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
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
                <div className="receipt-stamp">{t("credit.paidStamp")}</div>
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
                          #{inv.orderNo} · {inv.tableNo || "—"}
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
                  <span>{t("credit.paidNow")}</span>
                  <strong>{money(slip.total)}</strong>
                </div>
                <div className="receipt-pay">
                  <strong>*** {t("credit.paidStamp")} ***</strong>
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
      <label>
        {t("credit.name")}
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label>
        {t("credit.phone")}
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </label>
      <label>
        {t("credit.address")}
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </label>
      <label>
        {t("credit.cnic")}
        <input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} />
      </label>
      <button type="button" className="btn" disabled={busy} onClick={onSave}>
        {t("credit.save")}
      </button>
    </div>
  );
}
