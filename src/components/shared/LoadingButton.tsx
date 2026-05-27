import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "outline" | "danger" | "gradient";

export type LoadingButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  /** Async or sync click handler — while the returned promise is pending the
   *  button shows a spinner + loadingLabel and is disabled. */
  onClick?: () => void | Promise<unknown>;
  /** Replacement label shown while pending. Defaults to the children. */
  loadingLabel?: ReactNode;
  /** Visual style. Defaults to "primary". */
  variant?: Variant;
  /** Manually force loading (useful when state lives outside the button). */
  loading?: boolean;
  /** Optional leading icon shown in the idle state. */
  leadingIcon?: ReactNode;
  children?: ReactNode;
};

const VARIANT_CLASS: Record<Variant, string> = {
  primary:   "primary-button",
  secondary: "secondary-button",
  outline:   "secondary-button",
  danger:    "primary-button danger-button",
  gradient:  "primary-button btn-gradient",
};

export function LoadingButton({
  onClick,
  loadingLabel,
  variant = "primary",
  loading: forcedLoading,
  leadingIcon,
  children,
  disabled,
  className,
  type = "button",
  ...rest
}: LoadingButtonProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const isLoading = forcedLoading ?? internalLoading;

  const handleClick = async () => {
    if (!onClick || isLoading) return;
    try {
      const result = onClick();
      if (result && typeof (result as Promise<unknown>).then === "function") {
        setInternalLoading(true);
        await result;
      }
    } finally {
      setInternalLoading(false);
    }
  };

  const finalDisabled = disabled || isLoading;
  const classes = [VARIANT_CLASS[variant], "loading-btn", className].filter(Boolean).join(" ");

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={finalDisabled}
      onClick={() => void handleClick()}
      aria-busy={isLoading || undefined}
    >
      {isLoading ? (
        <>
          <Loader2 size={14} className="loading-btn-spinner" />
          <span>{loadingLabel ?? children}</span>
        </>
      ) : (
        <>
          {leadingIcon}
          {children}
        </>
      )}
    </button>
  );
}
