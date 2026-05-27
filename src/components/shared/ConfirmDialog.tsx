import { useEffect, useRef } from "react";
import { AlertTriangle, AlertCircle, Info as InfoIcon } from "lucide-react";

export type ConfirmVariant = "danger" | "warning" | "info";

interface Props {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Variant drives the icon, accent color and confirm button styling. */
  variant?: ConfirmVariant;
  /** Backwards-compatible shortcut: `danger` implies `variant="danger"`. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_META: Record<ConfirmVariant, { icon: typeof AlertTriangle; class: string }> = {
  danger:  { icon: AlertTriangle, class: "confirm-dialog-danger" },
  warning: { icon: AlertCircle,   class: "confirm-dialog-warning" },
  info:    { icon: InfoIcon,      class: "confirm-dialog-info" },
};

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant,
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const resolvedVariant: ConfirmVariant = variant ?? (danger ? "danger" : "info");
  const meta = VARIANT_META[resolvedVariant];
  const Icon = meta.icon;
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Esc closes the dialog; auto-focus the confirm button for keyboard flow.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter") {
        // Enter triggers confirm only when focus is inside the dialog
        if (document.activeElement === confirmRef.current) return;
        // Otherwise let it pass; intentional no-op here keeps form fields safe
      }
    };
    window.addEventListener("keydown", onKey);
    // Focus the cancel-side first for danger flows so Enter doesn't auto-destroy
    if (resolvedVariant !== "danger") {
      confirmRef.current?.focus();
    }
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, resolvedVariant]);

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="presentation"
    >
      <div
        className={`modal-box confirm-dialog ${meta.class}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={body ? "confirm-dialog-body" : undefined}
      >
        <div className="confirm-dialog-head">
          <div className="confirm-dialog-icon" aria-hidden="true">
            <Icon size={22} strokeWidth={2} />
          </div>
          <div className="confirm-dialog-text">
            <h3 id="confirm-dialog-title" className="confirm-dialog-title">{title}</h3>
            {body && (
              <p id="confirm-dialog-body" className="confirm-dialog-body">{body}</p>
            )}
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="secondary-button confirm-cancel-btn"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`primary-button confirm-confirm-btn confirm-confirm-${resolvedVariant}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
