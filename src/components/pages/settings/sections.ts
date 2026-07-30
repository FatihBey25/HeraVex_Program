// Single source of truth for the Settings sidebar layout.
//
// Each entry binds a stable id (used as state + persisted scroll
// position key), a group key (for the sectioned sidebar header), a
// Lucide icon, and an i18n key on `ui` that resolves to the label.
//
// New milestones add their pages by populating the corresponding
// section's content in `Profile.tsx`. The sidebar itself never needs
// to know whether a section is "real" or "placeholder" — that's a
// rendering-side concern. M1 ships every entry with either the
// existing real content or a `SettingsPlaceholder`.

import {
  User, Building2, Bell,
  Palette, Type, LayoutGrid,
  Settings as SettingsIcon, AppWindow, Keyboard, Clock,
  Database, ShieldCheck, ArrowLeftRight,
  KeyRound, Cloud, Webhook, Puzzle,
  ShieldAlert, FlaskConical, Info,
  type LucideIcon,
} from "lucide-react";
import type { copy } from "../../../lib/i18n";

export type SettingsSection =
  // KULLANICI
  | "profile" | "studio" | "notifications"
  // GÖRÜNÜM
  | "theme" | "typography" | "layout"
  // DAVRANIŞ
  | "general" | "startup" | "keyboard" | "pomodoro"
  // VERİ
  | "storage" | "backup" | "importExport"
  // BAĞLANTILAR
  | "apiKeys" | "teamMode" | "webhooks" | "plugins"
  // SİSTEM
  | "privacy" | "experimental" | "about";

export type SettingsGroupId =
  | "user"
  | "appearance"
  | "behavior"
  | "data"
  | "connections"
  | "system";

/** Keys on `copy.en` that resolve to a plain `string` value. The full
 *  `copy.en` shape mixes strings, template functions, and nested
 *  objects (statuses/tabs); narrowing to string-valued keys is what
 *  lets us pass `ui[item.labelKey]` straight into JSX without React's
 *  ReactNode complaining about a function. Adding a new section
 *  without adding the matching i18n string is still a compile error. */
type EnCopy = typeof copy["en"];
type StringValuedKeys<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T];
type LabelKey = StringValuedKeys<EnCopy>;

export interface SidebarItem {
  id: SettingsSection;
  group: SettingsGroupId;
  icon: LucideIcon;
  labelKey: LabelKey;
  /** Page subtitle rendered under the big section title — one short
   *  line, secondary colour. M1 wires one per section. */
  subtitleKey: LabelKey;
  /** When true, every milestone past M1 still shows the placeholder.
   *  Used for genuinely shipped-later items (e.g. webhook editor). */
  comingSoon?: boolean;
}

export interface SidebarGroup {
  id: SettingsGroupId;
  labelKey: LabelKey;
}

export const SETTINGS_GROUPS: SidebarGroup[] = [
  { id: "user",        labelKey: "settingsGroupUser" },
  { id: "appearance",  labelKey: "settingsGroupAppearance" },
  { id: "behavior",    labelKey: "settingsGroupBehavior" },
  { id: "data",        labelKey: "settingsGroupData" },
  { id: "connections", labelKey: "settingsGroupConnections" },
  { id: "system",      labelKey: "settingsGroupSystem" },
];

export const SETTINGS_ITEMS: SidebarItem[] = [
  // KULLANICI
  { id: "profile",       group: "user",        icon: User,        labelKey: "settingsNavProfile",       subtitleKey: "settingsSubtitleProfile" },
  { id: "studio",        group: "user",        icon: Building2,   labelKey: "settingsNavStudio",        subtitleKey: "settingsSubtitleStudio" },
  { id: "notifications", group: "user",        icon: Bell,        labelKey: "settingsNavNotifications", subtitleKey: "settingsSubtitleNotifications" },
  // GÖRÜNÜM
  { id: "theme",         group: "appearance",  icon: Palette,     labelKey: "settingsNavTheme",         subtitleKey: "settingsSubtitleTheme" },
  { id: "typography",    group: "appearance",  icon: Type,        labelKey: "settingsNavTypography",    subtitleKey: "settingsSubtitleTypography" },
  { id: "layout",        group: "appearance",  icon: LayoutGrid,  labelKey: "settingsNavLayout",        subtitleKey: "settingsSubtitleLayout" },
  // DAVRANIŞ
  { id: "general",       group: "behavior",    icon: SettingsIcon, labelKey: "settingsNavGeneral",      subtitleKey: "settingsSubtitleGeneral" },
  { id: "startup",       group: "behavior",    icon: AppWindow,   labelKey: "settingsNavStartup",       subtitleKey: "settingsSubtitleStartup" },
  { id: "keyboard",      group: "behavior",    icon: Keyboard,    labelKey: "settingsNavKeyboard",      subtitleKey: "settingsSubtitleKeyboard" },
  { id: "pomodoro",      group: "behavior",    icon: Clock,       labelKey: "settingsNavPomodoro",      subtitleKey: "settingsSubtitlePomodoro" },
  // VERİ
  { id: "storage",       group: "data",        icon: Database,    labelKey: "settingsNavStorage",       subtitleKey: "settingsSubtitleStorage" },
  { id: "backup",        group: "data",        icon: ShieldCheck, labelKey: "settingsNavBackup",        subtitleKey: "settingsSubtitleBackup" },
  { id: "importExport",  group: "data",        icon: ArrowLeftRight, labelKey: "settingsNavImportExport", subtitleKey: "settingsSubtitleImportExport" },
  // BAĞLANTILAR
  { id: "apiKeys",       group: "connections", icon: KeyRound,    labelKey: "settingsNavApiKeys",       subtitleKey: "settingsSubtitleApiKeys" },
  { id: "teamMode",      group: "connections", icon: Cloud,       labelKey: "settingsNavTeamMode",      subtitleKey: "settingsSubtitleTeamMode" },
  { id: "webhooks",      group: "connections", icon: Webhook,     labelKey: "settingsNavWebhooks",      subtitleKey: "settingsSubtitleWebhooks" },
  { id: "plugins",       group: "connections", icon: Puzzle,      labelKey: "settingsNavPlugins",       subtitleKey: "settingsSubtitlePlugins" },
  // SİSTEM
  { id: "privacy",       group: "system",      icon: ShieldAlert, labelKey: "settingsNavPrivacy",       subtitleKey: "settingsSubtitlePrivacy" },
  { id: "experimental",  group: "system",      icon: FlaskConical, labelKey: "settingsNavExperimental", subtitleKey: "settingsSubtitleExperimental" },
  { id: "about",         group: "system",      icon: Info,        labelKey: "settingsNavAbout",         subtitleKey: "settingsSubtitleAbout" },
];

/** Flat order of section ids — used for keyboard arrow rotation
 *  (groups are visual only; arrow keys traverse the full flat list). */
export const SETTINGS_FLAT_ORDER: SettingsSection[] =
  SETTINGS_ITEMS.map((item) => item.id);
