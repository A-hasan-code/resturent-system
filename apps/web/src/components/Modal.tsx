import type { ReactNode } from "react";
import { useEffect } from "react";
import { useT } from "../i18n";

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
  size,
  dismissible = true,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** sm = confirm dialogs, md = default, lg = wide forms */
  size?: "sm" | "md" | "lg";
  /** Backdrop click / Escape close. Off for destructive confirms. */
  dismissible?: boolean;
}) {
  const t = useT();
  const widthClass = size === "sm" ? "modal-sm" : size === "lg" || wide ? "modal-wide" : "";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissible, onClose]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (dismissible) onClose();
      }}
      role="presentation"
    >
      <div
        className={`modal ${widthClass}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          {dismissible && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
              ×
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
