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

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [open]);

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
            <button type="button" className="modal-close" onClick={onClose} aria-label={t("common.close")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
