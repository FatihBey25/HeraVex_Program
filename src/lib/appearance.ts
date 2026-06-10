// Live-preview foundation for the v0.9 deep Settings.
//
// Appearance / Typography / Layout each map to a slice of state that
// lives in the Zustand store; whenever a slice mutates, we mirror it
// to CSS custom properties on `documentElement` so the whole app
// reacts instantly — no reload, no remount. The rule of thumb is
// "every visible knob has a `--var` here, and every meaningful
// surface in styles.css consumes it."
//
// Persistence is localStorage-only in M2. Migrating settings.json to
// schema v2 (the prompt's section 9) is a separate, larger move and
// lands in a future polish milestone. localStorage keeps the data
// per-machine, which matches how the user already experiences these
// (tied to one install, not the workspace).
//
// Defaults follow spec section 8 ("KRİTİK: Makul Varsayılanlar"):
// the user should never have to touch a knob for the app to feel
// great. Numbers were chosen against the current dark theme so the
// defaults reproduce today's visual identity.

import type { AppLanguage } from "./i18n";

// ── Appearance ───────────────────────────────────────────────────────

export type ThemeMode = "system" | "dark" | "light";

export interface StatusColors {
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface AppearanceSlice {
  theme: ThemeMode;
  /** Accent hex including the leading `#`. */
  accentColor: string;
  /** Where the accent colour is applied across the UI. M2 wires
   *  three of the five spec'd targets (sidebar, buttons, links).
   *  Progress + charts will fall in when those modules land. */
  accentTargets: {
    sidebar: boolean;
    buttons: boolean;
    links: boolean;
    progress: boolean;
    charts: boolean;
  };
  statusColors: StatusColors;
  /** "standard" matches today's shipped backdrop with the soft
   *  gradient orbs; "pureBlack" kills the gradient entirely;
   *  "gradient" leaves the gradient but boosts saturation.
   *  The named-theme presets (midnight/ocean/etc.) ship as
   *  curated colour fields. */
  bgMain:
    | "standard" | "pureBlack" | "gradient"
    | "midnight" | "ocean" | "plum" | "forest" | "slate" | "sunset";
  /** Sidebar surface tint. */
  bgSidebar:
    | "dark" | "darker" | "transparent"
    | "midnight" | "ocean" | "plum" | "forest" | "slate" | "sunset";
  /** Whether the moving backdrop orbs render at all. */
  bgAnimation: boolean;
}

export const DEFAULT_APPEARANCE: AppearanceSlice = {
  theme: "system",
  accentColor: "#a78bfa",
  accentTargets: { sidebar: true, buttons: true, links: true, progress: true, charts: true },
  statusColors: {
    success: "#34d399",
    warning: "#f59e0b",
    danger:  "#f87171",
    info:    "#4f8cff",
  },
  bgMain: "standard",
  bgSidebar: "dark",
  bgAnimation: true,
};

/** The eight preset accent swatches shown above the custom HEX field. */
export const ACCENT_PRESETS: { id: string; value: string; labelKey: AppearanceLabelKey }[] = [
  { id: "violet", value: "#a78bfa", labelKey: "themeAccentViolet" },
  { id: "blue",   value: "#4f8cff", labelKey: "themeAccentBlue" },
  { id: "green",  value: "#34d399", labelKey: "themeAccentGreen" },
  { id: "amber",  value: "#f59e0b", labelKey: "themeAccentAmber" },
  { id: "rose",   value: "#f87171", labelKey: "themeAccentRose" },
  { id: "pink",   value: "#ec4899", labelKey: "themeAccentPink" },
  { id: "orange", value: "#fb923c", labelKey: "themeAccentOrange" },
  { id: "cyan",   value: "#22d3ee", labelKey: "themeAccentCyan" },
];

// Discriminated label key type — keeps the swatch label lookups
// type-safe without bloating the public LabelKey union.
type AppearanceLabelKey =
  | "themeAccentViolet" | "themeAccentBlue"   | "themeAccentGreen" | "themeAccentAmber"
  | "themeAccentRose"   | "themeAccentPink"   | "themeAccentOrange" | "themeAccentCyan";

// ── Typography ───────────────────────────────────────────────────────

/** Each font family is a CSS stack, not a single name. We deliberately
 *  avoid web-font loading in M2 (CSP would block external fonts and a
 *  workspace-shipped font pack is a future-milestone discussion) —
 *  every option resolves to system or near-system stacks. */
export type AppFontId   = "system" | "sans" | "rounded" | "humanist";
export type EditorFontId = "system" | "mono" | "serif";

export interface TypographySlice {
  appFont: AppFontId;
  editorFont: EditorFontId;
  tabularNumbers: boolean;
  /** Base font size in px — the body inherits this. */
  baseSize: number;        // 12..16
  editorSize: number;      // 13..20
  /** Heading scale multiplier on top of base size. */
  headingScale: "compact" | "standard" | "wide";
  lineHeight: number;      // 1.4..1.8
  antialiasing: boolean;
  boldWeight: 500 | 600 | 700;
  letterSpacing: "tight" | "normal" | "wide";
}

export const DEFAULT_TYPOGRAPHY: TypographySlice = {
  appFont: "system",
  editorFont: "mono",
  tabularNumbers: false,
  baseSize: 14,
  editorSize: 13.5,
  headingScale: "standard",
  lineHeight: 1.55,
  antialiasing: true,
  boldWeight: 600,
  letterSpacing: "normal",
};

/** Maps `AppFontId` to an actual CSS font-family stack. Pure CSS. */
const APP_FONT_STACK: Record<AppFontId, string> = {
  system:   '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  sans:     '"Inter", "Helvetica Neue", "Segoe UI", system-ui, sans-serif',
  rounded:  '"SF Pro Rounded", "Nunito", system-ui, sans-serif',
  humanist: '"Verdana", "Lucida Grande", Geneva, sans-serif',
};

const EDITOR_FONT_STACK: Record<EditorFontId, string> = {
  system: 'inherit',
  mono:   '"JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',
  serif:  '"Charter", "Georgia", "Cambria", "Times New Roman", serif',
};

const HEADING_SCALE_VALUE: Record<TypographySlice["headingScale"], string> = {
  compact: "0.95", standard: "1", wide: "1.08",
};
const LETTER_SPACING_VALUE: Record<TypographySlice["letterSpacing"], string> = {
  tight: "-0.01em", normal: "0", wide: "0.02em",
};

// ── Layout & Density ─────────────────────────────────────────────────

export type DensityMode = "compact" | "standard" | "relaxed";
export type AnimationSpeed = "fast" | "standard" | "slow" | "instant";

export interface LayoutSlice {
  density: DensityMode;
  sidebarWidth: number;       // 200..320 px (200/240/280 are the spec presets)
  sidebarShowGroupHeaders: boolean;
  /** Reserved for future Linear-style collapse-on-mouseleave behaviour. */
  sidebarCollapseOnHover: boolean;
  taskRowDensity: DensityMode;
  noteRowDensity: DensityMode;
  storeCardSize: "small" | "medium" | "large";
  dashboardCardHeight: "short" | "standard" | "tall";
  animationSpeed: AnimationSpeed;
  pageTransitions: boolean;
  modalAnimations: boolean;
  listItemAnimations: boolean;
  cornerRadius: "square" | "subtle" | "standard" | "soft";
  borderWeight: "none" | "thin" | "standard" | "thick";
  hoverEffects: boolean;
  focusRing: boolean;

  /** Visibility of the three Dashboard widgets. Defaults all-on; users
   *  can hide ones they don't use (e.g. "tasks" panel for a soloDev
   *  who tracks only via Notes). */
  dashboardWidgets: {
    overview: boolean;
    projects: boolean;
    tasks: boolean;
  };

  /** When true, page panels (.panel, .kcard, .task-card, …) lose their
   *  card chrome — background, border, blur — and the page backdrop
   *  shows through. Useful when paired with a vivid bg theme so the
   *  content reads as floating type/icons rather than card stacks. */
  transparentPanels: boolean;

  /** Show the framer-motion sliding pill behind the active sidebar
   *  item. When false the active state is a plain background swap. */
  sidebarSlideIndicator: boolean;
}

export const DEFAULT_LAYOUT: LayoutSlice = {
  density: "standard",
  sidebarWidth: 300,
  sidebarShowGroupHeaders: true,
  sidebarCollapseOnHover: false,
  taskRowDensity: "standard",
  noteRowDensity: "standard",
  storeCardSize: "medium",
  dashboardCardHeight: "standard",
  animationSpeed: "standard",
  pageTransitions: true,
  modalAnimations: true,
  listItemAnimations: true,
  cornerRadius: "standard",
  borderWeight: "standard",
  hoverEffects: true,
  focusRing: true,
  dashboardWidgets: { overview: true, projects: true, tasks: true },
  transparentPanels: false,
  sidebarSlideIndicator: true,
};

const DENSITY_SCALE: Record<DensityMode, number> = {
  compact: 0.82, standard: 1, relaxed: 1.18,
};
const ANIMATION_DURATION: Record<AnimationSpeed, string> = {
  instant: "0s", fast: "0.10s", standard: "0.18s", slow: "0.30s",
};
const CORNER_RADIUS: Record<LayoutSlice["cornerRadius"], string> = {
  square: "2px", subtle: "6px", standard: "10px", soft: "14px",
};
const BORDER_WEIGHT: Record<LayoutSlice["borderWeight"], string> = {
  none: "0px", thin: "0.5px", standard: "1px", thick: "1.5px",
};

// ── Apply to DOM ─────────────────────────────────────────────────────

/** Mirrors every slice to CSS custom properties on the root element.
 *  Called from a single `useEffect` in App.tsx that watches all three
 *  slices. The function is intentionally synchronous and idempotent
 *  so it stays safe to call on every change without batching. */
export function applyAppearanceToDom(
  appearance: AppearanceSlice,
  typography: TypographySlice,
  layout: LayoutSlice,
) {
  const root = document.documentElement;

  // ── Appearance
  const accent = appearance.accentColor;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-soft", hexWithAlpha(accent, 0.18));
  root.style.setProperty("--accent-softer", hexWithAlpha(accent, 0.10));
  root.style.setProperty("--accent-faint", hexWithAlpha(accent, 0.04));
  root.style.setProperty("--accent-strong", hexWithAlpha(accent, 0.55));

  root.style.setProperty("--status-success", appearance.statusColors.success);
  root.style.setProperty("--status-warning", appearance.statusColors.warning);
  root.style.setProperty("--status-danger",  appearance.statusColors.danger);
  root.style.setProperty("--status-info",    appearance.statusColors.info);

  // Theme mode — light theme is intentionally a no-op in M2; we set
  // the class hook so future CSS can branch on it.
  root.classList.remove("theme-mode-system", "theme-mode-dark", "theme-mode-light");
  root.classList.add(`theme-mode-${appearance.theme}`);

  // Accent target classes — each one is opt-out: when present on
  // :root, the matching surface drops back to the legacy palette.
  // The CSS overrides in styles.css branch on these.
  root.classList.toggle("accent-skip-sidebar",  !appearance.accentTargets.sidebar);
  root.classList.toggle("accent-skip-buttons",  !appearance.accentTargets.buttons);
  root.classList.toggle("accent-skip-links",    !appearance.accentTargets.links);
  root.classList.toggle("accent-skip-progress", !appearance.accentTargets.progress);
  root.classList.toggle("accent-skip-charts",   !appearance.accentTargets.charts);

  // Background style — only the toggle for the moving orbs is wired
  // in M2 (the rest of the styling falls through CSS classes).
  root.classList.toggle("bg-animation-off", !appearance.bgAnimation);
  // Remove any prior bg-main-* / bg-sidebar-* class so toggling is clean
  // across the expanded preset list.
  for (const cls of Array.from(root.classList)) {
    if (cls.startsWith("bg-main-") || cls.startsWith("bg-sidebar-")) {
      root.classList.remove(cls);
    }
  }
  root.classList.add(`bg-main-${appearance.bgMain}`);
  root.classList.add(`bg-sidebar-${appearance.bgSidebar}`);

  // ── Typography
  root.style.setProperty("--font-app", APP_FONT_STACK[typography.appFont]);
  root.style.setProperty(
    "--font-editor",
    typography.editorFont === "system" ? APP_FONT_STACK[typography.appFont] : EDITOR_FONT_STACK[typography.editorFont],
  );
  root.style.setProperty("--font-size-base", `${typography.baseSize}px`);
  root.style.setProperty("--font-size-editor", `${typography.editorSize}px`);
  root.style.setProperty("--line-height", String(typography.lineHeight));
  root.style.setProperty("--heading-scale", HEADING_SCALE_VALUE[typography.headingScale]);
  root.style.setProperty("--bold-weight", String(typography.boldWeight));
  root.style.setProperty("--letter-spacing", LETTER_SPACING_VALUE[typography.letterSpacing]);
  root.classList.toggle("antialiased", typography.antialiasing);
  root.classList.toggle("tabular-numbers", typography.tabularNumbers);

  // ── Layout
  root.style.setProperty("--density-scale", String(DENSITY_SCALE[layout.density]));
  root.style.setProperty("--sidebar-width", `${layout.sidebarWidth}px`);
  root.style.setProperty("--anim-duration", ANIMATION_DURATION[layout.animationSpeed]);
  root.style.setProperty("--radius-md", CORNER_RADIUS[layout.cornerRadius]);
  root.style.setProperty("--border-weight", BORDER_WEIGHT[layout.borderWeight]);

  root.classList.toggle("hover-effects-off", !layout.hoverEffects);
  root.classList.toggle("focus-ring-off", !layout.focusRing);
  root.classList.toggle("page-transitions-off", !layout.pageTransitions);
  root.classList.toggle("modal-animations-off", !layout.modalAnimations);
  root.classList.toggle("list-animations-off", !layout.listItemAnimations);
  root.classList.toggle("sidebar-group-headers-off", !layout.sidebarShowGroupHeaders);
  root.classList.toggle("transparent-panels", layout.transparentPanels);
  // Hard-enforce the chosen animation speed on every transitioning
  // element. The `anim-speed-managed` class triggers a global
  // duration override in styles.css; `anim-instant` adds a kill-switch
  // for transitions+animations together so framer-motion's inline
  // styles also flatten.
  root.classList.add("anim-speed-managed");
  root.classList.toggle("anim-instant", layout.animationSpeed === "instant");

  // v0.9 polish — list-row density swaps on body class so the
  // global styles.css rules can intercept (e.g. .task-row-compact).
  const swapClass = (prefix: string, value: string) => {
    for (const cls of Array.from(root.classList)) {
      if (cls.startsWith(prefix)) root.classList.remove(cls);
    }
    root.classList.add(`${prefix}${value}`);
  };
  swapClass("task-row-",   layout.taskRowDensity);   // compact/standard/relaxed
  swapClass("note-row-",   layout.noteRowDensity);
  swapClass("store-card-", layout.storeCardSize);    // small/medium/large
  swapClass("dash-card-",  layout.dashboardCardHeight); // short/standard/tall
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Apply a 0-1 alpha to a hex colour by appending a 2-digit alpha
 *  channel. Cheap and avoids parsing — exact 3-char hex inputs are
 *  upgraded to 6-char first. */
function hexWithAlpha(hex: string, alpha: number): string {
  let value = hex.replace("#", "").trim();
  if (value.length === 3) {
    value = value.split("").map((c) => c + c).join("");
  }
  if (value.length !== 6) return hex; // give up — caller passed something weird
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${value}${a}`;
}

// ── localStorage persistence ─────────────────────────────────────────

const KEY_APPEARANCE = "heravex_appearance_v1";
const KEY_TYPOGRAPHY = "heravex_typography_v1";
const KEY_LAYOUT     = "heravex_layout_v1";

export function loadAppearance(): AppearanceSlice {
  return safeRead(KEY_APPEARANCE, DEFAULT_APPEARANCE);
}
export function loadTypography(): TypographySlice {
  return safeRead(KEY_TYPOGRAPHY, DEFAULT_TYPOGRAPHY);
}
export function loadLayout(): LayoutSlice {
  return safeRead(KEY_LAYOUT, DEFAULT_LAYOUT);
}
export function saveAppearance(s: AppearanceSlice) { safeWrite(KEY_APPEARANCE, s); }
export function saveTypography(s: TypographySlice) { safeWrite(KEY_TYPOGRAPHY, s); }
export function saveLayout(s: LayoutSlice)         { safeWrite(KEY_LAYOUT, s); }

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    // Shallow-merge so newly-added fields use their defaults instead
    // of leaving the value `undefined` after a user upgrades.
    return { ...fallback, ...parsed } as T;
  } catch {
    return fallback;
  }
}
function safeWrite<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / SSR */ }
}

// AppLanguage import kept for the label-key type guard that consumers
// will eventually do; harmless if unused at module level.
export type _AppLanguageMarker = AppLanguage;
