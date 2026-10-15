import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, money } from "../api";
import { useAuth } from "../auth";
import { Modal } from "../components/Modal";
import { useConfirm } from "../components/ConfirmModal";
import { DateField } from "../components/DateField";
import { SearchField, matchesSearch } from "../components/SearchField";
import { useShiftOpen } from "../hotel-gate";
import { useT } from "../i18n";
import { useToast } from "../toast";

type PayType = "DAILY" | "MONTHLY";
type LedgerKind =
  | "OPENING_ADVANCE"
  | "OPENING_PAYABLE"
  | "ADVANCE"
  | "SALARY_CREDIT"
  | "OTHER_DEBIT"
  | "RECOVERY"
  | "SETTLE_PAYABLE";
type BalanceStatus = "JAMA" | "BANAM" | "ZERO";

type Worker = {
  id: string;
  name: string;
  jobTitle: string | null;
  phone: string | null;
  payType: PayType;
  rate: number;
  active: boolean;
  note: string | null;
  balance: number;
  status: BalanceStatus;
  openingAdvance: number;
  openingPayable: number;
  ledgerCount: number;
};

type LedgerLine = {
  id: string;
  kind: LedgerKind;
  entryOn: string;
  detail: string;
  note: string | null;
  debit: number;
  credit: number;
  balance: number;
  status: BalanceStatus;
  editable: boolean;
};

type LedgerResult = {
  worker: {
    id: string;
    name: string;
    jobTitle: string | null;
    phone: string | null;
    payType: PayType;
    rate: number;
    active: boolean;
    note: string | null;
  };
  balance: number;
  status: BalanceStatus;
  lines: LedgerLine[];
};

type EntryMode = "SALARY_CREDIT" | "SALARY_CASH" | "ADVANCE" | "OTHER_DEBIT" | null;

function isoDay(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function statusColor(status: BalanceStatus) {
  if (status === "JAMA") return "var(--ok)";
  if (status === "BANAM") return "var(--danger)";
  return undefined;
}

export function WorkersPage() {
  const t = useT();
  const toast = useToast();
  const { can } = useAuth();
  const confirm = useConfirm();
  const canManage = can("expense.manage");
  const shiftOpen = useShiftOpen();
  const canEditShift = canManage && shiftOpen;

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerResult | null>(null);
  const [busy, setBusy] = useState(false);

  const [workerOpen, setWorkerOpen] = useState(false);
  const [editWorker, setEditWorker] = useState<Worker | null>(null);
  const [wName, setWName] = useState("");
  const [wJob, setWJob] = useState("");
  const [wPhone, setWPhone] = useState("");
  const [wPayType, setWPayType] = useState<PayType>("MONTHLY");
  const [wRate, setWRate] = useState("");
  const [wNote, setWNote] = useState("");
  const [wActive, setWActive] = useState(true);
  const [wOpenSide, setWOpenSide] = useState<"JAMA" | "BANAM" | "NONE">("NONE");
  const [wOpenAmt, setWOpenAmt] = useState("");

  const [entryMode, setEntryMode] = useState<EntryMode>(null);
  const [editLine, setEditLine] = useState<LedgerLine | null>(null);
  const [eDate, setEDate] = useState(isoDay());
  const [eAmount, setEAmount] = useState("");
  const [eDetail, setEDetail] = useState("");

  const loadWorkers = useCallback(async () => {
    try {
      setWorkers(await api<Worker[]>("/workers?all=1"));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("workers.loadFailed"), "err");
    }
  }, [toast, t]);

  const loadLedger = useCallback(
    async (id: string) => {
      try {
        setLedger(await api<LedgerResult>(`/workers/${id}/ledger`));
      } catch (e) {
        toast.push(e instanceof Error ? e.message : t("workers.loadFailed"), "err");
      }
    },
    [toast, t]
  );

  useEffect(() => {
    void loadWorkers();
  }, [loadWorkers]);

  useEffect(() => {
    if (selectedId) void loadLedger(selectedId);
    else setLedger(null);
  }, [selectedId, loadLedger]);

  const filtered = useMemo(
    () =>
      workers.filter(
        (w) =>
          matchesSearch(q, w.name, w.jobTitle || "", w.phone || "") &&
          (w.active || selectedId === w.id)
      ),
    [workers, q, selectedId]
  );

  function resetWorkerForm() {
    setEditWorker(null);
    setWName("");
    setWJob("");
    setWPhone("");
    setWPayType("MONTHLY");
    setWRate("");
    setWNote("");
    setWActive(true);
    setWOpenSide("NONE");
    setWOpenAmt("");
  }

  function openAddWorker() {
    resetWorkerForm();
    setWorkerOpen(true);
  }

  function openEditWorker(w: Worker) {
    setEditWorker(w);
    setWName(w.name);
    setWJob(w.jobTitle || "");
    setWPhone(w.phone || "");
    setWPayType(w.payType);
    setWRate(w.rate ? String(w.rate) : "");
    setWNote(w.note || "");
    setWActive(w.active);
    if (w.openingPayable > 0) {
      setWOpenSide("JAMA");
      setWOpenAmt(String(w.openingPayable));
    } else if (w.openingAdvance > 0) {
      setWOpenSide("BANAM");
      setWOpenAmt(String(w.openingAdvance));
    } else {
      setWOpenSide("NONE");
      setWOpenAmt("");
    }
    setWorkerOpen(true);
  }

  async function saveWorker(e: FormEvent) {
    e.preventDefault();
    if (!canEditShift) return;
    const amt = Number(wOpenAmt) || 0;
    const body = {
      name: wName.trim(),
      jobTitle: wJob.trim() || undefined,
      phone: wPhone.trim() || undefined,
      payType: wPayType,
      rate: Number(wRate) || 0,
      note: wNote.trim() || undefined,
      active: wActive,
      openingPayable: wOpenSide === "JAMA" ? amt : 0,
      openingAdvance: wOpenSide === "BANAM" ? amt : 0,
    };
    setBusy(true);
    try {
      if (editWorker) {
        await api(`/workers/${editWorker.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.push(t("workers.saved"), "ok");
      } else {
        const created = await api<Worker>("/workers", { method: "POST", body: JSON.stringify(body) });
        toast.push(t("workers.saved"), "ok");
        setSelectedId(created.id);
      }
      setWorkerOpen(false);
      resetWorkerForm();
      await loadWorkers();
      if (selectedId) await loadLedger(selectedId);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("workers.saveFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function removeWorker(w: Worker) {
    if (!canManage) return;
    const ok = await confirm({
      title: t("workers.deleteWorkerTitle"),
      body: t("workers.deleteWorkerSoft").replace("{name}", w.name),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/workers/${w.id}`, { method: "DELETE" });
      toast.push(t("workers.removed"), "ok");
      if (selectedId === w.id) setSelectedId(null);
      await loadWorkers();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("workers.saveFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  function openEntry(mode: EntryMode, line?: LedgerLine) {
    if (line) {
      setEditLine(line);
      setEntryMode(
        line.kind === "SALARY_CREDIT" || line.kind === "ADVANCE" || line.kind === "OTHER_DEBIT"
          ? line.kind
          : "OTHER_DEBIT"
      );
      setEDate(line.entryOn);
      setEAmount(String(line.debit || line.credit || ""));
      setEDetail(line.note || line.detail || "");
    } else {
      setEditLine(null);
      setEntryMode(mode);
      setEDate(isoDay());
      setEAmount(selectedWorker?.rate ? String(selectedWorker.rate) : "");
      if (mode === "SALARY_CREDIT") setEDetail(t("workers.detailSalary"));
      else if (mode === "SALARY_CASH") setEDetail(t("workers.detailSalaryCash"));
      else if (mode === "ADVANCE") setEDetail(t("workers.detailCash"));
      else setEDetail("");
    }
  }

  function entryTitle() {
    if (editLine) return t("workers.editEntry");
    if (entryMode === "SALARY_CREDIT") return t("workers.addSalary");
    if (entryMode === "SALARY_CASH") return t("workers.addSalaryCash");
    if (entryMode === "ADVANCE") return t("workers.addCash");
    if (entryMode === "OTHER_DEBIT") return t("workers.addOther");
    return "";
  }

  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (!canEditShift || !selectedId || !entryMode) return;
    const amount = Number(eAmount);
    if (!(amount > 0)) {
      toast.push(t("workers.badAmount"), "err");
      return;
    }
    setBusy(true);
    try {
      if (editLine) {
        setLedger(
          await api<LedgerResult>(`/workers/ledger/${editLine.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              entryOn: eDate,
              amount,
              note: eDetail.trim() || undefined,
            }),
          })
        );
      } else {
        setLedger(
          await api<LedgerResult>(`/workers/${selectedId}/ledger`, {
            method: "POST",
            body: JSON.stringify({
              kind: entryMode,
              entryOn: eDate,
              amount,
              note: eDetail.trim() || undefined,
            }),
          })
        );
      }
      toast.push(t("workers.saved"), "ok");
      setEntryMode(null);
      setEditLine(null);
      await loadWorkers();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("workers.saveFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(line: LedgerLine) {
    if (!canManage || !line.editable) return;
    const ok = await confirm({
      title: t("workers.deleteEntry"),
      body: t("workers.deleteEntryConfirm"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      setLedger(await api<LedgerResult>(`/workers/ledger/${line.id}`, { method: "DELETE" }));
      toast.push(t("workers.removed"), "ok");
      await loadWorkers();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("workers.saveFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const selectedWorker = workers.find((w) => w.id === selectedId) ?? null;

  const statusLabel = (status: BalanceStatus) => {
    if (status === "JAMA") return t("workers.jama");
    if (status === "BANAM") return t("workers.banam");
    return "—";
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("workers.title")}</h1>
          <p className="muted">{t("workers.hint")}</p>
        </div>
        {canManage && (
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={openAddWorker} disabled={!shiftOpen}>
              + {t("workers.addWorker")}
            </button>
          </div>
        )}
      </div>
      {!shiftOpen && <p className="muted tiny">{t("hotel.shiftEnded")}</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px, 280px) 1fr",
          gap: "1rem",
          alignItems: "start",
        }}
        className="workers-split"
      >
        <div className="panel panel-pad">
          <SearchField value={q} onChange={setQ} placeholder={t("workers.search")} />
          <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.35rem" }}>
            {filtered.length === 0 && <p className="muted tiny">{t("workers.empty")}</p>}
            {filtered.map((w) => (
              <button
                key={w.id}
                type="button"
                className="btn ghost"
                onClick={() => setSelectedId(w.id)}
                style={{
                  justifyContent: "space-between",
                  textAlign: "start",
                  border: selectedId === w.id ? "1px solid var(--accent)" : undefined,
                  background: selectedId === w.id ? "var(--panel-2, #f5f7fa)" : undefined,
                }}
              >
                <span>
                  <strong>{w.name}</strong>
                  {w.jobTitle ? <span className="tiny muted"> · {w.jobTitle}</span> : null}
                  {!w.active ? <span className="tiny muted"> ({t("workers.inactive")})</span> : null}
                </span>
                <span style={{ color: statusColor(w.status), fontWeight: 600, whiteSpace: "nowrap" }}>
                  {money(Math.abs(w.balance))}{" "}
                  <span className="tiny">{statusLabel(w.status)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel panel-pad">
          {!selectedId || !ledger ? (
            <p className="muted">{t("workers.pickWorkerHint")}</p>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0 }}>{ledger.worker.name}</h2>
                  <p className="tiny muted" style={{ margin: "0.25rem 0 0" }}>
                    {ledger.worker.jobTitle || t("workers.noJob")}
                    {ledger.worker.rate > 0
                      ? ` · ${money(ledger.worker.rate)} / ${
                          ledger.worker.payType === "DAILY"
                            ? t("workers.periodDaily")
                            : t("workers.periodMonthly")
                        }`
                      : ""}
                  </p>
                </div>
                <div style={{ textAlign: "end" }}>
                  <div className="tiny muted">{t("workers.balance")}</div>
                  <strong style={{ fontSize: "1.25rem", color: statusColor(ledger.status) }}>
                    {money(Math.abs(ledger.balance))} {statusLabel(ledger.status)}
                  </strong>
                </div>
              </div>

              {canEditShift && (
                <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", marginTop: "0.85rem" }}>
                  <button type="button" className="btn" onClick={() => openEntry("SALARY_CASH")}>
                    + {t("workers.addSalaryCash")}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => openEntry("SALARY_CREDIT")}>
                    + {t("workers.addSalary")}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => openEntry("ADVANCE")}>
                    + {t("workers.addCash")}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => openEntry("OTHER_DEBIT")}>
                    + {t("workers.addOther")}
                  </button>
                  {selectedWorker && (
                    <>
                      <button type="button" className="btn ghost" onClick={() => openEditWorker(selectedWorker)}>
                        {t("workers.editWorker")}
                      </button>
                      <button type="button" className="btn ghost" onClick={() => void removeWorker(selectedWorker)}>
                        {t("common.remove")}
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="table-wrap" style={{ marginTop: "1rem" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("common.date")}</th>
                      <th>{t("workers.detail")}</th>
                      <th style={{ textAlign: "end" }}>{t("workers.debit")}</th>
                      <th style={{ textAlign: "end" }}>{t("workers.credit")}</th>
                      <th style={{ textAlign: "end" }}>{t("workers.balance")}</th>
                      <th>{t("workers.status")}</th>
                      {canEditShift && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.lines.length === 0 && (
                      <tr>
                        <td colSpan={canEditShift ? 7 : 6} className="muted">
                          {t("workers.noLines")}
                        </td>
                      </tr>
                    )}
                    {ledger.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.entryOn}</td>
                        <td>{line.detail}</td>
                        <td style={{ textAlign: "end" }}>{line.debit ? money(line.debit) : ""}</td>
                        <td style={{ textAlign: "end" }}>{line.credit ? money(line.credit) : ""}</td>
                        <td style={{ textAlign: "end", color: statusColor(line.status) }}>
                          {money(Math.abs(line.balance))}
                        </td>
                        <td style={{ color: statusColor(line.status) }}>{statusLabel(line.status)}</td>
                        {canEditShift && (
                          <td>
                            {line.editable && (
                              <div className="row" style={{ gap: "0.35rem", justifyContent: "flex-end" }}>
                                <button type="button" className="btn ghost tiny-btn" onClick={() => openEntry(null, line)}>
                                  {t("common.edit")}
                                </button>
                                <button
                                  type="button"
                                  className="btn ghost tiny-btn"
                                  onClick={() => void deleteEntry(line)}
                                >
                                  {t("common.remove")}
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={workerOpen}
        onClose={() => {
          setWorkerOpen(false);
          resetWorkerForm();
        }}
        title={editWorker ? t("workers.editWorker") : t("workers.addWorker")}
      >
        <form onSubmit={(e) => void saveWorker(e)}>
          <div className="modal-scroll">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="w-name">{t("workers.worker")}</label>
                <input id="w-name" value={wName} onChange={(e) => setWName(e.target.value)} required autoFocus />
              </div>
              <div className="field">
                <label htmlFor="w-job">{t("workers.job")}</label>
                <input id="w-job" value={wJob} onChange={(e) => setWJob(e.target.value)} placeholder={t("workers.jobPh")} />
              </div>
              <div className="field">
                <label htmlFor="w-phone">{t("workers.phone")}</label>
                <input id="w-phone" value={wPhone} onChange={(e) => setWPhone(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="w-paytype">{t("workers.payType")}</label>
                <select id="w-paytype" value={wPayType} onChange={(e) => setWPayType(e.target.value as PayType)}>
                  <option value="DAILY">{t("workers.periodDaily")}</option>
                  <option value="MONTHLY">{t("workers.periodMonthly")}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="w-rate">{t("workers.dailySalary")}</label>
                <input
                  id="w-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={wRate}
                  onChange={(e) => setWRate(e.target.value)}
                  placeholder={t("workers.ratePh")}
                />
              </div>
              <div className="field">
                <label htmlFor="w-open-side">{t("workers.openingBalance")}</label>
                <select
                  id="w-open-side"
                  value={wOpenSide}
                  onChange={(e) => setWOpenSide(e.target.value as "JAMA" | "BANAM" | "NONE")}
                >
                  <option value="NONE">{t("workers.openingNone")}</option>
                  <option value="JAMA">{t("workers.openingJama")}</option>
                  <option value="BANAM">{t("workers.openingBanam")}</option>
                </select>
              </div>
              {wOpenSide !== "NONE" && (
                <div className="field">
                  <label htmlFor="w-open-amt">{t("workers.openingAmt")}</label>
                  <input
                    id="w-open-amt"
                    type="number"
                    min="0"
                    step="0.01"
                    value={wOpenAmt}
                    onChange={(e) => setWOpenAmt(e.target.value)}
                    placeholder="0"
                  />
                  <span className="tiny muted">{t("workers.openingHint")}</span>
                </div>
              )}
              <div className="field">
                <label htmlFor="w-note">{t("workers.note")}</label>
                <input id="w-note" value={wNote} onChange={(e) => setWNote(e.target.value)} />
              </div>
              {editWorker && (
                <label className="check">
                  <input type="checkbox" checked={wActive} onChange={(e) => setWActive(e.target.checked)} />
                  {t("workers.active")}
                </label>
              )}
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn ghost" onClick={() => setWorkerOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!entryMode}
        onClose={() => {
          setEntryMode(null);
          setEditLine(null);
        }}
        title={entryTitle()}
      >
        <form onSubmit={(e) => void saveEntry(e)}>
          <div className="modal-scroll">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="e-date">{t("common.date")}</label>
                <DateField id="e-date" value={eDate} onChange={setEDate} />
              </div>
              <div className="field">
                <label htmlFor="e-detail">{t("workers.detail")}</label>
                <input
                  id="e-detail"
                  value={eDetail}
                  onChange={(e) => setEDetail(e.target.value)}
                  placeholder={
                    entryMode === "SALARY_CREDIT" || entryMode === "SALARY_CASH"
                      ? t("workers.detailSalaryPh")
                      : entryMode === "ADVANCE"
                        ? t("workers.detailCashPh")
                        : t("workers.detailOtherPh")
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="e-amount">{t("store.amount")}</label>
                <input
                  id="e-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={eAmount}
                  onChange={(e) => setEAmount(e.target.value)}
                  required
                  autoFocus
                />
                <span className="tiny muted">
                  {entryMode === "SALARY_CASH"
                    ? t("workers.salaryCashHint")
                    : entryMode === "SALARY_CREDIT"
                      ? t("workers.salaryCreditHint")
                      : entryMode === "ADVANCE"
                        ? t("workers.cashDebitHint")
                        : t("workers.otherDebitHint")}
                </span>
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setEntryMode(null);
                setEditLine(null);
              }}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <style>{`
        @media (max-width: 800px) {
          .workers-split { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
