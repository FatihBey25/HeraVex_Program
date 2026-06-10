// Locale-aware formatters that read from the General settings slice.
//
// The Settings page persists a preferred date format, time format,
// number format, currency position and week start; the helpers
// below are the consumption side. Call these instead of
// `Date.toLocaleDateString()` / hand-rolled string templating so
// every dashboard / calendar / task surface reflects the user's
// preference live.
//
// We deliberately don't accept the whole slice as an argument —
// callers grab it from `useAppStore` at the call site so React's
// dependency tracking still works. The pure functions below take
// the values they actually need.

import type { DateFormat, NumberFormat, TimeFormat, CurrencyPosition } from "./userProfile";

// ── Dates ────────────────────────────────────────────────────────────

/** Format a Date (or ISO/parseable string) using the user's chosen
 *  date format. Empty input returns "". */
export function formatDate(input: Date | string | null | undefined, fmt: DateFormat): string {
  if (!input) return "";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  switch (fmt) {
    case "dd.mm.yyyy": return `${dd}.${mm}.${yyyy}`;
    case "mm/dd/yyyy": return `${mm}/${dd}/${yyyy}`;
    case "yyyy-mm-dd": return `${yyyy}-${mm}-${dd}`;
  }
}

export function formatTime(input: Date | string, fmt: TimeFormat): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (fmt === "24h") return `${String(hh).padStart(2, "0")}:${mm}`;
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${mm} ${ampm}`;
}

export function formatDateTime(input: Date | string, dateFmt: DateFormat, timeFmt: TimeFormat): string {
  return `${formatDate(input, dateFmt)} · ${formatTime(input, timeFmt)}`;
}

// ── Numbers ──────────────────────────────────────────────────────────

/** Format a number using one of three thousands+decimal conventions.
 *  Decimal places preserved as-is; callers control precision. */
export function formatNumber(n: number, fmt: NumberFormat, decimals = 2): string {
  if (!Number.isFinite(n)) return "—";
  const fixed = n.toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "§");
  switch (fmt) {
    case "comma":  return grouped.split("§").join(".") + (decPart ? `,${decPart}` : "");
    case "period": return grouped.split("§").join(",") + (decPart ? `.${decPart}` : "");
    case "space":  return grouped.split("§").join(" ") + (decPart ? `,${decPart}` : "");
  }
}

export function formatCurrency(
  amount: number,
  currency: string,
  fmt: NumberFormat,
  position: CurrencyPosition,
  decimals = 2,
): string {
  const num = formatNumber(amount, fmt, decimals);
  return position === "before" ? `${currency} ${num}` : `${num} ${currency}`;
}
