// Compact controls shared by every Settings page.
//
// Each control is intentionally small and visually understated — the
// row's text is the protagonist, the control is just the verb. The
// four primitives cover ~95% of needs (toggle, pill group for 2-4
// mutually exclusive options, dropdown for >4, slider for numeric
// ranges); pages with bespoke widgets reach for a custom control
// inline.
//
// All controls are uncontrolled-friendly: they take a value + onChange
// and never store internal state. That keeps the parent settings page
// the single source of truth and makes live-preview wiring trivial.

import React, { useEffect, useState } from "react";
import { ChevronDown, Plus, X, Eye, EyeOff } from "lucide-react";

// ── Toggle ──────────────────────────────────────────────────────────
interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Optional aria-label when the SettingRow's title isn't reliable
   *  (e.g. the control sits without a row, in a custom widget). */
  label?: string;
}

export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`setting-toggle${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="setting-toggle-knob" />
    </button>
  );
}

// ── PillGroup (mutually exclusive 2-4 options) ─────────────────────
interface PillGroupProps<T extends string> {
  value: T;
  options: { id: T; label: React.ReactNode }[];
  onChange: (id: T) => void;
  disabled?: boolean;
}

export function PillGroup<T extends string>({
  value, options, onChange, disabled,
}: PillGroupProps<T>) {
  return (
    <div className="setting-pillgroup" role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={value === opt.id}
          className={`setting-pill${value === opt.id ? " is-active" : ""}`}
          onClick={() => onChange(opt.id)}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Dropdown ────────────────────────────────────────────────────────
interface DropdownProps<T extends string> {
  value: T;
  options: { id: T; label: React.ReactNode }[];
  onChange: (id: T) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function Dropdown<T extends string>({
  value, options, onChange, disabled, placeholder,
}: DropdownProps<T>) {
  return (
    <div className={`setting-dropdown${disabled ? " is-disabled" : ""}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        className="setting-dropdown-select"
      >
        {placeholder && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          // We render the localised label as `text` only; React can't
          // pass arbitrary ReactNode into <option>, so callers must
          // pass strings here. Type the prop tighter if this ever bites.
          <option key={opt.id} value={opt.id}>
            {opt.label as unknown as string}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="setting-dropdown-chevron" />
    </div>
  );
}

// ── SliderRow (numeric, with live value label) ─────────────────────
interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Renders the current value next to the slider — pass a formatter
   *  so unit-bearing values (e.g. "25 min", "1.6×") read naturally. */
  format?: (v: number) => string;
  disabled?: boolean;
}

export function SliderRow({
  value, min, max, step = 1, onChange, format, disabled,
}: SliderProps) {
  const display = format ? format(value) : String(value);
  return (
    <div className="setting-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="setting-slider-input"
      />
      <span className="setting-slider-value">{display}</span>
    </div>
  );
}

// ── Compact button (for action rows like "Open folder") ────────────
interface CompactButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  variant?: "default" | "danger";
}

export function CompactButton({ onClick, children, disabled, variant }: CompactButtonProps) {
  return (
    <button
      type="button"
      className={`setting-compact-btn${variant === "danger" ? " is-danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

// ── TextInput (single line) ─────────────────────────────────────────
interface TextInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "email" | "password" | "url";
  maxLength?: number;
  width?: number; // px — falls back to 200 if omitted
}

export function TextInput({
  value, onChange, placeholder, disabled, type = "text", maxLength, width = 200,
}: TextInputProps) {
  return (
    <input
      type={type}
      className="setting-text-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      spellCheck={false}
      style={{ width }}
    />
  );
}

// ── TextArea (small, two-line) ──────────────────────────────────────
interface TextAreaProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  width?: number;
}

export function TextArea({
  value, onChange, placeholder, maxLength, rows = 2, width = 260,
}: TextAreaProps) {
  return (
    <textarea
      className="setting-text-area"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={rows}
      spellCheck={false}
      style={{ width }}
    />
  );
}

// ── ChipInput (multi-select chips, free text or preset) ────────────
//
// Renders a row of pill-shaped chips plus a tiny "+ add" pill that
// reveals an inline input. Submitting (Enter or blur) adds the chip;
// clicking the ✕ on a chip removes it. Caller supplies presets if it
// wants suggestions — currently rendered as a dropdown on focus.
interface ChipInputProps {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Optional preset suggestions. Shown as a small wrap below the
   *  input when present and not already chosen. */
  presets?: { id: string; label: string }[];
  maxChips?: number;
  disabled?: boolean;
}

export function ChipInput({
  values, onChange, placeholder, presets, maxChips = 8, disabled,
}: ChipInputProps) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const addOne = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (values.includes(v)) return;
    if (values.length >= maxChips) return;
    onChange([...values, v]);
  };

  const removeOne = (v: string) => onChange(values.filter((x) => x !== v));

  return (
    <div className="setting-chips">
      {values.map((v) => (
        <span key={v} className="setting-chip">
          <span>{v}</span>
          <button
            type="button"
            className="setting-chip-remove"
            onClick={() => removeOne(v)}
            disabled={disabled}
            aria-label={`Remove ${v}`}
          >
            <X size={10} strokeWidth={2.4} />
          </button>
        </span>
      ))}

      {values.length < maxChips && !disabled && (
        adding ? (
          <input
            autoFocus
            type="text"
            className="setting-chip-input"
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addOne(draft);
                setDraft("");
              } else if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              if (draft.trim()) addOne(draft);
              setDraft("");
              setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="setting-chip-add"
            onClick={() => setAdding(true)}
          >
            <Plus size={11} strokeWidth={2.4} />
          </button>
        )
      )}

      {/* Inline preset suggestions: clicking adds the chip directly. */}
      {presets && presets.length > 0 && (
        <div className="setting-chip-presets">
          {presets
            .filter((p) => !values.includes(p.id))
            .slice(0, 5)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className="setting-chip-preset"
                onClick={() => addOne(p.id)}
                disabled={disabled}
              >
                + {p.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ── KeyComboButton — click to capture a new keypress ───────────────
//
// Rendering state: idle (shows the current combo) → capturing (shows
// "Press a key…"). Capture ends on the first non-modifier key event
// or on Escape (cancel). Result is passed to `onChange` only if the
// captured combo differs from the current one — that lets the
// component double as a no-op re-bind affordance.
interface KeyComboProps {
  combo: string;
  format: (combo: string) => string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export function KeyComboButton({ combo, format, onChange, disabled }: KeyComboProps) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      // Reuse the shared capture helper so the format matches what
      // useKeyboardShortcuts expects.
      const captured = captureKeyEventInline(e);
      if (!captured) return;
      e.preventDefault();
      if (captured !== combo) onChange(captured);
      setCapturing(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [capturing, combo, onChange]);

  return (
    <button
      type="button"
      className={`setting-key-combo${capturing ? " is-capturing" : ""}`}
      onClick={() => setCapturing(true)}
      disabled={disabled}
    >
      {capturing ? "Press a key…" : format(combo)}
    </button>
  );
}

// ── PasswordInput — masked text with show/hide toggle ───────────────
//
// Sits in the same row slot as TextInput but masks the value by
// default. Used for every secret-y field on the API Keys + Webhooks
// pages (Steam API key, Itch.io key, GitHub PAT). Caller passes the
// raw secret through normally — we never persist or render it
// unmasked unless the user explicitly toggles the eye icon.
interface PasswordInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Visual width; the toggle icon sits to the right of this. */
  width?: number;
}

export function PasswordInput({
  value, onChange, placeholder, disabled, width = 200,
}: PasswordInputProps) {
  // Honour the global privacy preference: when "mask-values-off"
  // class is on <html> (user opted into showing secrets by default),
  // pre-reveal the input on mount. The eye icon still works either
  // way.
  const startRevealed = typeof document !== "undefined"
    && document.documentElement.classList.contains("mask-values-off");
  const [revealed, setRevealed] = useState(startRevealed);
  return (
    <div className="setting-password-wrap" style={{ width: width + 26 }}>
      <input
        type={revealed ? "text" : "password"}
        className="setting-text-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        style={{ width }}
      />
      <button
        type="button"
        className="setting-password-toggle"
        onClick={() => setRevealed((v) => !v)}
        disabled={disabled}
        aria-label={revealed ? "Hide" : "Show"}
        title={revealed ? "Hide" : "Show"}
      >
        {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </div>
  );
}

// Local copy of the capture helper (avoids a circular import chain
// from the page → controls → shortcutConfig if we ever invert it).
function captureKeyEventInline(e: KeyboardEvent): string | null {
  if (e.key === "Control" || e.key === "Meta" || e.key === "Shift" || e.key === "Alt") return null;
  const key = e.key.toLowerCase();
  if (key.length === 0) return null;
  if (["tab", "enter", "escape"].includes(key)) return null;
  return `${e.shiftKey ? "shift+" : ""}${key}`;
}
