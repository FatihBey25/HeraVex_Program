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
  /** Flow Center canvas grid style + tint (Settings → Theme & Colors). */
  flowBg?: "dots" | "lines" | "cross" | "plain";
  flowBgColor?: string;
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
  flowBg: "dots",
  flowBgColor: "auto",
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
  /** v0.9.7+ — when true, `--font-size-base` resolves through a
   *  `clamp()` keyed off the viewport width. The user's `baseSize`
   *  becomes the upper anchor; the lower anchor is ~82% of it. Pairs
   *  well with the viewport-narrow auto-collapse so the whole UI
   *  contracts gracefully on laptop displays. Off by default — users
   *  with strong opinions on font size shouldn't have it disturbed. */
  autoScale?: boolean;
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
  autoScale: false,
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
  /** Sidebar stays an icon rail and opens over the page on hover
   *  (`sidebar-collapse-hover` root class). */
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

  /** v0.9.7+ Dashboard panel configuration.
   *
   *  The Dashboard is fully user-arranged: each panel has a stable id
   *  (the rendering switch picks the body) plus an `enabled` flag, and
   *  the array order IS the on-screen order. Drag-reorder in Settings →
   *  Layout writes this list back. Hidden panels reflow the grid via
   *  CSS `auto-fit` so the remaining cards expand naturally.
   *
   *  Old v0.9 builds stored `{ overview, projects, tasks }` booleans;
   *  `loadLayout` detects that shape and migrates to the canonical
   *  panel list on first read. */
  dashboardWidgets: {
    panels: DashboardPanelEntry[];
  };

  /** Which card fills the hero left column. See `DashboardHeroCard`
   *  above for the full menu. Defaults to "studioCard" because every
   *  user has a studio identity at minimum, even if it's just the
   *  placeholder name. */
  dashboardHeroCard?: DashboardHeroCard;

  /** When true, page panels (.panel, .kcard, .task-card, …) lose their
   *  card chrome — background, border, blur — and the page backdrop
   *  shows through. Useful when paired with a vivid bg theme so the
   *  content reads as floating type/icons rather than card stacks. */
  transparentPanels: boolean;

  /** Show the framer-motion sliding pill behind the active sidebar
   *  item. When false the active state is a plain background swap. */
  sidebarSlideIndicator: boolean;

  /** Flow Center: show the bottom-right minimap. */
  flowMinimap?: boolean;
  /** Flow Center: modifier key for add-to-selection (Shift default). */
  flowMultiSelectKey?: "Shift" | "Control" | "Alt";
}

/** Canonical id list for Dashboard panels. Add new entries here AND
 *  in `DEFAULT_DASHBOARD_PANELS` below so users see the new panel
 *  appear on their next launch.
 *
 *  v0.9.7+: `quickActions` was retired — the floating QuickCapture FAB
 *  in the bottom-right corner replaces it entirely. The QuickCapture
 *  widget has its own General → "Hızlı yakalama balonu" toggle. */
export type DashboardPanelId =
  | "recentGames"
  | "tasksAtRisk"
  | "spendTrend"
  | "overview";

/** Which card fills the hero's left column. The user picks from
 *  Settings → Layout → Dashboard. All variants were discussed with
 *  the user in v0.9.7's hero-detail iteration — implementing the
 *  full menu rather than just one keeps the surface useful for
 *  whichever workflow the user actually has. */
export type DashboardHeroCard =
  | "studioCard"        // brand + game/shipped/focus/days stats
  | "sirada"            // next-up task (overdue → urgent → soon)
  | "pomodoro"          // focus session state + today's sessions
  | "quickCapture"      // inline input → new note/task
  | "releaseCountdown"  // closest release-like milestones by due date
  | "todayMicro"        // today's closed-task count + focus minutes
  | "todayGoal"         // editable single-line goal/mantra
  | "pinnedShortcuts"   // recently-active game shortcuts (auto-pinned)
  | "none";             // hide the left card, hero shrinks accordingly

export interface DashboardPanelEntry {
  id: DashboardPanelId;
  enabled: boolean;
}

/** Default render order — every panel on. The user reorders / toggles
 *  via Settings → Layout → Dashboard panels. */
export const DEFAULT_DASHBOARD_PANELS: DashboardPanelEntry[] = [
  { id: "recentGames",  enabled: true },
  { id: "tasksAtRisk",  enabled: true },
  { id: "spendTrend",   enabled: true },
  { id: "overview",     enabled: true },
];

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
  dashboardWidgets: { panels: DEFAULT_DASHBOARD_PANELS },
  dashboardHeroCard: "studioCard",
  transparentPanels: false,
  sidebarSlideIndicator: true,
  flowMinimap: true,
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
  // `--font-size-base-user` carries the user's literal preference; the
  // fluid-type CSS rule reads it to build the clamp() upper anchor.
  // When auto-scale is off, --font-size-base is just the literal value.
  root.style.setProperty("--font-size-base-user", `${typography.baseSize}px`);
  root.style.setProperty("--font-size-base", `${typography.baseSize}px`);
  root.classList.toggle("fluid-type", typography.autoScale === true);
  root.style.setProperty("--font-size-editor", `${typography.editorSize}px`);
  root.style.setProperty("--line-height", String(typography.lineHeight));
  root.style.setProperty("--heading-scale", HEADING_SCALE_VALUE[typography.headingScale]);
  root.style.setProperty("--bold-weight", String(typography.boldWeight));
  root.style.setProperty("--letter-spacing", LETTER_SPACING_VALUE[typography.letterSpacing]);
  root.classList.toggle("antialiased", typography.antialiasing);
  root.classList.toggle("tabular-numbers", typography.tabularNumbers);

  // ── Layout
  root.style.setProperty("--density-scale", String(DENSITY_SCALE[layout.density]));
  // Density class hook — CSS rules under `:root.density-compact …`
  // strip decorative chrome (eyebrows, helper text) so a dense user
  // doesn't waste verticals on labels they already know. The other
  // two modes are no-ops at the class level.
  for (const cls of Array.from(root.classList)) {
    if (cls.startsWith("density-")) root.classList.remove(cls);
  }
  root.classList.add(`density-${layout.density}`);
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
  root.classList.toggle("sidebar-collapse-hover", layout.sidebarCollapseOnHover === true);
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
  const raw = safeRead<LayoutSlice & { dashboardWidgets?: unknown }>(KEY_LAYOUT, DEFAULT_LAYOUT);
  return { ...raw, dashboardWidgets: normaliseDashboardWidgets(raw.dashboardWidgets) };
}

/** Migrates v0.9 → v0.9.7 dashboardWidgets storage in-place.
 *
 *  v0.9 shape: `{ overview: bool, projects: bool, tasks: bool }`
 *  v0.9.7 shape: `{ panels: [{ id, enabled }, …] }` — array order is render order.
 *
 *  Mapping when migrating: overview → keeps id "overview"; projects →
 *  "recentGames" (the new equivalent — last-updated games list);
 *  tasks → "tasksAtRisk" (the equivalent — overdue + soonest pending).
 *  New-in-v0.9.7 panels (`spendTrend`, `quickActions`) default to
 *  enabled because they're additive value and the spec says hidden
 *  panels should never leave the dashboard looking empty.
 *
 *  Also fills in any panel id that's missing from the persisted list
 *  (e.g. user opens an older build then upgrades — the new panel gets
 *  appended to the end so the existing order is preserved). */
function normaliseDashboardWidgets(value: unknown): { panels: DashboardPanelEntry[] } {
  // Already in the new shape — sanity-check ids and append missing ones.
  if (value && typeof value === "object" && Array.isArray((value as { panels?: unknown }).panels)) {
    const seen = new Set<string>();
    const out: DashboardPanelEntry[] = [];
    for (const p of (value as { panels: unknown[] }).panels) {
      if (!p || typeof p !== "object") continue;
      const id = (p as { id?: unknown }).id;
      const enabled = (p as { enabled?: unknown }).enabled;
      if (typeof id !== "string") continue;
      const known = DEFAULT_DASHBOARD_PANELS.find((d) => d.id === id);
      if (!known) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id: known.id, enabled: typeof enabled === "boolean" ? enabled : true });
    }
    // Append any new-in-this-version panels the user hasn't seen yet.
    for (const d of DEFAULT_DASHBOARD_PANELS) {
      if (!seen.has(d.id)) out.push({ ...d });
    }
    return { panels: out };
  }
  // Legacy v0.9 shape — migrate by mapping the three booleans.
  if (value && typeof value === "object") {
    const legacy = value as { overview?: unknown; projects?: unknown; tasks?: unknown };
    const enabledFromLegacy = (id: DashboardPanelId): boolean => {
      switch (id) {
        case "overview":     return legacy.overview     !== false;
        case "recentGames":  return legacy.projects     !== false;
        case "tasksAtRisk":  return legacy.tasks        !== false;
        default:             return true; // new panels default-on
      }
    };
    return {
      panels: DEFAULT_DASHBOARD_PANELS.map((d) => ({ id: d.id, enabled: enabledFromLegacy(d.id) })),
    };
  }
  return { panels: DEFAULT_DASHBOARD_PANELS.map((d) => ({ ...d })) };
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
