import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "./Modal";
import { useT } from "../i18n";

export type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export type PromptOptions = ConfirmOptions & {
  inputLabel: string;
  inputPlaceholder?: string;
  inputRequired?: boolean;
  inputMaxLength?: number;
};

type ConfirmCtx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
};

const Ctx = createContext<ConfirmCtx | null>(null);

type PendingConfirm = ConfirmOptions & {
  kind: "confirm";
  resolve: (v: boolean) => void;
};

type PendingPrompt = PromptOptions & {
  kind: "prompt";
  resolve: (v: string | null) => void;
};

type Pending = PendingConfirm | PendingPrompt;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState("");
  const pendingRef = useRef<Pending | null>(null);

  const closeConfirm = useCallback((value: boolean) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setInput("");
    if (p?.kind === "confirm") p.resolve(value);
    else if (p?.kind === "prompt") p.resolve(null);
  }, []);

  const closePrompt = useCallback((value: string | null) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setInput("");
    if (p?.kind === "prompt") p.resolve(value);
    else if (p?.kind === "confirm") p.resolve(false);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const next: PendingConfirm = { ...opts, kind: "confirm", resolve };
      pendingRef.current = next;
      setInput("");
      setPending(next);
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      const next: PendingPrompt = { ...opts, kind: "prompt", resolve };
      pendingRef.current = next;
      setInput("");
      setPending(next);
    });
  }, []);

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  const isPrompt = pending?.kind === "prompt";
  const trimmed = input.trim();
  const canSubmit =
    !isPrompt ||
    !pending.inputRequired ||
    (trimmed.length > 0 && trimmed.length <= (pending.inputMaxLength ?? 200));

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        open={!!pending}
        title={pending?.title ?? ""}
        onClose={() => (isPrompt ? closePrompt(null) : closeConfirm(false))}
        dismissible={false}
        size="sm"
      >
        {pending && (
          <>
            <div className="modal-scroll confirm-body">
              <p>{pending.body}</p>
              {pending.kind === "prompt" && (
                <label className="field" style={{ marginTop: "0.75rem", display: "block" }}>
                  <span>{pending.inputLabel}</span>
                  <textarea
                    value={input}
                    autoFocus
                    rows={3}
                    maxLength={pending.inputMaxLength ?? 200}
                    placeholder={pending.inputPlaceholder}
                    onChange={(e) => setInput(e.target.value)}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                </label>
              )}
            </div>
            <div className="form-footer">
              <button
                type="button"
                className="btn ghost"
                onClick={() => (isPrompt ? closePrompt(null) : closeConfirm(false))}
              >
                {pending.cancelLabel ?? t("common.cancel")}
              </button>
              <button
                type="button"
                className={`btn ${pending.danger ? "danger" : ""}`}
                autoFocus={!isPrompt}
                disabled={!canSubmit}
                onClick={() => {
                  if (pending.kind === "prompt") closePrompt(trimmed);
                  else closeConfirm(true);
                }}
              >
                {pending.confirmLabel ?? t("common.confirm")}
              </button>
            </div>
          </>
        )}
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const v = useContext(Ctx);
  if (!v) throw new Error("ConfirmProvider missing");
  return v.confirm;
}

export function usePrompt() {
  const v = useContext(Ctx);
  if (!v) throw new Error("ConfirmProvider missing");
  return v.prompt;
}
