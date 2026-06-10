// Per-page reset + per-page JSON export wiring.
//
// The SettingsShell header has two icon buttons whose behaviour
// changes with the active section: "Reset this page" pulls the
// current section back to its shipped default, "Export this page"
// hands the user the JSON of just that slice as a downloadable
// file. Both are dispatched through this single resolver so the
// shell stays section-agnostic.

import { useAppStore } from "../store";
import { resetShortcuts, loadShortcuts, exportShortcutsJson } from "./shortcutConfig";
import { signOutAndReload } from "./privacyExperimental";
import type { SettingsSection } from "../components/pages/settings/sections";

/** Mirror reset map. Sections without a dedicated slice (storage,
 *  importExport, apiKeys, about) return `null` from `getResetHandler`
 *  so the shell hides the button rather than rendering a no-op. */
export function getResetHandler(section: SettingsSection): (() => void) | null {
  const s = useAppStore.getState();
  switch (section) {
    case "profile":       return () => s.resetProfile();
    case "studio":        return () => s.resetStudioIdentity();
    case "notifications": return () => s.resetNotifications();
    case "theme":         return () => s.resetAppearance();
    case "typography":    return () => s.resetTypography();
    case "layout":        return () => s.resetLayout();
    case "general":       return () => s.resetGeneral();
    case "startup":       return () => s.resetStartup();
    case "keyboard":      return () => {
      resetShortcuts();
      window.dispatchEvent(new CustomEvent("heravex:shortcuts-updated"));
    };
    case "pomodoro":      return () => s.resetPomodoroPrefs();
    case "backup":        return () => s.resetBackupPrefs();
    case "teamMode":      return () => s.resetTeamMode();
    case "webhooks":      return () => s.resetWebhooks();
    case "privacy":       return () => s.resetPrivacy();
    case "experimental":  return () => s.resetExperimental();
    // No-op pages: storage (read-only stats), apiKeys (would clobber
    // real keys — too destructive for a one-click reset), importExport
    // (button-only), about (read-only). Hide the icon for these.
    case "storage":
    case "importExport":
    case "apiKeys":
    case "about":
      return null;
  }
}

/** Returns the JSON payload + a recommended filename. The caller
 *  triggers the download (browser `<a download>` trick). Sections
 *  without slice content return `null`. */
export function getExportPayload(
  section: SettingsSection,
): { json: string; filename: string } | null {
  const s = useAppStore.getState();
  const wrap = (kind: string, data: unknown) => ({
    json: JSON.stringify({ v: 1, kind, exportedAt: new Date().toISOString(), data }, null, 2),
    filename: `heravex-settings-${section}.json`,
  });
  switch (section) {
    case "profile":       return wrap("profile", s.profile);
    case "studio":        return wrap("studio", s.studioIdentity);
    case "notifications": return wrap("notifications", s.notifications);
    case "theme":         return wrap("appearance", s.appearance);
    case "typography":    return wrap("typography", s.typography);
    case "layout":        return wrap("layout", s.layout);
    case "general":       return wrap("general", s.general);
    case "startup":       return wrap("startup", s.startup);
    case "keyboard":      return {
      json: exportShortcutsJson(loadShortcuts()),
      filename: "heravex-shortcuts.json",
    };
    case "pomodoro":      return wrap("pomodoro", s.pomodoroPrefs);
    case "backup":        return wrap("backup", s.backupPrefs);
    case "teamMode":      return wrap("teamMode", s.teamMode);
    case "webhooks":      return wrap("webhooks", s.webhooks);
    case "privacy":       return wrap("privacy", s.privacy);
    case "experimental":  return wrap("experimental", s.experimental);
    case "storage":
    case "importExport":
    case "apiKeys":
    case "about":
      return null;
  }
}

/** Download helper — used by the shell's export icon click. */
export function downloadJson(filename: string, payload: string) {
  try {
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.warn("[downloadJson]", err);
  }
}

/** Re-exported so Profile.tsx callers don't have to know which file
 *  owns sign-out — saves one import in the consumer. */
export { signOutAndReload };
