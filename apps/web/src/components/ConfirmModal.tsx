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

type ConfirmCtx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const Ctx = createContext<ConfirmCtx | null>(null);

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const close = useCallback((value: boolean) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.resolve(value);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const next = { ...opts, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        open={!!pending}
        title={pending?.title ?? ""}
        onClose={() => close(false)}
        dismissible={false}
        size="sm"
      >
        {pending && (
          <div className="confirm-body">
            <p>{pending.body}</p>
            <div className="form-footer">
              <button type="button" className="btn ghost" onClick={() => close(false)}>
                {pending.cancelLabel ?? t("common.cancel")}
              </button>
              <button
                type="button"
                className={`btn ${pending.danger ? "danger" : ""}`}
                autoFocus
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? t("common.confirm")}
              </button>
            </div>
          </div>
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
