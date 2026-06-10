// User profile + general locale slices persisted to localStorage.
//
// These mirror the appearance/typography/layout pattern from M2: a
// typed slice + DEFAULT + load/save helpers, consumed directly by
// the Settings pages. Persistence on disk (Rust settings.json v2)
// is deferred to a future polish milestone — localStorage keeps the
// data per-machine which is the right scope for "who am I"
// (Profile) and "how do I read dates" (General).
//
// Display name + display role are already persisted under the old
// `heravex_user_name` / `heravex_user_role` keys from pre-v0.9.
// We preserve those keys here so existing values carry over.

import type { AppLanguage } from "./i18n";

// ── Profile slice ────────────────────────────────────────────────────

export type ExperienceLevel = "lt1y" | "1to3" | "3to5" | "5plus";
export type RoleId =
  | "soloDev" | "designer" | "programmer" | "artist"
  | "composer" | "producer" | "writer" | "qa" | "other";
export type EngineId =
  | "unity" | "godot" | "unreal" | "gameMaker"
  | "construct" | "rpgMaker" | "defold" | "custom" | "other";
export type LanguageId =
  | "cs" | "cpp" | "gdscript" | "lua"
  | "python" | "jsts" | "rust" | "other";

export interface ProfileSlice {
  displayName: string;
  handle: string;
  email: string;
  location: string;

  primaryRole: RoleId;
  secondaryRoles: RoleId[];
  preferredEngine: EngineId;
  preferredLanguages: LanguageId[];
  experience: ExperienceLevel;

  bio: string;
  website: string;
  twitter: string;
  bluesky: string;
  mastodon: string;
  discord: string;
  github: string;
}

export const DEFAULT_PROFILE: ProfileSlice = {
  displayName: "",
  handle: "",
  email: "",
  location: "",

  primaryRole: "soloDev",
  secondaryRoles: [],
  preferredEngine: "unity",
  preferredLanguages: [],
  experience: "1to3",

  bio: "",
  website: "",
  twitter: "",
  bluesky: "",
  mastodon: "",
  discord: "",
  github: "",
};

// ── General slice ───────────────────────────────────────────────────

export type RegionalFormat = "auto" | "tr" | "us" | "eu" | "uk";
export type DateFormat = "dd.mm.yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd";
export type TimeFormat = "12h" | "24h";
export type WeekStart = "monday" | "saturday" | "sunday";
export type NumberFormat = "comma" | "period" | "space";
export type CurrencyPosition = "before" | "after";
export type AutosaveInterval = "instant" | "5s" | "10s" | "30s" | "manual";

export interface GeneralSlice {
  /** Display language already lives on `store.language`; kept out of
   *  this slice intentionally. Everything else regional is here. */
  regionalFormat: RegionalFormat;
  defaultCurrency: string;       // currency code, e.g. "USD"
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  weekStart: WeekStart;
  numberFormat: NumberFormat;
  currencyPosition: CurrencyPosition;

  autosaveInterval: AutosaveInterval;
  warnOnEmptyTitle: boolean;
  confirmOnDelete: boolean;
  confirmOnBatch: boolean;

  /** When true, the floating "+" Quick Capture button is rendered in
   *  the bottom-right corner. Opt-out for users on small displays who
   *  find it intrusive. */
  quickCapture: boolean;
}

export const DEFAULT_GENERAL: GeneralSlice = {
  regionalFormat: "auto",
  defaultCurrency: "USD",
  dateFormat: "dd.mm.yyyy",
  timeFormat: "24h",
  weekStart: "monday",
  numberFormat: "comma",
  currencyPosition: "before",

  autosaveInterval: "5s",
  warnOnEmptyTitle: true,
  confirmOnDelete: true,
  confirmOnBatch: true,

  quickCapture: true,
};

// ── Storage ─────────────────────────────────────────────────────────

const KEY_PROFILE = "heravex_profile_v1";
const KEY_GENERAL = "heravex_general_v1";

export function loadProfile(): ProfileSlice {
  const fromV1 = safeRead<ProfileSlice>(KEY_PROFILE, DEFAULT_PROFILE);
  // Honour the pre-v0.9 displayName/displayRole keys when the v1
  // payload is empty — keeps the upgrade boring.
  if (!fromV1.displayName) {
    try {
      const legacy = localStorage.getItem("heravex_user_name");
      if (legacy) fromV1.displayName = legacy;
    } catch {}
  }
  return fromV1;
}
export function loadGeneral(): GeneralSlice {
  return safeRead(KEY_GENERAL, DEFAULT_GENERAL);
}
export function saveProfile(s: ProfileSlice) { safeWrite(KEY_PROFILE, s); }
export function saveGeneral(s: GeneralSlice) { safeWrite(KEY_GENERAL, s); }

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

// ── Localised label helpers ─────────────────────────────────────────

export const ROLE_OPTIONS: { id: RoleId; labelKey: string }[] = [
  { id: "soloDev",    labelKey: "roleSoloDev" },
  { id: "designer",   labelKey: "roleDesigner" },
  { id: "programmer", labelKey: "roleProgrammer" },
  { id: "artist",     labelKey: "roleArtist" },
  { id: "composer",   labelKey: "roleComposer" },
  { id: "producer",   labelKey: "roleProducer" },
  { id: "writer",     labelKey: "roleWriter" },
  { id: "qa",         labelKey: "roleQa" },
  { id: "other",      labelKey: "roleOther" },
];

export const ENGINE_OPTIONS: { id: EngineId; label: string }[] = [
  { id: "unity",     label: "Unity" },
  { id: "godot",     label: "Godot" },
  { id: "unreal",    label: "Unreal" },
  { id: "gameMaker", label: "GameMaker" },
  { id: "construct", label: "Construct" },
  { id: "rpgMaker",  label: "RPG Maker" },
  { id: "defold",    label: "Defold" },
  { id: "custom",    label: "Custom" },
  { id: "other",     label: "Other" },
];

export const LANGUAGE_OPTIONS: { id: LanguageId; label: string }[] = [
  { id: "cs",       label: "C#" },
  { id: "cpp",      label: "C++" },
  { id: "gdscript", label: "GDScript" },
  { id: "lua",      label: "Lua" },
  { id: "python",   label: "Python" },
  { id: "jsts",     label: "JS/TS" },
  { id: "rust",     label: "Rust" },
  { id: "other",    label: "Other" },
];

export const EXPERIENCE_OPTIONS: { id: ExperienceLevel; labelKey: string }[] = [
  { id: "lt1y",  labelKey: "experienceLt1y" },
  { id: "1to3",  labelKey: "experience1to3" },
  { id: "3to5",  labelKey: "experience3to5" },
  { id: "5plus", labelKey: "experience5plus" },
];

// Re-export AppLanguage just so callers don't need a second import.
export type _LanguageMarker = AppLanguage;
