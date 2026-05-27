import type { LucideIcon } from "lucide-react";

export type EmptyStateAction = {
  label: string;
  onClick: () => void;
  variant?: "primary" | "outline";
};

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  /** Optional second action shown next to the primary one */
  secondaryAction?: EmptyStateAction;
  /** Subtle variant for inline empties inside small panels */
  size?: "default" | "compact";
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  size = "default",
}: EmptyStateProps) {
  return (
    <div className={`empty-state-shared empty-state-${size}`}>
      <div className="empty-state-shared-icon">
        <Icon size={size === "compact" ? 36 : 48} strokeWidth={1.6} />
      </div>
      <h3 className="empty-state-shared-title">{title}</h3>
      {description && (
        <p className="empty-state-shared-desc">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="empty-state-shared-actions">
          {action && (
            <button
              type="button"
              className={
                action.variant === "outline"
                  ? "empty-state-btn-outline"
                  : "empty-state-btn-primary"
              }
              onClick={action.onClick}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              className={
                secondaryAction.variant === "primary"
                  ? "empty-state-btn-primary"
                  : "empty-state-btn-outline"
              }
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
