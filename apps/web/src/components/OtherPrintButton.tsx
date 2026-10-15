import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../toast";

type OtherPrinter = { id: string; name: string; target: string; station: string };

type Props = {
  /** POST path that accepts `{ printerId? }` and regenerates the PDF server-side. */
  path: string;
  disabled?: boolean;
  className?: string;
  label?: string;
};

export function OtherPrintButton({ path, disabled, className, label }: Props) {
  const t = useT();
  const toast = useToast();
  const [printers, setPrinters] = useState<OtherPrinter[]>([]);
  const [printerId, setPrinterId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api<OtherPrinter[]>("/printers/other");
      setPrinters(rows);
      setPrinterId((prev) => (prev && rows.some((p) => p.id === prev) ? prev : rows[0]?.id || ""));
    } catch {
      setPrinters([]);
      setPrinterId("");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function print() {
    if (!printers.length) {
      toast.push(t("common.noOtherPrinter"), "err");
      return;
    }
    setBusy(true);
    try {
      await api(path, {
        method: "POST",
        body: JSON.stringify(printerId ? { printerId } : {}),
      });
      toast.push(t("common.printedOk"), "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : t("common.printFailed"), "err");
    } finally {
      setBusy(false);
    }
  }

  const none = !printers.length;

  return (
    <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
      {printers.length > 1 && (
        <select
          className="sm"
          value={printerId}
          onChange={(e) => setPrinterId(e.target.value)}
          disabled={disabled || busy}
          aria-label={t("settings.otherPrint")}
        >
          {printers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className={className || "btn ghost sm"}
        disabled={disabled || busy || none}
        title={none ? t("common.noOtherPrinter") : undefined}
        onClick={() => void print()}
      >
        {busy ? t("common.loading") : label || t("common.printOnOther")}
      </button>
    </div>
  );
}
