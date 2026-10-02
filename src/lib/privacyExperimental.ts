// Privacy & Experimental — slices + the helpers that make every
// toggle actually do something.
//
// HONESTY POLICY: every preference here has either:
//   (a) a runtime helper that reads it and changes behaviour, or
//   (b) an explicit "v1.0" badge in the UI rendering and a comment
//       below explaining why.
// We don't ship dead toggles.

// ── Privacy & Security ──────────────────────────────────────────────

export type AutoLockTimeout = "off" | "5m" | "15m" | "30m" | "1h";
export type ClipboardClearSeconds = 15 | 30 | 60 | 120;

export interface PrivacySlice {
  /** Master telemetry switch. Read by `shouldSendTelemetry`. The
   *  pipeline doesn't exist yet, so today this only prevents future
   *  calls from being made; the toggle is the contract. */
  anonymousTelemetry: boolean;
  /** Crash report opt-in. Same scope as telemetry. */
  crashReports: boolean;

  /** Drives PasswordInput's default reveal state. When true (the
   *  default) secrets ship masked. */
  maskValuesInUi: boolean;
  /** Clipboard auto-clear timer. 0 means disabled. */
  clearClipboardAfterCopy: boolean;
  clearClipboardSeconds: ClipboardClearSeconds;

  /** Idle-lock — overlays the app after this many minutes without
   *  any mouse/keyboard activity. "off" disables. */
  autoLock: AutoLockTimeout;

  /** Press kit generator strips the studio email when true.
   *  Reserved for when the generator adds email surfacing. */
  hideEmailInPressKits: boolean;
  /** Backup export redacts API key fields when true. Read by
   *  `handleExportBackup` indirectly via `sanitizeForExport`. */
  redactKeysOnExport: boolean;
  /** Toggles a CSS class on `<html>` that blurs sensitive inputs
   *  (PasswordInput, API key rows). Live preview. */
  screenshotMode: boolean;
}

export const DEFAULT_PRIVACY: PrivacySlice = {
  anonymousTelemetry: false,
  crashReports: false,

  maskValuesInUi: true,
  clearClipboardAfterCopy: false,
  clearClipboardSeconds: 30,

  autoLock: "off",

  hideEmailInPressKits: false,
  redactKeysOnExport: true,
  screenshotMode: false,
};

// ── Experimental ─────────────────────────────────────────────────────

export type ReleaseChannel = "stable" | "beta" | "nightly";

/** Settings → Experimental → Custom dashboard widgets. */
export interface CustomWidget {
  id: string;
  type: "note" | "countdown" | "links";
  title: string;
  /** note: the text; links: `Label | https://url` per line. */
  text?: string;
  /** countdown: YYYY-MM-DD. */
  date?: string;
}

export interface ExperimentalSlice {
  /** Master switch: beta features only run while this is on. */
  betaEnabled: boolean;
  /** Beta: the user's own Dashboard panels. */
  betaCustomWidgets: boolean;
  customWidgets: CustomWidget[];
  channel: ReleaseChannel;
  /** Master gate for the developer rows. When false the actions in
   *  the Developer group are hidden from the Settings page UI. */
  developerMode: boolean;
  /** Console-wraps `invoke` calls so the user can audit Tauri IPC
   *  in their browser devtools. Off by default. */
  logApiCalls: boolean;
  /** Tiny perf chip in the corner: FPS + JS heap. */
  performanceMonitor: boolean;
}

export const DEFAULT_EXPERIMENTAL: ExperimentalSlice = {
  betaEnabled: false,
  betaCustomWidgets: false,
  customWidgets: [],
  channel: "stable",
  developerMode: false,
  logApiCalls: false,
  performanceMonitor: false,
};

// ── localStorage ─────────────────────────────────────────────────────

const KEY_PRIVACY      = "heravex_privacy_v1";
const KEY_EXPERIMENTAL = "heravex_experimental_v1";

export function loadPrivacy(): PrivacySlice {
  return safeRead(KEY_PRIVACY, DEFAULT_PRIVACY);
}
export function loadExperimental(): ExperimentalSlice {
  return safeRead(KEY_EXPERIMENTAL, DEFAULT_EXPERIMENTAL);
}
export function savePrivacy(s: PrivacySlice)             { safeWrite(KEY_PRIVACY, s); }
export function saveExperimental(s: ExperimentalSlice)   { safeWrite(KEY_EXPERIMENTAL, s); }

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...fallback, ...parsed } as T;
  } catch {
    return fallback;
  }
}
function safeWrite<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ── Behaviour helpers ────────────────────────────────────────────────

/** Single source of truth for whether any telemetry call should fire.
 *  Read at call sites (currently zero — no telemetry exists yet). */
export function shouldSendTelemetry(): boolean {
  return loadPrivacy().anonymousTelemetry;
}
export function shouldSendCrashReports(): boolean {
  return loadPrivacy().crashReports;
}

/** Copy text and, when enabled, schedule a clipboard wipe after the
 *  configured delay. The wipe uses `clipboard.writeText("")` which
 *  some platforms ignore; it's still the best non-OS path. */
export function safeCopyToClipboard(text: string): void {
  const p = loadPrivacy();
  try { void navigator.clipboard.writeText(text); } catch { return; }
  if (!p.clearClipboardAfterCopy) return;
  const seconds = Number(p.clearClipboardSeconds);
  if (!seconds) return;
  window.setTimeout(() => {
    try { void navigator.clipboard.writeText(""); } catch {}
  }, seconds * 1000);
}

/** Apply screenshot-mode + masking class hooks on `<html>`. Called
 *  from App.tsx whenever the privacy slice changes. */
export function applyPrivacyClasses(p: PrivacySlice): void {
  const root = document.documentElement;
  root.classList.toggle("screenshot-mode", p.screenshotMode);
  root.classList.toggle("mask-values-off", !p.maskValuesInUi);
}

/** Sign out — wipe the user-identifying localStorage keys but leave
 *  the on-disk workspace alone (games/notes are studio data, not
 *  user identity). The app reloads afterward so every component
 *  picks up the empty profile. */
export function signOutAndReload(): void {
  const keysToClear = [
    "heravex_profile_v1",
    "heravex_user_name",
    "heravex_user_role",
    "heravex_studio_v1",
  ];
  for (const k of keysToClear) {
    try { localStorage.removeItem(k); } catch {}
  }
  window.location.reload();
}

/** Idle ms → AutoLockTimeout. Used by the App.tsx hook so the
 *  comparison stays in one place. `off` → never lock. */
export function autoLockMs(value: PrivacySlice["autoLock"]): number {
  switch (value) {
    case "off": return 0;
    case "5m":  return 5 * 60 * 1000;
    case "15m": return 15 * 60 * 1000;
    case "30m": return 30 * 60 * 1000;
    case "1h":  return 60 * 60 * 1000;
  }
}
