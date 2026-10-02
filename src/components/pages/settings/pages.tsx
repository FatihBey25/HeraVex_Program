// Per-section page bodies for the deep Settings.
//
// M1 ships a placeholder per section: each page is a real
// `SettingGroup` + `SettingRow` arrangement matching the future
// layout, but every control is rendered as a small "Coming…" chip.
// This serves three goals at once:
//   1. The new visual language (dense, row-based, no hero icons) is
//      already on screen — the user can audit the discipline now.
//   2. M3-M7 milestones replace the placeholder chips with real
//      controls one row at a time, no chrome rewrites required.
//   3. Translators see the eventual scaffold and can flag layout
//      issues early.
//
// IMPORTANT: M1 deliberately strips every existing inline section
// from Profile.tsx. Real avatar upload, API-key forms, shortcut
// editor, backup buttons, etc. return milestone by milestone (see
// the milestone plan in the prompt). The previously-saved data on
// disk is untouched.

import { Camera, Trash2, RefreshCcw, Mail, ExternalLink, Sparkles, Copy } from "lucide-react";
import { useAppStore } from "../../../store";
import { SettingGroup } from "./rows/SettingGroup";
import { SettingRow } from "./rows/SettingRow";
import { Toggle, PillGroup, Dropdown, SliderRow, CompactButton, TextInput, TextArea, ChipInput, KeyComboButton, PasswordInput } from "./rows/controls";
import { AccentSwatchGrid, ColorDot } from "./rows/swatches";
import { ACCENT_PRESETS, DEFAULT_DASHBOARD_PANELS, type DashboardPanelEntry, type DashboardPanelId, type DashboardHeroCard, type LayoutSlice } from "../../../lib/appearance";
import { detectCloudProvider, loadWorkspaces, addWorkspace, updateWorkspaceMode } from "../../../lib/workspaces";
import { Reorder } from "framer-motion";
import { GripVertical, RotateCcw } from "lucide-react";
import {
  ENGINE_OPTIONS, EXPERIENCE_OPTIONS, LANGUAGE_OPTIONS, ROLE_OPTIONS,
  type EngineId, type ExperienceLevel, type RoleId, type LanguageId,
} from "../../../lib/userProfile";
import { imgSrc } from "../../../lib/images";
import { APP_VERSION, APP_BUILD_DATE, RELEASES_URL, FEEDBACK_EMAIL } from "../../../lib/app-meta";
import {
  openExternal, revealInFolder, getWorkspacePath, setWorkspacePath, clearWorkspacePath,
  pickDirectory, pickGooglePlayJson, fetchStoreGames, pickAndSaveStudioLogo, clearStudioLogo,
  computeStorageStats, listBackups, deleteBackup, verifyBackup, type BackupVerifyReport,
  storageClearCache, storageRemoveTemp, storageFindOrphanImages, storageDeleteOrphanImages,
  storageIntegrityCheck, storagePruneBuilds,
  type StorageStats, type BackupEntry, type OrphanImage, type IntegrityReport, type CleanResult,
} from "../../../lib/storage";
import { postDiscordWebhook, type CustomWebhook, type WebhookEvent } from "../../../lib/teamWebhooks";
import { customPayload, postCustomWebhook } from "../../../lib/webhookEvents";
import {
  signOutAndReload, safeCopyToClipboard,
  type AutoLockTimeout, type ClipboardClearSeconds, type ReleaseChannel,
} from "../../../lib/privacyExperimental";
import { deleteAllData, openLogDirectory } from "../../../lib/storage";
import { invoke } from "../../../lib/invokeWrapper";
import { resetTutorial } from "../../Tutorial/TutorialOverlay";
import { TUTORIAL_UI } from "../../../lib/tutorialSteps";
import {
  DEFAULT_SHORTCUTS, SHORTCUT_GROUPS,
  actionLabel, detectMac, exportShortcutsJson,
  findShortcutConflicts, formatCombo, loadShortcuts, resetShortcuts, saveShortcuts,
  type ShortcutAction, type ShortcutDef,
} from "../../../lib/shortcutConfig";
import { useCallback, useEffect, useState } from "react";
import { PluginsPage } from "./PluginsPage";
import { ImportExportPage } from "./ImportExportPage";
import type { CustomWidget } from "../../../lib/privacyExperimental";
import { SYNC_INTERVAL_OPTIONS, loadStoreSyncPrefs, saveStoreSyncPrefs, type StoreSyncPrefs } from "../../../lib/storeSync";
import type { StoreProvider } from "../../../types";
import { ConfirmDialog } from "../../shared/ConfirmDialog";
import { listPluginThemes, getActivePluginThemeKey, applyPluginTheme } from "../../../lib/pluginThemes";
import type { SettingsSection } from "./sections";

/** Top-level dispatcher — each section maps to a renderer. */
export function SettingsPage({ section }: { section: SettingsSection }) {
  switch (section) {
    case "profile":       return <ProfilePage />;
    case "studio":        return <StudioPage />;
    case "notifications": return <NotificationsPage />;
    case "theme":         return <ThemePage />;
    case "typography":    return <TypographyPage />;
    case "layout":        return <LayoutPage />;
    case "general":       return <GeneralPage />;
    case "startup":       return <StartupPage />;
    case "keyboard":      return <KeyboardPage />;
    case "pomodoro":      return <PomodoroPage />;
    case "storage":       return <StoragePage />;
    case "backup":        return <BackupPage />;
    case "importExport":  return <ImportExportPage />;
    case "apiKeys":       return <ApiKeysPage />;
    case "teamMode":      return <TeamModePage />;
    case "webhooks":      return <WebhooksPage />;
    case "plugins":       return <PluginsPage />;
    case "privacy":       return <PrivacyPage />;
    case "experimental":  return <ExperimentalPage />;
    case "about":         return <AboutPage />;
  }
}

// ─────────────────────────────────────────────────────────────────────
// USER
// ─────────────────────────────────────────────────────────────────────

function ProfilePage() {
  const {
    ui, profile, setProfile,
    avatarPath, handlePickAvatar, handleClearAvatar,
  } = useAppStore();
  const p = profile;

  // Localised labels for role/experience pickers. Engine + language
  // options ship as plain strings (Unity, Godot, …) because they're
  // brand names that don't translate.
  const roleOptions = ROLE_OPTIONS.map((r) => ({
    id: r.id, label: ui[r.labelKey as keyof typeof ui] as string,
  }));
  const experienceOptions = EXPERIENCE_OPTIONS.map((e) => ({
    id: e.id, label: ui[e.labelKey as keyof typeof ui] as string,
  }));
  const avatarSrc = imgSrc(avatarPath);

  return (
    <>
      <SettingGroup label={ui.profileGroupIdentity}>
        <SettingRow
          title={ui.profileAvatar}
          description={ui.profileAvatarDesc}
          control={
            <div className="setting-avatar-control">
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="setting-avatar-preview" />
              ) : (
                <div className="setting-avatar-placeholder">
                  <Camera size={16} />
                </div>
              )}
              <CompactButton onClick={() => void handlePickAvatar()}>
                {ui.profileAvatarPick}
              </CompactButton>
              {avatarSrc && (
                <CompactButton onClick={() => void handleClearAvatar()} variant="danger">
                  <Trash2 size={11} />
                </CompactButton>
              )}
            </div>
          }
        />
        <SettingRow
          title={ui.profileDisplayName}
          control={
            <TextInput
              value={p.displayName}
              onChange={(v) => setProfile({ displayName: v })}
              placeholder={ui.profileDisplayNamePlaceholder}
              maxLength={60}
            />
          }
        />
        <SettingRow
          title={ui.profileHandle}
          description={ui.profileHandleDesc}
          control={
            <TextInput
              value={p.handle}
              onChange={(v) => setProfile({ handle: v.replace(/^@+/, "") })}
              placeholder="@fatih"
              maxLength={30}
            />
          }
        />
        <SettingRow
          title={ui.profileEmail}
          control={
            <TextInput
              value={p.email}
              onChange={(v) => setProfile({ email: v })}
              type="email"
              placeholder="you@example.com"
              maxLength={120}
            />
          }
        />
        <SettingRow
          title={ui.profileLocation}
          control={
            <TextInput
              value={p.location}
              onChange={(v) => setProfile({ location: v })}
              placeholder={ui.profileLocationPlaceholder}
              maxLength={60}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.profileGroupRole}>
        <SettingRow
          title={ui.profilePrimaryRole}
          control={
            <Dropdown
              value={p.primaryRole}
              options={roleOptions}
              onChange={(id) => setProfile({ primaryRole: id as RoleId })}
            />
          }
        />
        <SettingRow
          title={ui.profileSecondaryRoles}
          description={ui.profileSecondaryRolesDesc}
          control={
            <ChipInput
              values={p.secondaryRoles}
              onChange={(next) => setProfile({ secondaryRoles: next as RoleId[] })}
              presets={roleOptions.filter((r) => r.id !== p.primaryRole)}
              maxChips={3}
              placeholder={ui.profileSecondaryRolesPlaceholder}
            />
          }
        />
        <SettingRow
          title={ui.profileEngine}
          control={
            <Dropdown
              value={p.preferredEngine}
              options={ENGINE_OPTIONS}
              onChange={(id) => setProfile({ preferredEngine: id as EngineId })}
            />
          }
        />
        <SettingRow
          title={ui.profileLanguages}
          control={
            <ChipInput
              values={p.preferredLanguages}
              onChange={(next) => setProfile({ preferredLanguages: next as LanguageId[] })}
              presets={LANGUAGE_OPTIONS}
              maxChips={6}
            />
          }
        />
        <SettingRow
          title={ui.profileExperience}
          control={
            <PillGroup
              value={p.experience}
              options={experienceOptions}
              onChange={(id) => setProfile({ experience: id as ExperienceLevel })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.profileGroupBio}>
        <SettingRow
          title={ui.profileBio}
          description={ui.profileBioDesc}
          control={
            <TextArea
              value={p.bio}
              onChange={(v) => setProfile({ bio: v.slice(0, 280) })}
              placeholder={ui.profileBioPlaceholder}
              maxLength={280}
              rows={2}
            />
          }
        />
        <SettingRow
          title={ui.profileWebsite}
          control={<TextInput value={p.website} onChange={(v) => setProfile({ website: v })} type="url" placeholder="https://…" />}
        />
        <SettingRow
          title="Twitter / X"
          control={<TextInput value={p.twitter} onChange={(v) => setProfile({ twitter: v })} placeholder="@handle" />}
        />
        <SettingRow
          title="Bluesky"
          control={<TextInput value={p.bluesky} onChange={(v) => setProfile({ bluesky: v })} placeholder="@handle.bsky.social" />}
        />
        <SettingRow
          title="Mastodon"
          control={<TextInput value={p.mastodon} onChange={(v) => setProfile({ mastodon: v })} placeholder="@user@mastodon.social" />}
        />
        <SettingRow
          title="Discord"
          control={<TextInput value={p.discord} onChange={(v) => setProfile({ discord: v })} placeholder="username" />}
        />
        <SettingRow
          title="GitHub"
          control={<TextInput value={p.github} onChange={(v) => setProfile({ github: v })} placeholder="username" />}
        />
      </SettingGroup>
    </>
  );
}

function StudioPage() {
  const { ui, studioIdentity, setStudioIdentity, showToast, language } = useAppStore();
  const s = studioIdentity;
  const logoSrc = imgSrc(s.logoPath);
  const pickLogo = async () => {
    try {
      const path = await pickAndSaveStudioLogo(s.logoPath);
      setStudioIdentity({ logoPath: path });
    } catch (err) {
      if (!String(err).includes("iptal")) showToast(String(err), "error");
    }
  };
  const removeLogo = async () => {
    const prev = s.logoPath;
    setStudioIdentity({ logoPath: "" });
    await clearStudioLogo(prev).catch(() => null);
  };
  return (
    <>
      <SettingGroup label={ui.studioGroupStudio}>
        <SettingRow
          title={ui.studioName}
          description={ui.studioNameDesc}
          control={<TextInput value={s.studioName} onChange={(v) => setStudioIdentity({ studioName: v })} placeholder={ui.studioNamePlaceholder} maxLength={60} />}
        />
        <SettingRow
          title={ui.studioLogo}
          description={language === "tr"
            ? "Kare görsel. Ana sayfadaki stüdyo kartında ve press kit'te geliştirici adının yanında görünür."
            : "Square image. Shown on the Dashboard studio card and next to the developer name in press kits."}
          control={
            <div className="setting-avatar-control">
              {logoSrc ? (
                <img src={logoSrc} alt="" className="setting-avatar-preview setting-logo-preview" />
              ) : (
                <div className="setting-avatar-placeholder setting-logo-preview">
                  <Camera size={16} />
                </div>
              )}
              <CompactButton onClick={() => void pickLogo()}>
                {language === "tr" ? "Seç" : "Choose"}
              </CompactButton>
              {logoSrc && (
                <CompactButton onClick={() => void removeLogo()} variant="danger">
                  <Trash2 size={11} />
                </CompactButton>
              )}
            </div>
          }
        />
        <SettingRow
          title={ui.studioFounded}
          control={
            <input
              type="date"
              className="setting-text-input"
              style={{ width: 140 }}
              value={s.founded}
              onChange={(e) => setStudioIdentity({ founded: e.target.value })}
            />
          }
        />
        <SettingRow
          title={ui.studioLocation}
          control={<TextInput value={s.location} onChange={(v) => setStudioIdentity({ location: v })} placeholder="Istanbul, TR" maxLength={60} />}
        />
        <SettingRow
          title={ui.studioTeamSize}
          control={
            <PillGroup
              value={s.teamSize}
              options={[
                { id: "solo", label: ui.studioTeamSolo },
                { id: "2-5",  label: "2–5" },
                { id: "6-10", label: "6–10" },
                { id: "10+",  label: "10+" },
              ]}
              onChange={(id) => setStudioIdentity({ teamSize: id as typeof s.teamSize })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.studioGroupLegal}>
        <SettingRow
          title={ui.studioLegalName}
          description={ui.studioLegalNameDesc}
          control={<TextInput value={s.legalName} onChange={(v) => setStudioIdentity({ legalName: v })} maxLength={120} />}
        />
        <SettingRow
          title={ui.studioTaxId}
          control={<TextInput value={s.taxId} onChange={(v) => setStudioIdentity({ taxId: v })} maxLength={40} />}
        />
        <SettingRow
          title={ui.studioContactEmail}
          control={<TextInput value={s.contactEmail} onChange={(v) => setStudioIdentity({ contactEmail: v })} type="email" maxLength={120} />}
        />
        <SettingRow
          title={ui.studioPressEmail}
          control={<TextInput value={s.pressEmail} onChange={(v) => setStudioIdentity({ pressEmail: v })} type="email" maxLength={120} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.studioGroupBrand}>
        <SettingRow
          title={ui.studioPrimaryColor}
          description={ui.studioBrandDesc}
          control={<ColorDot value={s.primaryColor} onChange={(c) => setStudioIdentity({ primaryColor: c })} />}
        />
        <SettingRow
          title={ui.studioSecondaryColor}
          control={<ColorDot value={s.secondaryColor} onChange={(c) => setStudioIdentity({ secondaryColor: c })} />}
        />
        <SettingRow
          title={ui.studioBrandFont}
          control={
            <Dropdown
              value={s.brandFont}
              options={[
                { id: "inter",    label: "Inter" },
                { id: "manrope",  label: "Manrope" },
                { id: "dmSans",   label: "DM Sans" },
                { id: "geist",    label: "Geist" },
                { id: "ibmPlex",  label: "IBM Plex Sans" },
                { id: "system",   label: ui.studioBrandFontSystem },
              ]}
              onChange={(id) => setStudioIdentity({ brandFont: id as typeof s.brandFont })}
            />
          }
        />
      </SettingGroup>
    </>
  );
}

function NotificationsPage() {
  const { ui, notifications, setNotifications, showToast } = useAppStore();
  const n = notifications;
  return (
    <>
      <SettingGroup label={ui.notifGroupTask}>
        <SettingRow
          title={ui.notifTaskDeadline}
          control={<Toggle checked={n.taskApproachingDeadline} onChange={(v) => setNotifications({ taskApproachingDeadline: v })} />}
        />
        <SettingRow
          title={ui.notifNoticeWindow}
          description={ui.notifNoticeWindowDesc}
          control={
            <Dropdown
              value={String(n.deadlineNoticeWindow) as "1" | "3" | "7" | "14"}
              options={[
                { id: "1",  label: ui.notifDay1 },
                { id: "3",  label: ui.notifDay3 },
                { id: "7",  label: ui.notifDay7 },
                { id: "14", label: ui.notifDay14 },
              ]}
              onChange={(id) => setNotifications({ deadlineNoticeWindow: Number(id) as 1 | 3 | 7 | 14 })}
            />
          }
        />
        <SettingRow
          title={ui.notifOverdueReminder}
          control={<Toggle checked={n.overdueDailyReminder} onChange={(v) => setNotifications({ overdueDailyReminder: v })} />}
        />
        <SettingRow
          title={ui.notifReminderTime}
          control={
            <input
              type="time"
              className="setting-text-input"
              style={{ width: 90 }}
              value={n.reminderTime}
              onChange={(e) => setNotifications({ reminderTime: e.target.value })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.notifGroupPomodoro}>
        <SettingRow
          title={ui.notifPomodoroSound}
          control={<Toggle checked={n.pomodoroSoundOnComplete} onChange={(v) => setNotifications({ pomodoroSoundOnComplete: v })} />}
        />
        <SettingRow
          title={ui.notifPomodoroDesktop}
          control={<Toggle checked={n.pomodoroDesktopNotification} onChange={(v) => setNotifications({ pomodoroDesktopNotification: v })} />}
        />
        <SettingRow
          title={ui.notifSuggestBreak}
          control={<Toggle checked={n.suggestBreak} onChange={(v) => setNotifications({ suggestBreak: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.notifGroupSystem}>
        <SettingRow
          title={ui.notifSyncErrors}
          control={<Toggle checked={n.storeSyncErrors} onChange={(v) => setNotifications({ storeSyncErrors: v })} />}
        />
        <SettingRow
          title={ui.notifSyncSuccessSilent}
          description={ui.notifSyncSuccessSilentDesc}
          control={<Toggle checked={n.storeSyncSuccessSilent} onChange={(v) => setNotifications({ storeSyncSuccessSilent: v })} />}
        />
        <SettingRow
          title={ui.notifNewRelease}
          control={<Toggle checked={n.newReleaseAvailable} onChange={(v) => setNotifications({ newReleaseAvailable: v })} />}
        />
        <SettingRow
          title={ui.notifBackupDone}
          control={<Toggle checked={n.backupCompleted} onChange={(v) => setNotifications({ backupCompleted: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.notifGroupSound}>
        <SettingRow
          title={ui.notifCustomSound}
          description={
            n.customSoundName
              ? n.customSoundName
              : ui.notifCustomSoundDesc
          }
          control={
            <div style={{ display: "inline-flex", gap: 6 }}>
              <CompactButton onClick={() => {
                // Open a file picker and read the chosen file as a
                // base64 data URL. Stored in the notifications slice
                // so it travels with the backup like everything else.
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "audio/mpeg,audio/wav,audio/mp3,audio/x-wav";
                input.onchange = () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  if (file.size > 2 * 1024 * 1024) {
                    // Hard cap at 2 MB — backups don't need a giant
                    // alarm clip, and the data URL would inflate
                    // the export JSON.
                    showToast("Audio file too large (max 2 MB).", "error");
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const url = String(reader.result || "");
                    setNotifications({ customSoundDataUrl: url, customSoundName: file.name });
                  };
                  reader.readAsDataURL(file);
                };
                input.click();
              }}>
                {ui.apiPickFile}
              </CompactButton>
              {n.customSoundDataUrl && (
                <CompactButton
                  variant="danger"
                  onClick={() => setNotifications({ customSoundDataUrl: "", customSoundName: "" })}
                >
                  {ui.backupDelete}
                </CompactButton>
              )}
            </div>
          }
        />
        <SettingRow
          title={ui.notifVolume}
          control={
            <SliderRow
              value={n.volume} min={0} max={100} step={5}
              format={(v) => `${v}%`}
              onChange={(v) => setNotifications({ volume: v })}
            />
          }
        />
        <SettingRow
          title={ui.notifTest}
          description={ui.notifTestDesc}
          control={
            <CompactButton onClick={() => {
              // Plays the user's custom sound when set, otherwise
              // the synthesised two-tone beep.
              void import("../../../lib/pomodoro").then((m) => m.playBeep(n.volume / 100));
            }}>
              {ui.notifTestButton}
            </CompactButton>
          }
        />
      </SettingGroup>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// APPEARANCE
// ─────────────────────────────────────────────────────────────────────

/** Mini mockup grid for visual theme selection. Each card mirrors the
 *  shell layout — left sidebar tinted with that theme's `bgSidebar`
 *  preset, right area with the matching `bgMain` orbs. Picking a card
 *  applies BOTH sides at once so the look stays internally consistent;
 *  power users can still mix-and-match via the dropdowns above. */
function ThemePreviewGrid({
  accent, activeMain, activeSidebar, onPick,
}: {
  accent: string;
  activeMain: string;
  activeSidebar: string;
  onPick: (mainId: string, sidebarId: string) => void;
}) {
  const { language } = useAppStore();
  // Plugin-registered themes appear right here alongside the built-ins —
  // they are BACKGROUND themes now (sidebar + main), not a light/dark
  // "mode". The core owns apply/persist/revert via pluginThemes.
  const [pluginThemes, setPluginThemes] = useState(() => listPluginThemes());
  const [activePlugin, setActivePlugin] = useState<string | null>(() => getActivePluginThemeKey());
  useEffect(() => {
    const on = () => { setPluginThemes(listPluginThemes()); setActivePlugin(getActivePluginThemeKey()); };
    window.addEventListener("heravex:plugin-themes-changed", on);
    return () => window.removeEventListener("heravex:plugin-themes-changed", on);
  }, []);
  const presets: { id: string; label: string; main: string; sidebar: string }[] = [
    { id: "standard",  label: language === "tr" ? "Klasik"     : "Classic",   main: "standard",  sidebar: "dark" },
    { id: "pureBlack", label: language === "tr" ? "Tam Siyah"  : "Pure Black",main: "pureBlack", sidebar: "darker" },
    { id: "gradient",  label: language === "tr" ? "Renkli"     : "Vibrant",   main: "gradient",  sidebar: "dark" },
    { id: "midnight",  label: "Midnight",                                     main: "midnight",  sidebar: "midnight" },
    { id: "ocean",     label: "Ocean",                                        main: "ocean",     sidebar: "ocean" },
    { id: "plum",      label: "Plum",                                         main: "plum",      sidebar: "plum" },
    { id: "forest",    label: "Forest",                                       main: "forest",    sidebar: "forest" },
    { id: "slate",     label: "Slate",                                        main: "slate",     sidebar: "slate" },
    { id: "sunset",    label: "Sunset",                                       main: "sunset",    sidebar: "sunset" },
  ];
  return (
    <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
      <div className="setting-row-text" style={{ marginBottom: 6 }}>
        <span className="setting-row-title">{language === "tr" ? "Hızlı tema seçimi" : "Quick theme picker"}</span>
        <span className="setting-row-desc">{language === "tr" ? "Sidebar + arkaplanı tek tıkla eşleştir. Eklenti temaları da burada." : "Pair sidebar + background in one click. Plugin themes appear here too."}</span>
      </div>
      <div className="theme-preview-grid">
        {presets.map((p) => {
          const isActive = !activePlugin && activeMain === p.main && activeSidebar === p.sidebar;
          return (
            <button
              key={p.id}
              type="button"
              className={`theme-preview-card theme-preview-${p.main}${isActive ? " is-active" : ""}`}
              onClick={() => { applyPluginTheme(null); onPick(p.main, p.sidebar); }}
              title={p.label}
              aria-pressed={isActive}
            >
              <div className={`theme-preview-shell theme-preview-shell-${p.main}`}>
                <div className={`theme-preview-sidebar theme-preview-sidebar-${p.sidebar}`}>
                  <span className="theme-preview-brand" style={{ background: accent }} />
                  <span className="theme-preview-nav" />
                  <span className="theme-preview-nav" />
                  <span className="theme-preview-nav theme-preview-nav-active" style={{ background: accent }} />
                </div>
                <div className="theme-preview-main">
                  <span className="theme-preview-card-pill" />
                  <span className="theme-preview-card-pill" />
                  <span className="theme-preview-cta" style={{ background: accent }} />
                </div>
              </div>
              <span className="theme-preview-label">{p.label}</span>
            </button>
          );
        })}
        {/* Plugin themes — same preview-card language, colours come from
            the plugin's declared preview swatches (inline, since there's
            no per-theme CSS class). */}
        {pluginThemes.map((pt) => {
          const isActive = activePlugin === pt.key;
          const bg = pt.preview ?? "#1a1a2e";
          const acc = pt.previewAccent ?? "#7aa0ff";
          return (
            <button
              key={pt.key}
              type="button"
              className={`theme-preview-card theme-preview-plugin${isActive ? " is-active" : ""}`}
              onClick={() => applyPluginTheme(pt.key)}
              title={`${pt.label} · ${pt.pluginName}`}
              aria-pressed={isActive}
            >
              <div className="theme-preview-shell" style={{ background: bg }}>
                <div className="theme-preview-sidebar" style={{ background: "rgba(0,0,0,0.35)" }}>
                  <span className="theme-preview-brand" style={{ background: acc }} />
                  <span className="theme-preview-nav" />
                  <span className="theme-preview-nav" />
                  <span className="theme-preview-nav theme-preview-nav-active" style={{ background: acc }} />
                </div>
                <div className="theme-preview-main">
                  <span className="theme-preview-card-pill" />
                  <span className="theme-preview-card-pill" />
                  <span className="theme-preview-cta" style={{ background: acc }} />
                </div>
              </div>
              <span className="theme-preview-label">🧩 {pt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ThemePage() {
  const { ui, appearance, setAppearance, language } = useAppStore();
  const a = appearance;
  const trc = (en: string, t: string) => (language === "tr" ? t : en);
  // Light mode lives behind a "v1.0" badge: the CSS class hook lands
  // in M2 but the light palette refactor itself is a future move. We
  // disable selecting it rather than silently swap to a half-styled
  // page.
  return (
    <>
      {/* Theme "mode" (System / Dark / Light) was removed in v0.9.9 —
          HeraVex themes the app through BACKGROUND themes (the quick-theme
          picker below), not a light/dark toggle. Plugin themes live in
          that same picker. */}
      <SettingGroup label={ui.themeGroupAccent}>
        <SettingRow
          title={ui.themeAccentColor}
          description={ui.themeAccentColorDesc}
          control={
            <AccentSwatchGrid
              presets={ACCENT_PRESETS.map((p) => ({ id: p.id, value: p.value, label: ui[p.labelKey] }))}
              current={a.accentColor}
              onChange={(next) => setAppearance({ accentColor: next })}
            />
          }
        />
        <SettingRow
          title={ui.themeAccentTargetSidebar}
          control={
            <Toggle
              checked={a.accentTargets.sidebar}
              onChange={(v) => setAppearance({ accentTargets: { ...a.accentTargets, sidebar: v } })}
            />
          }
        />
        <SettingRow
          title={ui.themeAccentTargetButtons}
          control={
            <Toggle
              checked={a.accentTargets.buttons}
              onChange={(v) => setAppearance({ accentTargets: { ...a.accentTargets, buttons: v } })}
            />
          }
        />
        <SettingRow
          title={ui.themeAccentTargetLinks}
          control={
            <Toggle
              checked={a.accentTargets.links}
              onChange={(v) => setAppearance({ accentTargets: { ...a.accentTargets, links: v } })}
            />
          }
        />
        <SettingRow
          title={ui.themeAccentTargetProgress}
          control={
            <Toggle
              checked={a.accentTargets.progress}
              onChange={(v) => setAppearance({ accentTargets: { ...a.accentTargets, progress: v } })}
            />
          }
        />
        <SettingRow
          title={ui.themeAccentTargetCharts}
          control={
            <Toggle
              checked={a.accentTargets.charts}
              onChange={(v) => setAppearance({ accentTargets: { ...a.accentTargets, charts: v } })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.themeGroupBackground}>
        <SettingRow
          title={ui.themeBgSidebar}
          control={
            <Dropdown
              value={a.bgSidebar}
              options={[
                { id: "dark",        label: ui.themeBgSidebarDark },
                { id: "darker",      label: ui.themeBgSidebarDarker },
                { id: "transparent", label: ui.themeBgSidebarTransparent },
                { id: "midnight",    label: "Midnight" },
                { id: "ocean",       label: "Ocean" },
                { id: "plum",        label: "Plum" },
                { id: "forest",      label: "Forest" },
                { id: "slate",       label: "Slate" },
                { id: "sunset",      label: "Sunset" },
              ]}
              onChange={(id) => setAppearance({ bgSidebar: id })}
            />
          }
        />
        <SettingRow
          title={ui.themeBgMain}
          control={
            <Dropdown
              value={a.bgMain}
              options={[
                { id: "standard",  label: ui.themeBgMainStandard },
                { id: "pureBlack", label: ui.themeBgMainPureBlack },
                { id: "gradient",  label: ui.themeBgMainGradient },
                { id: "midnight",  label: "Midnight" },
                { id: "ocean",     label: "Ocean" },
                { id: "plum",      label: "Plum" },
                { id: "forest",    label: "Forest" },
                { id: "slate",     label: "Slate" },
                { id: "sunset",    label: "Sunset" },
              ]}
              onChange={(id) => setAppearance({ bgMain: id })}
            />
          }
        />
        <SettingRow
          title={ui.themeBgAnimation}
          description={ui.themeBgAnimationDesc}
          control={
            <Toggle
              checked={a.bgAnimation}
              onChange={(v) => setAppearance({ bgAnimation: v })}
            />
          }
        />
        <ThemePreviewGrid
          accent={a.accentColor}
          activeMain={a.bgMain}
          activeSidebar={a.bgSidebar}
          onPick={(mainId, sidebarId) => {
            // Quick themes now also set a matching Flow Center canvas tint
            // so the flow background follows the picked theme.
            const flowByPreset: Record<string, string> = {
              midnight: "#4f8cff", ocean: "#22d3ee", plum: "#a78bfa",
              forest: "#34d399", slate: "#7d96c8", sunset: "#f59e0b",
              gradient: "#a78bfa", pureBlack: "#64748b", standard: "#4f8cff",
            };
            setAppearance({
              bgMain: mainId as typeof a.bgMain,
              bgSidebar: sidebarId as typeof a.bgSidebar,
              flowBgColor: flowByPreset[mainId] ?? a.flowBgColor,
            });
          }}
        />
      </SettingGroup>

      <SettingGroup label={trc("Flow Center canvas", "Flow Merkezi kanvası")}>
        <SettingRow
          title={trc("Grid style", "Izgara stili")}
          control={
            <Dropdown
              value={a.flowBg ?? "dots"}
              options={[
                { id: "dots",  label: trc("Dots", "Noktalı") },
                { id: "lines", label: trc("Lines", "Çizgili") },
                { id: "cross", label: trc("Cross", "Artı") },
                { id: "plain", label: trc("Plain", "Düz") },
              ]}
              onChange={(id) => setAppearance({ flowBg: id as "dots" | "lines" | "cross" | "plain" })}
            />
          }
        />
        <SettingRow
          title={trc("Background follows theme", "Arka plan temayı izlesin")}
          description={trc("Tints the canvas with your accent colour.", "Kanvası vurgu renginle tonlar.")}
          control={
            <Toggle
              checked={(a.flowBgColor ?? "auto") === "auto"}
              onChange={(v) => setAppearance({ flowBgColor: v ? "auto" : a.accentColor })}
            />
          }
        />
        <SettingRow
          title={trc("Background color", "Arka plan rengi")}
          control={
            <AccentSwatchGrid
              presets={ACCENT_PRESETS.map((p) => ({ id: p.id, value: p.value, label: ui[p.labelKey] }))}
              current={a.flowBgColor === "auto" ? "" : (a.flowBgColor ?? "")}
              onChange={(next) => setAppearance({ flowBgColor: next })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.themeGroupStatus}>
        <SettingRow
          title={ui.themeStatusSuccess}
          control={<ColorDot value={a.statusColors.success} onChange={(c) => setAppearance({ statusColors: { ...a.statusColors, success: c } })} />}
        />
        <SettingRow
          title={ui.themeStatusWarning}
          control={<ColorDot value={a.statusColors.warning} onChange={(c) => setAppearance({ statusColors: { ...a.statusColors, warning: c } })} />}
        />
        <SettingRow
          title={ui.themeStatusDanger}
          control={<ColorDot value={a.statusColors.danger} onChange={(c) => setAppearance({ statusColors: { ...a.statusColors, danger: c } })} />}
        />
        <SettingRow
          title={ui.themeStatusInfo}
          control={<ColorDot value={a.statusColors.info} onChange={(c) => setAppearance({ statusColors: { ...a.statusColors, info: c } })} />}
        />
      </SettingGroup>
    </>
  );
}

function TypographyPage() {
  const { ui, typography, setTypography } = useAppStore();
  const t = typography;
  return (
    <>
      <SettingGroup label={ui.typeGroupFamilies}>
        <SettingRow
          title={ui.typeAppFont}
          control={
            <Dropdown
              value={t.appFont}
              options={[
                { id: "system",   label: ui.typeFontSystem },
                { id: "sans",     label: ui.typeFontSans },
                { id: "rounded",  label: ui.typeFontRounded },
                { id: "humanist", label: ui.typeFontHumanist },
              ]}
              onChange={(id) => setTypography({ appFont: id })}
            />
          }
        />
        <SettingRow
          title={ui.typeEditorFont}
          description={ui.typeEditorFontDesc}
          control={
            <Dropdown
              value={t.editorFont}
              options={[
                { id: "system", label: ui.typeFontSystem },
                { id: "mono",   label: ui.typeFontMono },
                { id: "serif",  label: ui.typeFontSerif },
              ]}
              onChange={(id) => setTypography({ editorFont: id })}
            />
          }
        />
        <SettingRow
          title={ui.typeTabularNumbers}
          description={ui.typeTabularNumbersDesc}
          control={
            <Toggle
              checked={t.tabularNumbers}
              onChange={(v) => setTypography({ tabularNumbers: v })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.typeGroupSizes}>
        <SettingRow
          title={ui.typeBaseSize}
          control={
            <SliderRow
              value={t.baseSize} min={12} max={16} step={1}
              format={(v) => `${v}px`}
              onChange={(v) => setTypography({ baseSize: v })}
            />
          }
        />
        <SettingRow
          title={(useAppStore.getState().language === "tr") ? "Otomatik ekran ölçekleme"
            : (useAppStore.getState().language === "fr") ? "Échelle auto selon l'écran"
            : (useAppStore.getState().language === "es") ? "Escala automática por pantalla"
            : "Auto-scale with viewport"}
          description={(useAppStore.getState().language === "tr")
            ? "Yazı boyutu, daha küçük ekranlarda yumuşakça düşer. Üst sınır yukarıdaki temel boyut."
            : (useAppStore.getState().language === "fr")
            ? "La taille diminue progressivement sur les petits écrans. Plafond : la taille de base ci-dessus."
            : (useAppStore.getState().language === "es")
            ? "El tamaño baja suavemente en pantallas pequeñas. Tope: el tamaño base de arriba."
            : "Font sizes shrink gradually on smaller displays. Upper bound = base size above."}
          control={
            <Toggle
              checked={t.autoScale === true}
              onChange={(v) => setTypography({ autoScale: v })}
            />
          }
        />
        <SettingRow
          title={ui.typeEditorSize}
          control={
            <SliderRow
              value={t.editorSize} min={13} max={20} step={0.5}
              format={(v) => `${v}px`}
              onChange={(v) => setTypography({ editorSize: v })}
            />
          }
        />
        <SettingRow
          title={ui.typeHeadingScale}
          control={
            <PillGroup
              value={t.headingScale}
              options={[
                { id: "compact",  label: ui.typeHeadingCompact },
                { id: "standard", label: ui.typeHeadingStandard },
                { id: "wide",     label: ui.typeHeadingWide },
              ]}
              onChange={(id) => setTypography({ headingScale: id })}
            />
          }
        />
        <SettingRow
          title={ui.typeLineHeight}
          control={
            <SliderRow
              value={t.lineHeight} min={1.4} max={1.8} step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => setTypography({ lineHeight: v })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.typeGroupDisplay}>
        <SettingRow
          title={ui.typeAntialiasing}
          control={
            <Toggle
              checked={t.antialiasing}
              onChange={(v) => setTypography({ antialiasing: v })}
            />
          }
        />
        <SettingRow
          title={ui.typeBoldWeight}
          control={
            <PillGroup
              value={String(t.boldWeight) as "500" | "600" | "700"}
              options={[
                { id: "500", label: "500" },
                { id: "600", label: "600" },
                { id: "700", label: "700" },
              ]}
              onChange={(id) => setTypography({ boldWeight: Number(id) as 500 | 600 | 700 })}
            />
          }
        />
        <SettingRow
          title={ui.typeLetterSpacing}
          control={
            <PillGroup
              value={t.letterSpacing}
              options={[
                { id: "tight",  label: ui.typeLetterTight },
                { id: "normal", label: ui.typeLetterNormal },
                { id: "wide",   label: ui.typeLetterWide },
              ]}
              onChange={(id) => setTypography({ letterSpacing: id })}
            />
          }
        />
      </SettingGroup>
    </>
  );
}

function LayoutPage() {
  const { ui, language, layout, setLayout, resetLayout } = useAppStore();
  const l = layout;
  return (
    <>
      <SettingGroup label={ui.layoutGroupDensity}>
        <SettingRow
          title={ui.layoutDensity}
          description={ui.layoutDensityDesc}
          control={
            <PillGroup
              value={l.density}
              options={[
                { id: "compact",  label: ui.layoutDensityCompact },
                { id: "standard", label: ui.layoutDensityStandard },
                { id: "relaxed",  label: ui.layoutDensityRelaxed },
              ]}
              onChange={(id) => setLayout({ density: id })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.layoutGroupSidebar}>
        <SettingRow
          title={ui.layoutSidebarWidth}
          control={
            <SliderRow
              value={l.sidebarWidth} min={200} max={320} step={4}
              format={(v) => `${v}px`}
              onChange={(v) => setLayout({ sidebarWidth: v })}
            />
          }
        />
        <SettingRow
          title={ui.layoutSidebarShowGroups}
          control={
            <Toggle
              checked={l.sidebarShowGroupHeaders}
              onChange={(v) => setLayout({ sidebarShowGroupHeaders: v })}
            />
          }
        />
        <SettingRow
          title={language === "tr" ? "Etkin sekme kayan göstergesi" : "Sliding active indicator"}
          description={language === "tr"
            ? "Seçili menü ögesinin yanındaki şeridi smooth animasyonla taşır."
            : "Smoothly slides the bar next to the selected nav item."}
          control={
            <Toggle
              checked={l.sidebarSlideIndicator !== false}
              onChange={(v) => setLayout({ sidebarSlideIndicator: v })}
            />
          }
        />
        <SettingRow
          title={language === "tr" ? "Flow Merkezi mini haritası" : "Flow Center minimap"}
          description={language === "tr"
            ? "Flow tuvalinin sağ alt köşesindeki küçük haritayı göster."
            : "Show the small map in the bottom-right of the flow canvas."}
          control={
            <Toggle
              checked={l.flowMinimap !== false}
              onChange={(v) => setLayout({ flowMinimap: v })}
            />
          }
        />
        <SettingRow
          title={language === "tr" ? "Flow çoklu-seçim tuşu" : "Flow multi-select key"}
          description={language === "tr"
            ? "Birden fazla node'u tek tek seçmek için basılı tutulan tuş."
            : "Held to add nodes to the selection one by one."}
          control={
            <Dropdown
              value={l.flowMultiSelectKey ?? "Shift"}
              options={[
                { id: "Shift",   label: "Shift" },
                { id: "Control", label: "Ctrl" },
                { id: "Alt",     label: "Alt" },
              ]}
              onChange={(id) => setLayout({ flowMultiSelectKey: id as "Shift" | "Control" | "Alt" })}
            />
          }
        />
        <SettingRow
          title={ui.layoutSidebarCollapseHover}
          description={language === "tr"
            ? "Kenar çubuğu yalnızca simgelerle durur, sayfalara daha fazla yer kalır. Üstteki düğmeyle açılır. Pencere daraldığında bu otomatik olur."
            : "The sidebar stays as icons, giving pages more room. Open it with the button at the top. Narrow windows do this automatically."}
          control={<Toggle checked={l.sidebarCollapseOnHover === true} onChange={(v) => setLayout({ sidebarCollapseOnHover: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.layoutGroupLists}>
        <SettingRow
          title={ui.layoutTaskRowDensity}
          control={
            <PillGroup
              value={l.taskRowDensity}
              options={[
                { id: "compact",  label: ui.layoutDensityCompact },
                { id: "standard", label: ui.layoutDensityStandard },
                { id: "relaxed",  label: ui.layoutDensityRelaxed },
              ]}
              onChange={(id) => setLayout({ taskRowDensity: id })}
            />
          }
        />
        <SettingRow
          title={ui.layoutNoteRowDensity}
          control={
            <PillGroup
              value={l.noteRowDensity}
              options={[
                { id: "compact",  label: ui.layoutDensityCompact },
                { id: "standard", label: ui.layoutDensityStandard },
                { id: "relaxed",  label: ui.layoutDensityRelaxed },
              ]}
              onChange={(id) => setLayout({ noteRowDensity: id })}
            />
          }
        />
        <SettingRow
          title={ui.layoutStoreCardSize}
          control={
            <PillGroup
              value={l.storeCardSize}
              options={[
                { id: "small",  label: ui.layoutSizeSmall },
                { id: "medium", label: ui.layoutSizeMedium },
                { id: "large",  label: ui.layoutSizeLarge },
              ]}
              onChange={(id) => setLayout({ storeCardSize: id })}
            />
          }
        />
        <SettingRow
          title={ui.layoutDashboardCardHeight}
          control={
            <PillGroup
              value={l.dashboardCardHeight}
              options={[
                { id: "short",    label: ui.layoutHeightShort },
                { id: "standard", label: ui.layoutHeightStandard },
                { id: "tall",     label: ui.layoutHeightTall },
              ]}
              onChange={(id) => setLayout({ dashboardCardHeight: id })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.layoutGroupAnimation}>
        <SettingRow
          title={ui.layoutAnimSpeed}
          control={
            <Dropdown
              value={l.animationSpeed}
              options={[
                { id: "fast",     label: ui.layoutAnimFast },
                { id: "standard", label: ui.layoutAnimStandard },
                { id: "slow",     label: ui.layoutAnimSlow },
                { id: "instant",  label: ui.layoutAnimInstant },
              ]}
              onChange={(id) => setLayout({ animationSpeed: id })}
            />
          }
        />
        <SettingRow
          title={ui.layoutPageTransitions}
          control={<Toggle checked={l.pageTransitions} onChange={(v) => setLayout({ pageTransitions: v })} />}
        />
        <SettingRow
          title={ui.layoutModalAnimations}
          control={<Toggle checked={l.modalAnimations} onChange={(v) => setLayout({ modalAnimations: v })} />}
        />
        <SettingRow
          title={ui.layoutListAnimations}
          control={<Toggle checked={l.listItemAnimations} onChange={(v) => setLayout({ listItemAnimations: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.layoutGroupVisual}>
        <SettingRow
          title={ui.layoutCornerRadius}
          control={
            <PillGroup
              value={l.cornerRadius}
              options={[
                { id: "square",   label: ui.layoutRadiusSquare },
                { id: "subtle",   label: ui.layoutRadiusSubtle },
                { id: "standard", label: ui.layoutRadiusStandard },
                { id: "soft",     label: ui.layoutRadiusSoft },
              ]}
              onChange={(id) => setLayout({ cornerRadius: id })}
            />
          }
        />
        <SettingRow
          title={ui.layoutBorderWeight}
          control={
            <PillGroup
              value={l.borderWeight}
              options={[
                { id: "none",     label: ui.layoutBorderNone },
                { id: "thin",     label: ui.layoutBorderThin },
                { id: "standard", label: ui.layoutBorderStandard },
                { id: "thick",    label: ui.layoutBorderThick },
              ]}
              onChange={(id) => setLayout({ borderWeight: id })}
            />
          }
        />
        <SettingRow
          title={ui.layoutHoverEffects}
          control={<Toggle checked={l.hoverEffects} onChange={(v) => setLayout({ hoverEffects: v })} />}
        />
        <SettingRow
          title={ui.layoutFocusRing}
          description={ui.layoutFocusRingDesc}
          control={<Toggle checked={l.focusRing} onChange={(v) => setLayout({ focusRing: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={language === "tr" ? "Panel görünümü" : "Panel appearance"}>
        <SettingRow
          title={language === "tr" ? "Sayfa panellerini saydam yap" : "Transparent page panels"}
          description={language === "tr"
            ? "Dashboard, Notlar, Görevler vb. üzerindeki kart yüzeyleri saydam olur; sayfa zemini ortaya çıkar."
            : "Cards on Dashboard, Notes, Tasks, etc. become transparent so the page backdrop shows through."}
          control={<Toggle checked={l.transparentPanels} onChange={(v) => setLayout({ transparentPanels: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={language === "tr" ? "Dashboard panelleri" : "Dashboard panels"}>
        <DashboardHeroCardRow language={language} layout={l} setLayout={setLayout} />
        <DashboardPanelsRow language={language} layout={l} setLayout={setLayout} />
      </SettingGroup>

      <SettingGroup label={ui.layoutGroupReset}>
        <SettingRow
          title={ui.layoutResetAll}
          description={ui.layoutResetAllDesc}
          control={
            <CompactButton onClick={resetLayout} variant="danger">
              {ui.layoutResetAll}
            </CompactButton>
          }
        />
      </SettingGroup>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BEHAVIOR
// ─────────────────────────────────────────────────────────────────────

function GeneralPage() {
  const { ui, language, setLanguage, general, setGeneral } = useAppStore();
  const g = general;
  const CURRENCY_OPTIONS = ["USD", "EUR", "TRY", "GBP", "JPY", "CAD", "AUD", "CHF", "SEK"];
  const replayTutorial = () => {
    resetTutorial();
    window.dispatchEvent(new CustomEvent("heravex:start-tutorial"));
  };
  return (
    <>
      <SettingGroup label={ui.generalGroupLocale}>
        <SettingRow
          title={ui.generalLanguage}
          control={
            <Dropdown
              value={language}
              options={[
                { id: "en", label: "English" },
                { id: "tr", label: "Türkçe" },
                { id: "fr", label: "Français" },
                { id: "es", label: "Español" },
              ]}
              onChange={(id) => void setLanguage(id as typeof language)}
            />
          }
        />
        <SettingRow
          title={ui.generalRegionalFormat}
          control={
            <Dropdown
              value={g.regionalFormat}
              options={[
                { id: "auto", label: ui.generalRegionAuto },
                { id: "tr",   label: "Türkiye (TR)" },
                { id: "us",   label: "United States (US)" },
                { id: "eu",   label: "European Union (EU)" },
                { id: "uk",   label: "United Kingdom (UK)" },
              ]}
              onChange={(id) => setGeneral({ regionalFormat: id as typeof g.regionalFormat })}
            />
          }
        />
        <SettingRow
          title={ui.generalDefaultCurrency}
          control={
            <Dropdown
              value={g.defaultCurrency}
              options={CURRENCY_OPTIONS.map((c) => ({ id: c, label: c }))}
              onChange={(id) => setGeneral({ defaultCurrency: id })}
            />
          }
        />
        <SettingRow
          title={ui.generalDateFormat}
          control={
            <Dropdown
              value={g.dateFormat}
              options={[
                { id: "dd.mm.yyyy", label: "DD.MM.YYYY" },
                { id: "mm/dd/yyyy", label: "MM/DD/YYYY" },
                { id: "yyyy-mm-dd", label: "YYYY-MM-DD" },
              ]}
              onChange={(id) => setGeneral({ dateFormat: id as typeof g.dateFormat })}
            />
          }
        />
        <SettingRow
          title={ui.generalTimeFormat}
          control={
            <PillGroup
              value={g.timeFormat}
              options={[
                { id: "12h", label: "12h" },
                { id: "24h", label: "24h" },
              ]}
              onChange={(id) => setGeneral({ timeFormat: id as typeof g.timeFormat })}
            />
          }
        />
        <SettingRow
          title={ui.generalNumberFormat}
          control={
            <PillGroup
              value={g.numberFormat}
              options={[
                { id: "comma",  label: "1.000,00" },
                { id: "period", label: "1,000.00" },
                { id: "space",  label: "1 000,00" },
              ]}
              onChange={(id) => setGeneral({ numberFormat: id as typeof g.numberFormat })}
            />
          }
        />
        <SettingRow
          title={ui.generalCurrencyPosition}
          control={
            <PillGroup
              value={g.currencyPosition}
              options={[
                { id: "before", label: ui.generalCurrencyBefore },
                { id: "after",  label: ui.generalCurrencyAfter },
              ]}
              onChange={(id) => setGeneral({ currencyPosition: id as typeof g.currencyPosition })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.generalGroupBehaviour}>
        {/* Autosave interval row removed — Backup → Schedule covers the
            same concern at the right place, and the previous row gave
            the impression of two separate persistence layers. The
            slice field is kept for back-compat. */}
        <SettingRow
          title={ui.generalWarnEmptyTitle}
          control={<Toggle checked={g.warnOnEmptyTitle} onChange={(v) => setGeneral({ warnOnEmptyTitle: v })} />}
        />
        <SettingRow
          title={ui.generalConfirmDelete}
          control={<Toggle checked={g.confirmOnDelete} onChange={(v) => setGeneral({ confirmOnDelete: v })} />}
        />
        <SettingRow
          title={ui.generalConfirmBatch}
          control={<Toggle checked={g.confirmOnBatch} onChange={(v) => setGeneral({ confirmOnBatch: v })} />}
        />
        <SettingRow
          title={language === "tr" ? "Hızlı yakalama balonu" : "Quick capture widget"}
          description={language === "tr"
            ? "Sağ alt köşede yüzen \"+\" butonuyla anında not / görev oluştur."
            : "Floating \"+\" button in the bottom-right for instant note / task capture."}
          control={<Toggle checked={g.quickCapture !== false} onChange={(v) => setGeneral({ quickCapture: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={language === "tr" ? "Yardım & Tanıtım" : "Help & Onboarding"}>
        <SettingRow
          title={TUTORIAL_UI[language].startTitle}
          description={ui.aboutTutorialDesc}
          control={
            <CompactButton onClick={replayTutorial}>
              <Sparkles size={11} style={{ marginRight: 4 }} />
              {language === "tr" ? "Tekrar aç" : "Reopen"}
            </CompactButton>
          }
        />
      </SettingGroup>
    </>
  );
}

function StartupPage() {
  const { ui, startup, setStartup, general, setGeneral, language } = useAppStore();
  const s = startup;
  const trT = (en: string, tr: string) => (language === "tr" ? tr : en);
  // Use the existing top-level i18n keys for page labels — saves us a
  // dozen extra translation entries since these names are already
  // localised on the main sidebar.
  const initialPageOptions = [
    { id: "dashboard" as const, label: ui.dashboard },
    { id: "library"   as const, label: ui.library },
    { id: "storehub"  as const, label: ui.storeHub },
    { id: "tasks"     as const, label: ui.taskCenter },
    { id: "notes"     as const, label: ui.notebook },
    { id: "calendar"  as const, label: ui.calendar },
    { id: "wallet"    as const, label: ui.wallet },
    { id: "analytics" as const, label: ui.analytics },
    { id: "lastOpen"  as const, label: ui.startupLastOpen },
  ];
  return (
    <>
      <SettingGroup label={ui.startupGroupLaunch}>
        <SettingRow
          title={ui.startupInitialPage}
          control={
            <Dropdown
              value={s.initialPage}
              options={initialPageOptions}
              onChange={(id) => setStartup({ initialPage: id as typeof s.initialPage })}
            />
          }
        />
        <SettingRow
          title={ui.startupRestoreLastGame}
          control={<Toggle checked={s.restoreLastActiveGame} onChange={(v) => setStartup({ restoreLastActiveGame: v })} />}
        />
        <SettingRow
          title={ui.startupShowTutorial}
          description={ui.startupShowTutorialDesc}
          control={<Toggle checked={s.showTutorial} onChange={(v) => setStartup({ showTutorial: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.startupGroupWindow}>
        <SettingRow
          title={ui.startupRememberPosition}
          badge={ui.startupRestartBadge}
          control={<Toggle checked={s.rememberPosition} onChange={(v) => setStartup({ rememberPosition: v })} />}
        />
        <SettingRow
          title={ui.startupRememberSize}
          badge={ui.startupRestartBadge}
          control={<Toggle checked={s.rememberSize} onChange={(v) => setStartup({ rememberSize: v })} />}
        />
        <SettingRow
          title={ui.startupAlwaysOnTop}
          badge={ui.startupRestartBadge}
          control={<Toggle checked={s.alwaysOnTop} onChange={(v) => setStartup({ alwaysOnTop: v })} />}
        />
        <SettingRow
          title={ui.startupMinimiseTray}
          description={trT(
            "Minimising hides HeraVex to the tray icon (bottom-right) instead of the taskbar. Click the icon to bring it back.",
            "Küçültünce HeraVex görev çubuğu yerine sağ alttaki simge alanına gizlenir. Geri açmak için simgeye tıkla.",
          )}
          control={<Toggle checked={s.minimiseToTray} onChange={(v) => setStartup({ minimiseToTray: v })} />}
        />
        <SettingRow
          title={ui.startupCloseTray}
          description={trT(
            "Closing the window keeps HeraVex running in the tray. Team sync and Pomodoro keep going. Right-click the tray icon and choose Quit to exit.",
            "Pencereyi kapatınca HeraVex sağ alttaki simge alanında çalışmaya devam eder. Ekip eşitlemesi ve Pomodoro durmaz. Tamamen kapatmak için simgeye sağ tıklayıp Çıkış'ı seç.",
          )}
          control={<Toggle checked={general.closeToTray !== false} onChange={(v) => setGeneral({ closeToTray: v })} />}
        />
        <SettingRow
          title={ui.startupMultiWindow}
          description={trT(
            "Open more HeraVex windows (Ctrl+Shift+O), e.g. notes on one screen and tasks on the other. A save in one window shows up in the others.",
            "Birden fazla HeraVex penceresi aç (Ctrl+Shift+O), örneğin bir ekranda notlar diğerinde görevler. Bir pencerede kaydedilen diğerlerinde de görünür.",
          )}
          control={
            <div className="setting-inline-pair">
              {s.multiWindow && (
                <CompactButton
                  onClick={() => void invoke("open_app_window", { tab: null }).catch((err) => useAppStore.getState().showError(err))}
                >
                  {trT("New window", "Yeni pencere")}
                </CompactButton>
              )}
              <Toggle checked={s.multiWindow} onChange={(v) => setStartup({ multiWindow: v })} />
            </div>
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.startupGroupPerf}>
        <SettingRow
          title={ui.startupGpu}
          badge={ui.startupRestartBadge}
          control={<Toggle checked={s.gpuAcceleration} onChange={(v) => setStartup({ gpuAcceleration: v })} />}
        />
        <SettingRow
          title={ui.startupLowPower}
          control={<Toggle checked={s.lowPowerOnBattery} onChange={(v) => setStartup({ lowPowerOnBattery: v })} />}
        />
        <SettingRow
          title={ui.startupBackgroundTasks}
          control={<Toggle checked={s.backgroundTasks} onChange={(v) => setStartup({ backgroundTasks: v })} />}
        />
      </SettingGroup>
    </>
  );
}

function KeyboardPage() {
  const { ui, language, showToast } = useAppStore();
  const [defs, setDefs] = useState<Record<ShortcutAction, ShortcutDef>>(() => loadShortcuts());
  // External edits (another tab, reset) refresh this page live.
  useEffect(() => {
    const onUpdate = () => setDefs(loadShortcuts());
    window.addEventListener("heravex:shortcuts-updated", onUpdate);
    return () => window.removeEventListener("heravex:shortcuts-updated", onUpdate);
  }, []);

  const isMac = detectMac();
  const conflicts = findShortcutConflicts(defs);
  const fmt = (combo: string) => formatCombo(combo, isMac);

  const update = (action: ShortcutAction, combo: string) => {
    const next = { ...defs, [action]: { ...defs[action], combo } };
    setDefs(next);
    saveShortcuts(next);
  };
  const handleReset = () => {
    resetShortcuts();
    setDefs(loadShortcuts());
    showToast(ui.keyboardResetDone, "success");
  };
  const handleExport = () => {
    try {
      const json = exportShortcutsJson(defs);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "heravex-shortcuts.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.warn("[shortcuts] export failed:", err);
      const lang = useAppStore.getState().language;
      const msg = lang === "tr"
        ? "Kısayollar dışa aktarılamadı."
        : lang === "fr"
        ? "Échec de l'export des raccourcis."
        : lang === "es"
        ? "No se pudieron exportar los atajos."
        : "Shortcut export failed.";
      useAppStore.getState().showToast(msg, "error");
    }
  };

  const groupLabelKey: Record<typeof SHORTCUT_GROUPS[number]["id"], string> = {
    navigation: "keyboardGroupNavigation",
    create:     "keyboardGroupCreate",
    actions:    "keyboardGroupActions",
  };

  return (
    <>
      {conflicts.size > 0 && (
        <div className="settings-conflict-banner">
          {ui.keyboardConflict}
        </div>
      )}

      {SHORTCUT_GROUPS.map((group) => (
        <SettingGroup key={group.id} label={ui[groupLabelKey[group.id] as keyof typeof ui] as string}>
          {group.ids.map((id) => (
            <SettingRow
              key={id}
              title={actionLabel(id, language)}
              badge={conflicts.has(id) ? ui.keyboardConflictBadge : undefined}
              control={
                <KeyComboButton
                  combo={defs[id].combo}
                  format={fmt}
                  onChange={(next) => update(id, next)}
                />
              }
            />
          ))}
        </SettingGroup>
      ))}

      <SettingGroup label={ui.keyboardGroupManage}>
        <SettingRow
          title={ui.keyboardResetAll}
          description={ui.keyboardResetAllDesc}
          control={<CompactButton onClick={handleReset} variant="danger">{ui.keyboardResetAll}</CompactButton>}
        />
        <SettingRow
          title={ui.keyboardExport}
          description={ui.keyboardExportDesc}
          control={<CompactButton onClick={handleExport}>{ui.keyboardExportButton}</CompactButton>}
        />
        {/* Helper row so the user sees the defaults at a glance. */}
        <SettingRow
          title={ui.keyboardDefaultsHint}
          description={Object.keys(DEFAULT_SHORTCUTS).length + " " + ui.keyboardDefaultsHintCount}
        />
      </SettingGroup>
    </>
  );
}

function PomodoroPage() {
  const { ui, pomodoroPrefs, setPomodoroPrefs, language } = useAppStore();
  const p = pomodoroPrefs;
  return (
    <>
      <SettingGroup label={ui.pomoGroupDurations}>
        <SettingRow
          title={ui.pomoFocus}
          control={
            <SliderRow
              value={p.focusMinutes} min={15} max={60} step={5}
              format={(v) => `${v} ${ui.pomoMin}`}
              onChange={(v) => setPomodoroPrefs({ focusMinutes: v })}
            />
          }
        />
        <SettingRow
          title={ui.pomoShortBreak}
          control={
            <SliderRow
              value={p.shortBreakMinutes} min={3} max={15} step={1}
              format={(v) => `${v} ${ui.pomoMin}`}
              onChange={(v) => setPomodoroPrefs({ shortBreakMinutes: v })}
            />
          }
        />
        <SettingRow
          title={ui.pomoLongBreak}
          control={
            <SliderRow
              value={p.longBreakMinutes} min={15} max={30} step={5}
              format={(v) => `${v} ${ui.pomoMin}`}
              onChange={(v) => setPomodoroPrefs({ longBreakMinutes: v })}
            />
          }
        />
        <SettingRow
          title={ui.pomoCadence}
          description={ui.pomoCadenceDesc}
          control={
            <SliderRow
              value={p.longBreakCadence} min={2} max={5} step={1}
              format={(v) => `${v}`}
              onChange={(v) => setPomodoroPrefs({ longBreakCadence: v })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.pomoGroupBehaviour}>
        <SettingRow
          title={ui.pomoAutoStart}
          control={<Toggle checked={p.autoStartNextPomodoro} onChange={(v) => setPomodoroPrefs({ autoStartNextPomodoro: v })} />}
        />
        <SettingRow
          title={ui.pomoAutoResume}
          control={<Toggle checked={p.autoResumeAfterBreak} onChange={(v) => setPomodoroPrefs({ autoResumeAfterBreak: v })} />}
        />
        <SettingRow
          title={ui.pomoMarkDone}
          control={<Toggle checked={p.markTaskDoneOnCompletion} onChange={(v) => setPomodoroPrefs({ markTaskDoneOnCompletion: v })} />}
        />
        <SettingRow
          title={ui.pomoLockApp}
          description={language === "tr"
            ? "Mola başlayınca uygulamanın üstüne geri sayım gelir ve mola bitene kadar kullanılamaz. Acil durumda \"Molayı atla\" düğmesini basılı tutabilirsin."
            : "When a break starts, a countdown covers the app until the break is over. In an emergency, hold \"Skip break\"."}
          control={<Toggle checked={p.lockAppDuringBreak} onChange={(v) => setPomodoroPrefs({ lockAppDuringBreak: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.pomoGroupVisual}>
        <SettingRow
          title={ui.pomoVisibility}
          control={
            <Dropdown
              value={p.visibility}
              options={[
                { id: "always",         label: ui.pomoVisibilityAlways },
                { id: "whenTaskOpen",   label: ui.pomoVisibilityTask },
                { id: "sidebarWidget",  label: ui.pomoVisibilityWidget },
              ]}
              onChange={(id) => setPomodoroPrefs({ visibility: id as typeof p.visibility })}
            />
          }
        />
        <SettingRow
          title={ui.pomoStyle}
          control={
            <PillGroup
              value={p.style}
              options={[
                { id: "numeric", label: ui.pomoStyleNumeric },
                { id: "bar",     label: ui.pomoStyleBar },
                { id: "circle",  label: ui.pomoStyleCircle },
              ]}
              onChange={(id) => setPomodoroPrefs({ style: id as typeof p.style })}
            />
          }
        />
        <SettingRow
          title={ui.pomoPosition}
          control={
            <Dropdown
              value={p.position}
              options={[
                { id: "topRight",   label: ui.pomoPosTopRight },
                { id: "bottomLeft", label: ui.pomoPosBottomLeft },
                { id: "floating",   label: ui.pomoPosFloating },
              ]}
              onChange={(id) => setPomodoroPrefs({ position: id as typeof p.position })}
            />
          }
        />
      </SettingGroup>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────

function StoragePage() {
  const { ui, language, showError, showToast, refreshGames, backupPrefs, setBackupPrefs } = useAppStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<OrphanImage[] | null>(null);
  const [confirmOrphans, setConfirmOrphans] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [workspacePath, setWorkspacePathState] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const reload = async () => {
    setLoading(true);
    try {
      const [s, wp] = await Promise.all([computeStorageStats(), getWorkspacePath()]);
      setStats(s);
      setWorkspacePathState(wp ?? "");
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, []);

  const openFolder = async () => {
    if (!workspacePath) return;
    try { await revealInFolder(workspacePath); } catch (err) { showError(err); }
  };

  // Move/change data folder — picks a new directory, points the Rust
  // workspace_path at it (copying games.json/notes.json across if the
  // target is empty), then reloads the in-memory game cache so the
  // page reflects the move without a restart.
  const moveDataFolder = async () => {
    setMoving(true);
    try {
      const dir = await pickDirectory();
      if (!dir) return; // user cancelled
      await setWorkspacePath(dir);
      setWorkspacePathState(dir);
      await refreshGames();
      await reload();
      showToast(tr("Data folder moved.", "Veri klasörü taşındı."), "success");
    } catch (err) {
      const msg = String(err);
      if (!msg.toLowerCase().includes("iptal") && !msg.toLowerCase().includes("cancel")) {
        showError(err);
      }
    } finally {
      setMoving(false);
    }
  };

  // ── Maintenance tools ──────────────────────────────────────────────
  const cleanedText = (r: CleanResult) =>
    r.files === 0
      ? tr("Nothing to clean.", "Temizlenecek bir şey yok.")
      : tr(`Removed ${r.files} file(s), ${formatBytes(r.bytes)} freed.`, `${r.files} dosya silindi, ${formatBytes(r.bytes)} yer açıldı.`);
  const runTool = async (id: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    try { await fn(); } catch (err) { showError(err); } finally { setBusy(null); }
  };
  const clearCache = () => runTool("cache", async () => {
    const r = await storageClearCache();
    showToast(cleanedText(r), r.files ? "success" : "info");
    void reload();
  });
  const removeTemp = () => runTool("temp", async () => {
    const r = await storageRemoveTemp();
    showToast(cleanedText(r), r.files ? "success" : "info");
    void reload();
  });
  const scanOrphans = () => runTool("orphans", async () => {
    setOrphans(await storageFindOrphanImages());
  });
  const deleteOrphans = () => runTool("orphans", async () => {
    setConfirmOrphans(false);
    const r = await storageDeleteOrphanImages((orphans ?? []).map((o) => o.path));
    showToast(cleanedText(r), r.files ? "success" : "info");
    setOrphans(await storageFindOrphanImages());
    void reload();
  });
  const checkIntegrity = () => runTool("integrity", async () => {
    setIntegrity(await storageIntegrityCheck());
  });
  const pruneNow = () => runTool("prune", async () => {
    const r = await storagePruneBuilds(Math.max(1, backupPrefs.buildsToKeep || 5));
    showToast(
      r.files === 0
        ? tr("No old build files to remove.", "Silinecek eski build dosyası yok.")
        : tr(`Removed old builds from ${r.games} game(s), ${formatBytes(r.bytes)} freed.`,
             `${r.games} oyunun eski build dosyaları silindi, ${formatBytes(r.bytes)} yer açıldı.`),
      r.files ? "success" : "info",
    );
    await refreshGames();
    void reload();
  });
  const problemLabel: Record<string, [string, string]> = {
    unreadable:   ["Can't be read", "Okunamıyor"],
    corrupt:      ["Damaged file", "Bozuk dosya"],
    missingCover: ["Cover image missing", "Kapak görseli eksik"],
    missingImage: ["Moodboard image missing", "Moodboard görseli eksik"],
    missingBuild: ["Build file missing", "Build dosyası eksik"],
    duplicateId:  ["Same id twice", "Aynı kimlik iki kez"],
    tempLeftover: ["Leftover temporary files", "Artık geçici dosya"],
  };
  const orphanBytes = (orphans ?? []).reduce((a, o) => a + o.sizeBytes, 0);

  const resetDataFolder = async () => {
    setMoving(true);
    try {
      await clearWorkspacePath();
      setWorkspacePathState("");
      await refreshGames();
      await reload();
      showToast(tr("Reverted to default folder.", "Varsayılan klasöre dönüldü."), "info");
    } catch (err) {
      showError(err);
    } finally {
      setMoving(false);
    }
  };

  return (
    <>
      <SettingGroup label={ui.storageGroupLocation}>
        <SettingRow
          title={ui.storageDataFolder}
          description={workspacePath || ui.storageDataFolderDefault}
          control={
            <div style={{ display: "inline-flex", gap: 6 }}>
              <CompactButton onClick={() => void openFolder()} disabled={!workspacePath}>
                {ui.storageOpen}
              </CompactButton>
              <CompactButton onClick={() => void reload()}>
                {loading ? "…" : ui.storageRefresh}
              </CompactButton>
            </div>
          }
        />
        <SettingRow
          title={tr("Move / change data folder", "Veri klasörünü taşı / değiştir")}
          description={tr(
            "Point HeraVex at a different folder (e.g. a Drive-synced directory). Existing games.json / notes.json are copied across if the target is empty.",
            "HeraVex'i farklı bir klasöre yönlendir (örn. Drive-senkronlu bir dizin). Hedef boşsa games.json / notes.json otomatik kopyalanır.",
          )}
          control={
            <div style={{ display: "inline-flex", gap: 6 }}>
              <CompactButton onClick={() => void moveDataFolder()} disabled={moving}>
                {moving ? "…" : tr("Pick folder", "Klasör seç")}
              </CompactButton>
              {workspacePath && (
                <CompactButton onClick={() => void resetDataFolder()} disabled={moving} variant="danger">
                  {tr("Reset", "Sıfırla")}
                </CompactButton>
              )}
            </div>
          }
        />
        <SettingRow
          title={ui.storageTotalUsage}
          control={
            <span className="setting-version-tag setting-version-tag-muted">
              {stats ? `${formatBytes(stats.totalBytes)} · ${stats.fileCount} ${ui.storageFiles}` : "…"}
            </span>
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.storageGroupMaintenance}>
        <SettingRow
          title={ui.storageClearCache}
          description={tr(
            "Store Center's saved copy of store numbers. Fresh numbers are downloaded on the next refresh.",
            "Mağaza Merkezi'nin kaydettiği mağaza verileri. Bir sonraki yenilemede yeniden indirilir.",
          )}
          control={<CompactButton onClick={() => void clearCache()} disabled={!!busy}>{busy === "cache" ? "…" : tr("Clear", "Temizle")}</CompactButton>}
        />
        <SettingRow
          title={ui.storageRemoveTemp}
          description={tr(
            "Half-written files left by an interrupted save or backup. Files from the last 10 minutes are kept.",
            "Yarıda kalan kayıt veya yedeklerden kalan dosyalar. Son 10 dakikadakiler korunur.",
          )}
          control={<CompactButton onClick={() => void removeTemp()} disabled={!!busy}>{busy === "temp" ? "…" : tr("Remove", "Sil")}</CompactButton>}
        />
        <SettingRow
          title={ui.storageOrphanMoodboard}
          description={tr(
            "Cover and moodboard images no game, note or flow uses any more. You see the list before anything is deleted.",
            "Hiçbir oyun, not veya akışın artık kullanmadığı kapak ve moodboard görselleri. Silmeden önce listeyi görürsün.",
          )}
          control={<CompactButton onClick={() => void scanOrphans()} disabled={!!busy}>{busy === "orphans" ? "…" : tr("Scan", "Tara")}</CompactButton>}
        />
        {orphans && (
          <div className="setting-result" role="status">
            {orphans.length === 0 ? (
              <span>{tr("No unused images found.", "Kullanılmayan görsel bulunmadı.")}</span>
            ) : (
              <>
                <div className="setting-result-head">
                  <span>
                    {tr(`${orphans.length} unused image(s), ${formatBytes(orphanBytes)}`,
                        `${orphans.length} kullanılmayan görsel, ${formatBytes(orphanBytes)}`)}
                  </span>
                  <CompactButton variant="danger" onClick={() => setConfirmOrphans(true)} disabled={!!busy}>
                    {tr("Delete all", "Hepsini sil")}
                  </CompactButton>
                </div>
                <ul className="setting-result-list">
                  {orphans.slice(0, 8).map((o) => (
                    <li key={o.path}><code>{o.relative}</code><span>{formatBytes(o.sizeBytes)}</span></li>
                  ))}
                  {orphans.length > 8 && <li className="is-more">{tr(`+${orphans.length - 8} more`, `+${orphans.length - 8} tane daha`)}</li>}
                </ul>
                <span className="setting-result-note">
                  {tr("Images changed in the last 24 hours are never listed (a teammate's sync may still be arriving).",
                      "Son 24 saatte değişen görseller listelenmez (takım arkadaşının eşitlemesi hâlâ geliyor olabilir).")}
                </span>
              </>
            )}
          </div>
        )}
        <SettingRow
          title={ui.storageIntegrityCheck}
          description={tr(
            "Reads every record and checks that the images and builds they point to exist. Changes nothing.",
            "Tüm kayıtları okur, işaret ettikleri görsel ve build dosyalarının yerinde olup olmadığına bakar. Hiçbir şeyi değiştirmez.",
          )}
          control={<CompactButton onClick={() => void checkIntegrity()} disabled={!!busy}>{busy === "integrity" ? "…" : tr("Check", "Kontrol et")}</CompactButton>}
        />
        {integrity && (
          <div className={"setting-result" + (integrity.problems.length ? " is-warning" : " is-ok")} role="status">
            {integrity.problems.length === 0 ? (
              <span>{tr(`${integrity.checkedFiles} records checked. No problems found.`,
                        `${integrity.checkedFiles} kayıt kontrol edildi. Sorun bulunmadı.`)}</span>
            ) : (
              <>
                <div className="setting-result-head">
                  <span>{tr(`${integrity.checkedFiles} records checked, ${integrity.problems.length} problem(s):`,
                            `${integrity.checkedFiles} kayıt kontrol edildi, ${integrity.problems.length} sorun:`)}</span>
                </div>
                <ul className="setting-result-list">
                  {integrity.problems.slice(0, 20).map((p, i) => (
                    <li key={i}>
                      <strong>{tr(...problemLabel[p.kind] ?? [p.kind, p.kind])}</strong>
                      <span>
                        {p.kind === "tempLeftover"
                          ? tr(`${p.detail} file(s) — use "Remove temporary files" above`, `${p.detail} dosya — yukarıdaki "Geçici dosyaları sil" ile temizlenir`)
                          : [p.file, p.detail].filter(Boolean).join(" — ")}
                      </span>
                    </li>
                  ))}
                  {integrity.problems.length > 20 && <li className="is-more">{tr(`+${integrity.problems.length - 20} more`, `+${integrity.problems.length - 20} tane daha`)}</li>}
                </ul>
              </>
            )}
          </div>
        )}
      </SettingGroup>

      <SettingGroup label={ui.storageGroupAutoMaintenance}>
        <SettingRow
          title={ui.storageAutoPrune}
          description={tr(
            "When you add a version, build files of older versions are deleted. The version entries and notes stay; the current build is never removed. In a team folder this affects everyone.",
            "Yeni sürüm eklediğinde eski sürümlerin build dosyaları silinir. Sürüm kayıtları ve notları kalır, aktif build asla silinmez. Takım klasöründe herkesi etkiler.",
          )}
          control={<Toggle checked={backupPrefs.autoPruneBuilds} onChange={(v) => setBackupPrefs({ autoPruneBuilds: v })} />}
        />
        <SettingRow
          title={ui.storageVersionsKeep}
          description={tr("Newest builds kept per game.", "Her oyun için tutulacak en yeni build sayısı.")}
          control={
            <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <SliderRow
                value={backupPrefs.buildsToKeep || 5}
                min={1}
                max={20}
                onChange={(v) => setBackupPrefs({ buildsToKeep: v })}
              />
              <CompactButton onClick={() => void pruneNow()} disabled={!!busy}>
                {busy === "prune" ? "…" : tr("Clean now", "Şimdi temizle")}
              </CompactButton>
            </div>
          }
        />
      </SettingGroup>

      {confirmOrphans && orphans && (
        <ConfirmDialog
          danger
          title={tr("Delete unused images?", "Kullanılmayan görseller silinsin mi?")}
          body={tr(`${orphans.length} image(s), ${formatBytes(orphanBytes)}. This can't be undone; a backup restores them.`,
                   `${orphans.length} görsel, ${formatBytes(orphanBytes)}. Geri alınamaz; bir yedekten geri yüklenebilir.`)}
          confirmLabel={tr("Delete", "Sil")}
          cancelLabel={tr("Cancel", "Vazgeç")}
          onConfirm={() => void deleteOrphans()}
          onCancel={() => setConfirmOrphans(false)}
        />
      )}
    </>
  );
}

/** Inline horizontal bar chart for the storage breakdown. */
function StorageBar({ stats }: { stats: StorageStats }) {
  const total = Math.max(1, stats.totalBytes);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="storage-bar" title={`${formatBytes(stats.totalBytes)} total`}>
      <span className="storage-bar-fill" style={{ width: seg(stats.gamesBytes),     background: "var(--accent)" }} />
      <span className="storage-bar-fill" style={{ width: seg(stats.notesBytes),     background: "var(--status-info)" }} />
      <span className="storage-bar-fill" style={{ width: seg(stats.moodboardBytes), background: "var(--status-warning)" }} />
      <span className="storage-bar-fill" style={{ width: seg(stats.backupsBytes),   background: "var(--status-success)" }} />
      <span className="storage-bar-fill" style={{ width: seg(stats.otherBytes),     background: "rgba(255,255,255,0.18)" }} />
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function BackupPage() {
  const {
    ui, backupPrefs, setBackupPrefs,
    handleExportBackup, handleImportBackup, refreshGames,
    showError, showToast,
  } = useAppStore();
  const b = backupPrefs;
  const { language } = useAppStore();
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const [history, setHistory] = useState<BackupEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verified, setVerified] = useState<{ name: string; report: BackupVerifyReport } | null>(null);

  const pickMirror = async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setBackupPrefs({ mirrorPath: dir, mirrorToCloud: true });
    } catch (err) {
      const msg = String(err).toLowerCase();
      if (!msg.includes("iptal") && !msg.includes("cancel")) showError(err);
    }
  };
  const toggleMirror = (on: boolean) => {
    if (on && !b.mirrorPath) { void pickMirror(); return; }
    setBackupPrefs({ mirrorToCloud: on });
  };
  const runVerify = async (entry: BackupEntry) => {
    setVerifying(entry.path);
    try {
      setVerified({ name: entry.name, report: await verifyBackup(entry.path) });
    } catch (err) {
      showError(err);
    } finally {
      setVerifying(null);
    }
  };

  const reloadHistory = async () => {
    setLoadingHistory(true);
    try { setHistory(await listBackups()); }
    catch (err) { showError(err); }
    finally { setLoadingHistory(false); }
  };
  useEffect(() => { void reloadHistory(); /* eslint-disable-next-line */ }, []);

  return (
    <>
      <SettingGroup label={ui.backupGroupAuto}>
        <SettingRow
          title={ui.backupSchedule}
          description={ui.backupScheduleDesc}
          control={
            <Dropdown
              value={b.schedule}
              options={[
                { id: "off",    label: ui.backupOff },
                { id: "hourly", label: ui.backupHourly },
                { id: "daily",  label: ui.backupDaily },
                { id: "weekly", label: ui.backupWeekly },
              ]}
              onChange={(id) => setBackupPrefs({ schedule: id as typeof b.schedule })}
            />
          }
        />
        {b.schedule !== "off" && b.schedule !== "hourly" && (
          <SettingRow
            title={ui.backupTime}
            control={
              <input
                type="time"
                className="setting-text-input"
                style={{ width: 90 }}
                value={b.scheduledTime}
                onChange={(e) => setBackupPrefs({ scheduledTime: e.target.value })}
              />
            }
          />
        )}
        <SettingRow
          title={ui.backupOnlyWhileOpen}
          description={ui.backupOnlyWhileOpenDesc}
          control={<Toggle checked={b.onlyWhileOpen} onChange={(v) => setBackupPrefs({ onlyWhileOpen: v })} />}
        />
        <SettingRow
          title={ui.backupMirrorCloud}
          description={b.mirrorPath
            ? tr(`Each backup is also copied to: ${b.mirrorPath}`, `Her yedek ayrıca şuraya kopyalanır: ${b.mirrorPath}`)
            : tr("Copy each backup to a folder of your choice, e.g. inside Dropbox or Google Drive.",
                 "Her yedeği seçtiğin bir klasöre de kopyala, örneğin Dropbox veya Google Drive içinde.")}
          control={
            <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              {b.mirrorPath && (
                <CompactButton onClick={() => void pickMirror()}>{tr("Change", "Değiştir")}</CompactButton>
              )}
              <Toggle checked={b.mirrorToCloud && !!b.mirrorPath} onChange={toggleMirror} />
            </div>
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.backupGroupRetention}>
        <SettingRow
          title={ui.backupRetention}
          description={tr("Older automatic backups are deleted. Manual backups are never deleted for you.",
                          "Daha eski otomatik yedekler silinir. Elle aldığın yedeklere dokunulmaz.")}
          control={
            <SliderRow
              value={b.retentionCount} min={3} max={30} step={1}
              format={(v) => String(v)}
              onChange={(v) => setBackupPrefs({ retentionCount: v })}
            />
          }
        />
        <SettingRow
          title={ui.backupCompressOld}
          description={tr("Re-packs all but the newest 3 backups at maximum compression. Each one is checked before it replaces the original.",
                          "En yeni 3 yedek dışındakileri en yüksek sıkıştırmayla yeniden paketler. Her biri, eskisinin yerine geçmeden önce kontrol edilir.")}
          control={<Toggle checked={b.compressOld} onChange={(v) => setBackupPrefs({ compressOld: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.backupGroupManual}>
        <SettingRow
          title={ui.backupCreateNow}
          control={
            <CompactButton onClick={async () => {
              await handleExportBackup();
              await reloadHistory();
            }}>
              {ui.backupCreateNowBtn}
            </CompactButton>
          }
        />
        <SettingRow
          title={ui.backupRestore}
          description={ui.backupRestoreDesc}
          control={
            <CompactButton onClick={async () => {
              await handleImportBackup();
              await refreshGames();
              await reloadHistory();
            }}>
              {ui.backupRestoreBtn}
            </CompactButton>
          }
        />
        <SettingRow
          title={ui.backupVerify}
          description={tr("Reads the newest backup end to end and checks it can be restored. Changes nothing.",
                          "En yeni yedeği baştan sona okur ve geri yüklenebilir olduğunu kontrol eder. Hiçbir şeyi değiştirmez.")}
          control={
            <CompactButton onClick={() => history[0] && void runVerify(history[0])} disabled={!history.length || !!verifying}>
              {verifying ? "…" : tr("Verify latest", "Son yedeği doğrula")}
            </CompactButton>
          }
        />
        {verified && (
          <div className={"setting-result" + (verified.report.ok ? " is-ok" : " is-warning")} role="status">
            <div className="setting-result-head">
              <span>
                {verified.report.ok
                  ? tr(`${verified.name} is intact and can be restored.`, `${verified.name} sağlam ve geri yüklenebilir.`)
                  : tr(`${verified.name} has problems:`, `${verified.name} sorunlu:`)}
              </span>
            </div>
            {verified.report.ok ? (
              <span className="setting-result-note">
                {tr(`${verified.report.games} games, ${verified.report.notes} notes, ${verified.report.files} files${verified.report.hasWallet ? ", wallet" : ""}.`,
                    `${verified.report.games} oyun, ${verified.report.notes} not, ${verified.report.files} dosya${verified.report.hasWallet ? ", cüzdan" : ""}.`)}
              </span>
            ) : (
              <ul className="setting-result-list">
                {verified.report.problems.slice(0, 10).map((p, i) => <li key={i}><span>{p}</span></li>)}
              </ul>
            )}
          </div>
        )}
      </SettingGroup>

      <SettingGroup label={ui.backupGroupHistory}>
        {history.length === 0 ? (
          <SettingRow
            title={loadingHistory ? "…" : ui.backupHistoryEmpty}
            description={ui.backupHistoryEmptyDesc}
          />
        ) : (
          history.map((entry) => (
            <SettingRow
              key={entry.path}
              title={
                <span className="backup-history-name">
                  {entry.name}
                  <span className={`backup-history-kind ${entry.isAuto ? "is-auto" : "is-manual"}`}>
                    {entry.isAuto ? ui.backupKindAuto : ui.backupKindManual}
                  </span>
                </span>
              }
              description={`${formatBytes(entry.sizeBytes)} · ${formatRelative(entry.createdAt)}`}
              control={
                <div style={{ display: "inline-flex", gap: 6 }}>
                  <CompactButton onClick={() => void runVerify(entry)} disabled={!!verifying}>
                    {verifying === entry.path ? "…" : tr("Verify", "Doğrula")}
                  </CompactButton>
                  <CompactButton
                    onClick={async () => {
                      try {
                        await handleImportBackup(entry.path);
                        await reloadHistory();
                      } catch (err) { showError(err); }
                    }}
                  >
                    {ui.backupRestoreBtn}
                  </CompactButton>
                  <CompactButton
                    variant="danger"
                    onClick={async () => {
                      try {
                        await deleteBackup(entry.path);
                        showToast(ui.backupDeleted, "success");
                        await reloadHistory();
                      } catch (err) { showError(err); }
                    }}
                  >
                    {ui.backupDelete}
                  </CompactButton>
                </div>
              }
            />
          ))
        )}
      </SettingGroup>
    </>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h ago`;
  return d.toLocaleDateString();
}

// ─────────────────────────────────────────────────────────────────────
// CONNECTIONS
// ─────────────────────────────────────────────────────────────────────

function ApiKeysPage() {
  const {
    ui, language,
    steamApiKey, itchApiKey, steamUserId, googlePlayJsonPath,
    handleSaveApiKeys, showToast, showError,
  } = useAppStore();

  // Local drafts so the user can edit without spamming saveApiKeys
  // on every keystroke. Persisted on blur / "Save all" / Test click.
  // Background sync interval per store (lib/storeSync).
  const [syncPrefs, setSyncPrefs] = useState<StoreSyncPrefs>(() => loadStoreSyncPrefs());
  const setSync = (p: StoreProvider, minutes: number) => {
    const next = { ...syncPrefs, [p]: minutes };
    setSyncPrefs(next);
    saveStoreSyncPrefs(next);
  };
  const syncLabel = (m: number) => {
    const tr = language === "tr";
    if (m === 0) return tr ? "Kapalı (yalnız elle)" : "Off (manual only)";
    if (m < 60) return tr ? `${m} dakikada bir` : `Every ${m} min`;
    if (m === 60) return tr ? "Saatte bir" : "Every hour";
    if (m < 1440) return tr ? `${m / 60} saatte bir` : `Every ${m / 60} hours`;
    return tr ? "Günde bir" : "Once a day";
  };
  const syncRow = (p: StoreProvider) => (
    <SettingRow
      title={ui.apiSyncInterval}
      description={language === "tr"
        ? "Uygulama açıkken mağaza rakamlarını arka planda bu sıklıkla yeniler; Mağaza Merkezi'ndeki günlük gidişat da böyle dolar."
        : "While the app is open, store numbers refresh in the background this often; it also fills Store Center's daily trend."}
      control={
        <Dropdown
          value={String(syncPrefs[p])}
          options={SYNC_INTERVAL_OPTIONS.map((m) => ({ id: String(m), label: syncLabel(m) }))}
          onChange={(id) => setSync(p, Number(id))}
        />
      }
    />
  );

  const [steam, setSteam]       = useState(steamApiKey);
  const [itch, setItch]         = useState(itchApiKey);
  const [steamId, setSteamId]   = useState(steamUserId);
  const [playPath, setPlayPath] = useState(googlePlayJsonPath);

  // Re-sync drafts when the store updates from another path (e.g.
  // first init resolving).
  useEffect(() => { setSteam(steamApiKey); }, [steamApiKey]);
  useEffect(() => { setItch(itchApiKey); }, [itchApiKey]);
  useEffect(() => { setSteamId(steamUserId); }, [steamUserId]);
  useEffect(() => { setPlayPath(googlePlayJsonPath); }, [googlePlayJsonPath]);

  // Per-row Test state: idle | testing | success | error.
  type TestState = "idle" | "testing" | "ok" | "err";
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const setTest = (key: string, s: TestState) => setTestStates((p) => ({ ...p, [key]: s }));

  const t = (en: string, tr: string) => (language === "tr" ? tr : en);

  /** Probe a provider by calling fetchStoreGames. Treats any
   *  successful response (even an empty array) as a working
   *  credential. */
  const testProvider = async (
    key: "steam" | "itch" | "play",
    provider: "steam" | "itch" | "play",
    apiKey: string,
    userId?: string,
  ) => {
    if (!apiKey.trim() && provider !== "play") {
      showToast(t("Enter an API key first.", "Önce bir API anahtarı gir."), "info");
      return;
    }
    setTest(key, "testing");
    try {
      await fetchStoreGames(provider, apiKey, userId);
      setTest(key, "ok");
      showToast(t("Connection OK.", "Bağlantı başarılı."), "success");
    } catch (err) {
      setTest(key, "err");
      showError(err);
    } finally {
      setTimeout(() => setTest(key, "idle"), 4000);
    }
  };

  const saveAll = async () => {
    await handleSaveApiKeys({
      steamApiKey: steam,
      itchApiKey: itch,
      steamUserId: steamId,
      googlePlayJsonPath: playPath,
    });
  };

  const pickPlayJson = async () => {
    try {
      const p = await pickGooglePlayJson();
      setPlayPath(p);
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showError(err);
    }
  };

  const TestButton = ({ k }: { k: string }) => {
    const s = testStates[k] ?? "idle";
    return (
      <CompactButton
        onClick={() => {
          if (k === "steam") void testProvider("steam", "steam", steam, steamId);
          else if (k === "itch") void testProvider("itch", "itch", itch);
          else void testProvider("play", "play", playPath);
        }}
        disabled={s === "testing"}
      >
        {s === "testing" ? "…"
          : s === "ok" ? "✓"
          : s === "err" ? "!"
          : ui.apiTest}
      </CompactButton>
    );
  };

  return (
    <>
      <div className="settings-info-banner">{ui.apiSecurityNote}</div>

      <SettingGroup label={ui.apiGroupSteam}>
        <SettingRow
          title={ui.apiKey}
          control={
            <div style={{ display: "inline-flex", gap: 6 }}>
              <PasswordInput value={steam} onChange={setSteam} placeholder="XXXXXXXXXXXXXXXX" />
              <TestButton k="steam" />
            </div>
          }
        />
        <SettingRow
          title="SteamID64"
          description={ui.apiSteamIdDesc}
          control={<TextInput value={steamId} onChange={setSteamId} placeholder="76561198000000000" maxLength={20} />}
        />
        {syncRow("steam")}
      </SettingGroup>

      <SettingGroup label={ui.apiGroupItch}>
        <SettingRow
          title={ui.apiKey}
          control={
            <div style={{ display: "inline-flex", gap: 6 }}>
              <PasswordInput value={itch} onChange={setItch} placeholder="API key" />
              <TestButton k="itch" />
            </div>
          }
        />
        {syncRow("itch")}
      </SettingGroup>

      <SettingGroup label={ui.apiGroupPlay}>
        <SettingRow
          title={ui.apiPlayJson}
          description={ui.apiPlayJsonDesc}
          control={
            <div style={{ display: "inline-flex", gap: 6 }}>
              <TextInput value={playPath} onChange={setPlayPath} placeholder="/path/to/service-account.json" width={220} />
              <CompactButton onClick={() => void pickPlayJson()}>{ui.apiPickFile}</CompactButton>
              <TestButton k="play" />
            </div>
          }
        />
        {syncRow("play")}
      </SettingGroup>

      <SettingGroup label={ui.apiGroupSave}>
        <SettingRow
          title={ui.apiSaveAll}
          description={ui.apiSaveAllDesc}
          control={
            <CompactButton onClick={() => void saveAll()}>
              {ui.apiSaveAll}
            </CompactButton>
          }
        />
      </SettingGroup>
    </>
  );
}

/** Live read-out of the polling loop for the Team Mode page. Shows the
 *  last successful signature check + a manual "Check now" trigger so the
 *  user can verify cloud sync is wired without waiting for the interval. */
function SyncStatusRow() {
  const { ui, language } = useAppStore();
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const v = localStorage.getItem("heravex_last_sync_check");
      setLastCheck(v ? Number(v) : null);
    };
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, []);
  const ago = lastCheck ? Math.max(0, Math.floor((Date.now() - lastCheck) / 1000)) : null;
  const agoLabel = ago == null
    ? (language === "tr" ? "henüz yok" : "not yet")
    : ago < 60
      ? `${ago}s`
      : ago < 3600
        ? `${Math.floor(ago / 60)}m`
        : `${Math.floor(ago / 3600)}h`;
  return (
    <SettingRow
      title={language === "tr" ? "Son senkron kontrolü" : "Last sync check"}
      description={language === "tr"
        ? "Watcher gecikme süresine göre uzak klasör otomatik taranır."
        : "Remote folder is fingerprinted on the watcher-delay interval."}
      control={
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span className="setting-version-tag setting-version-tag-muted">{agoLabel}</span>
          <CompactButton onClick={() => {
            window.dispatchEvent(new CustomEvent("heravex:force-sync-check"));
          }}>
            <RefreshCcw size={11} style={{ marginRight: 4 }} />
            {language === "tr" ? "Şimdi kontrol et" : "Check now"}
          </CompactButton>
        </div>
      }
    />
  );
}

function TeamModePage() {
  const { ui, teamMode, setTeamMode, language, showToast, showError, refreshGames } = useAppStore();
  const [workspacePath, setWorkspacePathState] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const p = await getWorkspacePath();
        setWorkspacePathState(p ?? "");
      } catch { /* swallow */ }
    })();
  }, []);

  // Cloud-vs-local check on pick. The previous flow accepted any
  // directory, so a user clicking "Team mode" and pointing at a desktop
  // folder would silently enable team mode against a non-syncing
  // location. The detection here is the same heuristic the
  // NewWorkspaceModal uses; when it returns null we ask the user
  // explicitly to confirm via window.confirm before continuing — a
  // proper dialog would be nicer but window.confirm is acceptable
  // until we add a reusable settings-page confirm modal.
  const pickWorkspace = async () => {
    setBusy(true);
    try {
      const dir = await pickDirectory();
      if (dir) {
        const provider = detectCloudProvider(dir);
        if (!provider) {
          const msg = language === "tr"
            ? "Bu klasör bir bulut-senk klasörü gibi görünmüyor. Ekiple paylaşımlı çalışmak için OneDrive / Dropbox / iCloud / Google Drive içindeki bir klasör seçmen önerilir. Yine de bu klasörle devam etmek istiyor musun?"
            : language === "fr"
            ? "Ce dossier ne ressemble pas à un dossier cloud. Pour partager avec une équipe, utilisez un dossier OneDrive / Dropbox / iCloud / Google Drive. Continuer quand même ?"
            : language === "es"
            ? "Esta carpeta no parece estar en la nube. Para compartir con un equipo, usa una carpeta de OneDrive / Dropbox / iCloud / Google Drive. ¿Continuar de todos modos?"
            : "This folder doesn't look like a cloud-synced folder. To share with a team, point at a folder inside OneDrive / Dropbox / iCloud / Google Drive. Continue anyway?";
          if (!window.confirm(msg)) {
            setBusy(false);
            return;
          }
        }
        await setWorkspacePath(dir);
        // CRITICAL: register the folder as a TEAM workspace so the
        // team-sync poller (`isTeamWorkspaceActive`) reliably activates.
        // Without this, sync only ran when the path heuristically looked
        // like a cloud folder — so "enable team mode" silently did
        // nothing for many real folders. (Root cause of "no propagation".)
        const existing = loadWorkspaces().find((w) => w.path === dir);
        if (existing && existing.id !== "default") {
          updateWorkspaceMode(existing.id, "team", provider ?? "other");
        } else {
          addWorkspace(dir.split(/[\\/]/).pop() || "Team", dir, { mode: "team", cloudProvider: provider ?? "other" });
        }
        setWorkspacePathState(dir);
        await refreshGames();
        showToast(ui.teamModeWorkspaceSet, "success");
      }
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showError(err);
    } finally {
      setBusy(false);
    }
  };

  const clearWorkspace = async () => {
    setBusy(true);
    try {
      await clearWorkspacePath();
      setWorkspacePathState("");
      await refreshGames();
      showToast(ui.teamModeWorkspaceCleared, "info");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const inTeamMode = workspacePath.length > 0;

  return (
    <>
      <SettingGroup label={ui.teamModeGroupStatus}>
        <SettingRow
          title={ui.teamModeMode}
          description={inTeamMode ? ui.teamModeOn : ui.teamModeOff}
          control={
            <PillGroup
              value={inTeamMode ? "team" : "local"}
              options={[
                { id: "local", label: ui.teamModeLocal },
                { id: "team",  label: ui.teamModeTeam },
              ]}
              onChange={(id) => {
                if (id === "local" && inTeamMode) void clearWorkspace();
                else if (id === "team" && !inTeamMode) void pickWorkspace();
              }}
            />
          }
        />
        <SettingRow
          title={ui.teamModeWorkspace}
          description={workspacePath || ui.teamModeWorkspaceNone}
          control={
            <div style={{ display: "inline-flex", gap: 6 }}>
              <CompactButton onClick={() => void pickWorkspace()} disabled={busy}>
                {workspacePath ? ui.teamModeChange : ui.teamModePick}
              </CompactButton>
              {workspacePath && (
                <CompactButton onClick={() => void clearWorkspace()} variant="danger" disabled={busy}>
                  {ui.teamModeUnlink}
                </CompactButton>
              )}
            </div>
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.teamModeGroupConflict}>
        {/* v0.9.8 — sync is now fully automatic: instant polling +
            per-file merge (different files never conflict), so the
            watcher-delay and conflict-strategy knobs were removed. */}
        <SettingRow
          title={language === "tr" ? "Otomatik eşitleme" : "Automatic sync"}
          description={language === "tr"
            ? "Değişiklikler anında eşitlenir ve dosya bazında otomatik birleşir — ayar gerekmez."
            : "Changes sync instantly and merge per-file automatically — nothing to configure."}
        />
        <SyncStatusRow />
        <SettingRow
          title={ui.teamModePresence}
          control={<Toggle checked={teamMode.showPresence} onChange={(v) => setTeamMode({ showPresence: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={language === "tr" ? "Ekip üyeleri"
        : language === "fr" ? "Membres de l'équipe"
        : language === "es" ? "Miembros del equipo"
        : "Team members"}>
        <TeamMembersPanel workspacePath={workspacePath} language={language} />
      </SettingGroup>

      <SettingGroup label={ui.teamModeGroupInfo}>
        <SettingRow title={ui.teamModeInfoAtomic}   description={ui.teamModeInfoAtomicDesc} />
        <SettingRow title={ui.teamModeInfoWatcher}  description={ui.teamModeInfoWatcherDesc} />
        <SettingRow title={ui.teamModeInfoActivity} description={ui.teamModeInfoActivityDesc} />
      </SettingGroup>
    </>
  );
}

/** Members panel for the active team workspace. Reads the on-disk
 *  members file on mount and on the cross-component
 *  `heravex:team-members-changed` event. Renders a header + a list of
 *  member rows; leader-only actions (promote, demote, ban, remove)
 *  appear next to the row only when the current user is the leader.
 *
 *  Local / non-team workspaces show a hint that switching to a team
 *  folder is required — the same flow as picking a workspace above.
 */
/** Member avatar that degrades to initials. Avatar paths are absolute on
 *  the writer's machine, so a teammate's path won't resolve on yours —
 *  `onError` falls back to the initial rather than showing a broken image
 *  (this is why the leader looked "profile-less"). */
function TeamMemberAvatar({ avatarPath, displayName, role }: { avatarPath?: string | null; displayName: string; role: string }) {
  const [failed, setFailed] = useState(false);
  const initial = (displayName || "?").slice(0, 1).toUpperCase();
  return (
    <div className={`team-member-avatar role-${role}`} aria-hidden="true">
      {avatarPath && !failed
        ? <img src={imgSrc(avatarPath) ?? undefined} alt="" onError={() => setFailed(true)} />
        : <span>{initial}</span>}
    </div>
  );
}

function TeamMembersPanel({ workspacePath, language }: { workspacePath: string; language: string }) {
  const [doc, setDoc] = useState<import("../../../lib/teamMembers").MembersDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!workspacePath) { setDoc(null); return; }
    try {
      const { readMembers } = await import("../../../lib/teamMembers");
      const d = await readMembers(workspacePath);
      setDoc(d);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [workspacePath]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onChange = () => void refresh();
    // Self heartbeat fires `team-members-changed`; remote teammate
    // changes fire `members-file-changed` (from the manifest poll). Both
    // must refresh the panel — listening only to the former was why
    // teammates' rows never appeared without a manual reload.
    window.addEventListener("heravex:team-members-changed", onChange);
    window.addEventListener("heravex:members-file-changed", onChange);
    return () => {
      window.removeEventListener("heravex:team-members-changed", onChange);
      window.removeEventListener("heravex:members-file-changed", onChange);
    };
  }, [refresh]);

  const pick = (en: string, tr: string, fr: string, es: string) =>
    language === "tr" ? tr : language === "fr" ? fr : language === "es" ? es : en;

  // No workspace selected — surface the same call-to-action as the
  // Status group above. The user can still see this group from a
  // local workspace; we keep the hint instead of hiding the group so
  // the empty state explains *why* the panel is empty.
  if (!workspacePath) {
    return (
      <SettingRow
        title={pick("No team workspace active", "Aktif ekip çalışma alanı yok",
          "Aucun espace équipe actif", "No hay espacio de equipo activo")}
        description={pick(
          "Pick a cloud-synced folder above to enable team membership.",
          "Yukarıdan bir bulut-senk klasörü seçince ekip üyeliği etkinleşir.",
          "Choisissez un dossier cloud ci-dessus pour activer l'équipe.",
          "Elige una carpeta en la nube arriba para activar el equipo.",
        )}
      />
    );
  }

  if (error) {
    return (
      <SettingRow
        title={pick("Couldn't read members file", "Üyeler dosyası okunamadı",
          "Impossible de lire les membres", "No se pudo leer miembros")}
        description={error}
      />
    );
  }

  if (!doc) return <SettingRow title={pick("Loading…", "Yükleniyor…", "Chargement…", "Cargando…")} />;

  const members = doc.members.slice().sort((a, b) => {
    // Leader first, then non-banned by joinedAt, banned at the bottom.
    const rank = (r: typeof a.role) => r === "leader" ? 0 : r === "member" ? 1 : 2;
    const diff = rank(a.role) - rank(b.role);
    return diff !== 0 ? diff : a.joinedAt.localeCompare(b.joinedAt);
  });
  const meId = (() => {
    try { return localStorage.getItem("heravex_team_user_id") || ""; } catch { return ""; }
  })();
  const me = members.find((m) => m.userId === meId) ?? null;
  const iAmLeader = me?.role === "leader";

  const runLeaderAction = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      useAppStore.getState().showToast(
        pick("Updated.", "Güncellendi.", "Mis à jour.", "Actualizado."),
        "success",
      );
    } catch (err) {
      useAppStore.getState().showToast(String(err), "error");
    } finally { setBusy(false); }
  };

  return (
    <div className="team-members-list">
      <div className="team-members-summary">
        <span className="team-members-count">
          {members.length}{" "}
          {pick(members.length === 1 ? "member" : "members",
                members.length === 1 ? "üye" : "üye",
                members.length === 1 ? "membre" : "membres",
                members.length === 1 ? "miembro" : "miembros")}
        </span>
        {me && (
          <span className={`team-members-role team-members-role-${me.role}`}>
            {pick(
              me.role === "leader" ? "You're the leader" : me.role === "banned" ? "You're banned" : "You're a member",
              me.role === "leader" ? "Sen lidersin" : me.role === "banned" ? "Banlandın" : "Sen üyesin",
              me.role === "leader" ? "Vous êtes leader" : me.role === "banned" ? "Vous êtes banni" : "Vous êtes membre",
              me.role === "leader" ? "Eres líder" : me.role === "banned" ? "Estás baneado" : "Eres miembro",
            )}
          </span>
        )}
      </div>
      <ul className="team-members-items">
        {members.map((m) => {
          const isMe = m.userId === meId;
          return (
            <li key={m.userId} className={`team-member-row team-member-role-${m.role} ${isMe ? "is-me" : ""}`}>
              <TeamMemberAvatar avatarPath={m.avatarPath} displayName={m.displayName} role={m.role} />
              <div className="team-member-body">
                <strong className="team-member-name">
                  {m.displayName || pick("Anonymous", "İsimsiz", "Anonyme", "Anónimo")}
                  {isMe && <span className="team-member-self-tag">
                    {pick("you", "sen", "vous", "tú")}
                  </span>}
                </strong>
                <span className="team-member-meta">
                  <span className={`team-member-role-tag role-${m.role}`}>
                    {pick(
                      m.role === "leader" ? "Leader" : m.role === "banned" ? "Banned" : "Member",
                      m.role === "leader" ? "Lider" : m.role === "banned" ? "Banlı" : "Üye",
                      m.role === "leader" ? "Leader" : m.role === "banned" ? "Banni" : "Membre",
                      m.role === "leader" ? "Líder" : m.role === "banned" ? "Baneado" : "Miembro",
                    )}
                  </span>
                  <span>· {m.machineHint || "—"}</span>
                  <span>· {pick("seen", "görüldü", "vu", "visto")} {new Date(m.lastSeenAt).toLocaleString()}</span>
                </span>
              </div>
              {iAmLeader && !isMe && (
                <div className="team-member-actions">
                  {m.role === "banned" ? (
                    <CompactButton
                      onClick={() => void runLeaderAction(async () => {
                        const { unbanMember } = await import("../../../lib/teamMembers");
                        await unbanMember(workspacePath, meId, m.userId);
                      })}
                      disabled={busy}
                    >
                      {pick("Unban", "Banı Kaldır", "Débannir", "Desbanear")}
                    </CompactButton>
                  ) : (
                    <CompactButton
                      onClick={() => void runLeaderAction(async () => {
                        const { banMember } = await import("../../../lib/teamMembers");
                        await banMember(workspacePath, meId, m.userId);
                      })}
                      variant="danger"
                      disabled={busy}
                    >
                      {pick("Ban", "Banla", "Bannir", "Banear")}
                    </CompactButton>
                  )}
                  <CompactButton
                    onClick={() => void runLeaderAction(async () => {
                      const { transferLeadership } = await import("../../../lib/teamMembers");
                      await transferLeadership(workspacePath, meId, m.userId);
                    })}
                    disabled={busy || m.role === "banned"}
                  >
                    {pick("Make leader", "Lider Yap", "Promouvoir", "Hacer líder")}
                  </CompactButton>
                  <CompactButton
                    onClick={() => void runLeaderAction(async () => {
                      const ok = window.confirm(pick(
                        `Remove ${m.displayName} from the team?`,
                        `${m.displayName} ekipten çıkarılsın mı?`,
                        `Retirer ${m.displayName} de l'équipe ?`,
                        `¿Eliminar a ${m.displayName} del equipo?`,
                      ));
                      if (!ok) return;
                      const { removeMember } = await import("../../../lib/teamMembers");
                      await removeMember(workspacePath, meId, m.userId);
                    })}
                    variant="danger"
                    disabled={busy}
                  >
                    {pick("Remove", "Çıkar", "Retirer", "Eliminar")}
                  </CompactButton>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="team-members-footnote">
        {pick(
          "Roles and bans are stored in heravex-members.json inside the workspace folder. Only the leader's writes are authoritative.",
          "Roller ve banlar workspace klasöründeki heravex-members.json dosyasında tutulur. Sadece liderin yazdığı geçerlidir.",
          "Les rôles et bannissements sont stockés dans heravex-members.json. Seuls les écrits du leader font autorité.",
          "Los roles y baneos están en heravex-members.json dentro de la carpeta. Solo el líder tiene autoridad.",
        )}
      </p>
    </div>
  );
}

function WebhooksPage() {
  const { ui, webhooks, setWebhooks, showToast, showError, language, profile } = useAppStore();
  const d = webhooks.discord;
  const g = webhooks.github;
  const custom = webhooks.custom ?? [];
  const [testing, setTesting] = useState(false);
  const trW = (en: string, t: string) => (language === "tr" ? t : en);
  const ALL_EVENTS: WebhookEvent[] = ["versionPublished", "taskCompleted", "pressKitGenerated", "buildReady"];
  const eventLabel = (ev: WebhookEvent) =>
    ev === "versionPublished" ? ui.webhookEventVersion :
    ev === "taskCompleted"    ? ui.webhookEventTask :
    ev === "pressKitGenerated" ? ui.webhookEventPressKit :
                                ui.webhookEventBuild;

  // ── Custom webhooks ────────────────────────────────────────────────
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const urlOk = (u: string) => /^https:\/\//i.test(u.trim()) || /^http:\/\/(localhost|127\.0\.0\.1)/i.test(u.trim());
  const setCustom = (next: CustomWebhook[]) => setWebhooks({ custom: next });
  const addCustom = () => {
    if (!urlOk(newUrl)) {
      showToast(trW("The address must start with https://", "Adres https:// ile başlamalı"), "warning");
      return;
    }
    setCustom([...custom, {
      id: crypto.randomUUID(),
      name: newName.trim() || new URL(newUrl.trim()).host,
      url: newUrl.trim(),
      events: ["versionPublished"],
      enabled: true,
    }]);
    setNewName("");
    setNewUrl("");
  };
  const patchCustom = (id: string, p: Partial<CustomWebhook>) =>
    setCustom(custom.map((h) => (h.id === id ? { ...h, ...p } : h)));
  const testCustom = async (h: CustomWebhook) => {
    setTestingId(h.id);
    try {
      await postCustomWebhook(h.url, customPayload("versionPublished", { game: "HeraVex", version: "test", user: profile.displayName || "you" }));
      showToast(ui.webhookTestSent, "success");
    } catch (err) {
      showError(err);
    } finally {
      setTestingId(null);
    }
  };

  const sendDiscordTest = async () => {
    if (!d.webhookUrl.trim()) {
      showToast(ui.webhookEnterUrl, "info");
      return;
    }
    setTesting(true);
    try {
      const msg = d.messageTemplate
        .replace("{game}", "HeraVex")
        .replace("{version}", "0.9-test")
        .replace("{user}", "you");
      await postDiscordWebhook(d.webhookUrl, `🧪 ${msg}`);
      showToast(ui.webhookTestSent, "success");
    } catch (err) {
      showError(err);
    } finally {
      setTesting(false);
    }
  };

  const toggleEvent = (ev: WebhookEvent) => {
    const next = d.events.includes(ev)
      ? d.events.filter((e) => e !== ev)
      : [...d.events, ev];
    setWebhooks({ discord: { ...d, events: next } });
  };

  return (
    <>
      <SettingGroup label={ui.webhookGroupDiscord}>
        <SettingRow
          title={ui.webhookDiscordUrl}
          description={ui.webhookDiscordUrlDesc}
          control={
            <PasswordInput
              value={d.webhookUrl}
              onChange={(v) => setWebhooks({ discord: { ...d, webhookUrl: v } })}
              placeholder="https://discord.com/api/webhooks/…"
              width={240}
            />
          }
        />
        {(["versionPublished", "taskCompleted", "pressKitGenerated", "buildReady"] as WebhookEvent[]).map((ev) => (
          <SettingRow
            key={ev}
            title={
              ev === "versionPublished" ? ui.webhookEventVersion :
              ev === "taskCompleted"    ? ui.webhookEventTask :
              ev === "pressKitGenerated" ? ui.webhookEventPressKit :
                                          ui.webhookEventBuild
            }
            control={
              <Toggle
                checked={d.events.includes(ev)}
                onChange={() => toggleEvent(ev)}
              />
            }
          />
        ))}
        <SettingRow
          title={ui.webhookTemplate}
          description={ui.webhookTemplateDesc}
          control={
            <TextArea
              value={d.messageTemplate}
              onChange={(v) => setWebhooks({ discord: { ...d, messageTemplate: v } })}
              rows={2}
              maxLength={300}
              width={300}
            />
          }
        />
        <SettingRow
          title={ui.webhookTest}
          description={ui.webhookTestDesc}
          control={
            <CompactButton onClick={() => void sendDiscordTest()} disabled={testing}>
              {testing ? "…" : ui.webhookSendTest}
            </CompactButton>
          }
        />
      </SettingGroup>

      <SettingGroup label={ui.webhookGroupGithub}>
        <SettingRow
          title={ui.webhookGithubPat}
          description={ui.webhookGithubPatDesc}
          control={
            <PasswordInput
              value={g.personalAccessToken}
              onChange={(v) => setWebhooks({ github: { ...g, personalAccessToken: v } })}
              placeholder="ghp_…"
            />
          }
        />
        <SettingRow
          title={ui.webhookGithubRepo}
          control={
            <TextInput
              value={g.defaultRepo}
              onChange={(v) => setWebhooks({ github: { ...g, defaultRepo: v } })}
              placeholder="owner/repo"
              maxLength={120}
            />
          }
        />
        <SettingRow
          title={ui.webhookGithubPullCommits}
          control={
            <Toggle
              checked={g.pullReleaseCommits}
              onChange={(v) => setWebhooks({ github: { ...g, pullReleaseCommits: v } })}
            />
          }
        />
        <SettingRow
          title={ui.webhookGithubAutoRelease}
          control={
            <Toggle
              checked={g.autoCreateRelease}
              onChange={(v) => setWebhooks({ github: { ...g, autoCreateRelease: v } })}
            />
          }
        />
      </SettingGroup>

      <SettingGroup
        label={ui.webhookGroupCustom}
        hint={trW("HeraVex sends a JSON POST to your address on the events you pick (Slack, Zapier, Make, n8n, your own server).",
                  "Seçtiğin olaylarda HeraVex adresine JSON POST gönderir (Slack, Zapier, Make, n8n veya kendi sunucun).")}
      >
        {custom.length === 0 && (
          <SettingRow title={ui.webhookCustomNone} description={ui.webhookCustomDesc} />
        )}
        {custom.map((h) => (
          <div key={h.id} className="custom-webhook">
            <SettingRow
              title={h.name}
              description={h.url}
              control={
                <div className="setting-inline-pair">
                  <CompactButton onClick={() => void testCustom(h)} disabled={testingId === h.id}>
                    {testingId === h.id ? "…" : ui.webhookSendTest}
                  </CompactButton>
                  <CompactButton variant="danger" onClick={() => setCustom(custom.filter((x) => x.id !== h.id))}>
                    {trW("Remove", "Kaldır")}
                  </CompactButton>
                  <Toggle checked={h.enabled} onChange={(v) => patchCustom(h.id, { enabled: v })} />
                </div>
              }
            />
            <div className="custom-webhook-events" role="group" aria-label={trW("Events", "Olaylar")}>
              {ALL_EVENTS.map((ev) => {
                const on = h.events.includes(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    aria-pressed={on}
                    className={"filter-chip" + (on ? " filter-chip-active" : "")}
                    onClick={() => patchCustom(h.id, { events: on ? h.events.filter((x) => x !== ev) : [...h.events, ev] })}
                  >
                    {eventLabel(ev)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <SettingRow
          title={trW("Add a webhook", "Webhook ekle")}
          description={trW(
            "Body: { app, event, game, version, task, user, timestamp, text }. \"text\" makes Slack-style URLs work as-is.",
            "Gövde: { app, event, game, version, task, user, timestamp, text }. \"text\" sayesinde Slack tipi adresler olduğu gibi çalışır.",
          )}
          control={
            <div className="setting-inline-pair">
              <TextInput value={newName} onChange={setNewName} placeholder={trW("Name", "Ad")} maxLength={40} width={110} />
              <TextInput value={newUrl} onChange={setNewUrl} placeholder="https://…" maxLength={500} width={200} />
              <CompactButton onClick={addCustom} disabled={!newUrl.trim()}>{trW("Add", "Ekle")}</CompactButton>
            </div>
          }
        />
      </SettingGroup>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SYSTEM
// ─────────────────────────────────────────────────────────────────────

function PrivacyPage() {
  const { ui, privacy, setPrivacy, showToast, showError, refreshGames, language } = useAppStore();
  const p = privacy;
  // OS keychain for API keys — Rust is the source of truth.
  const [keychain, setKeychain] = useState<{ supported: boolean; enabled: boolean } | null>(null);
  const [keychainBusy, setKeychainBusy] = useState(false);
  useEffect(() => {
    invoke<{ supported: boolean; enabled: boolean }>("keychain_status")
      .then(setKeychain)
      .catch(() => setKeychain({ supported: false, enabled: false }));
  }, []);
  const toggleKeychain = async (on: boolean) => {
    setKeychainBusy(true);
    try {
      setKeychain(await invoke<{ supported: boolean; enabled: boolean }>("set_secrets_in_keychain", { enabled: on }));
      showToast(on
        ? (language === "tr" ? "API anahtarları anahtar zincirine taşındı." : "API keys moved to the keychain.")
        : (language === "tr" ? "API anahtarları ayar dosyasına geri alındı." : "API keys moved back to the settings file."), "success");
    } catch (err) {
      showError(err);
    } finally {
      setKeychainBusy(false);
    }
  };
  const [showTelemetryDetails, setShowTelemetryDetails] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDeleteAll = async () => {
    if (deleteConfirmText !== "DELETE") return;
    try {
      await deleteAllData();
      await refreshGames();
      showToast(ui.privacyDataDeleted, "success");
      setShowDeleteDialog(false);
      setDeleteConfirmText("");
    } catch (err) {
      showError(err);
    }
  };

  return (
    <>
      <SettingGroup label={ui.privacyGroupData}>
        <SettingRow
          title={ui.privacyTelemetry}
          description={ui.privacyTelemetryDesc}
          control={<Toggle checked={p.anonymousTelemetry} onChange={(v) => setPrivacy({ anonymousTelemetry: v })} />}
        />
        <SettingRow
          title={ui.privacyCrashReports}
          description={ui.privacyCrashReportsDesc}
          control={<Toggle checked={p.crashReports} onChange={(v) => setPrivacy({ crashReports: v })} />}
        />
        <SettingRow
          title={ui.privacyTelemetryDetails}
          description={ui.privacyTelemetryDetailsDesc}
          control={<CompactButton onClick={() => setShowTelemetryDetails(true)}>{ui.privacyView}</CompactButton>}
        />
      </SettingGroup>

      <SettingGroup label={ui.privacyGroupKeys}>
        <SettingRow
          title={ui.privacyKeychain}
          description={keychain && !keychain.supported
            ? (language === "tr" ? "Bu sistemde desteklenmiyor (Linux)." : "Not supported on this system (Linux).")
            : (language === "tr"
              ? "Steam ve Itch.io API anahtarları Windows Kimlik Bilgisi Yöneticisi / macOS Anahtar Zinciri'nde saklanır; ayar dosyasında ve yedeklerde yer almaz. Başka bilgisayarda yedeği açınca anahtarları yeniden girmen gerekir."
              : "Steam and Itch.io API keys are kept in Windows Credential Manager / macOS Keychain, not in the settings file or backups. Restoring a backup on another computer means entering them again.")}
          disabled={!keychain?.supported}
          control={
            <Toggle
              checked={keychain?.enabled === true}
              onChange={(v) => { if (!keychainBusy) void toggleKeychain(v); }}
            />
          }
        />
        <SettingRow
          title={ui.privacyMaskValues}
          description={ui.privacyMaskValuesDesc}
          control={<Toggle checked={p.maskValuesInUi} onChange={(v) => setPrivacy({ maskValuesInUi: v })} />}
        />
        <SettingRow
          title={ui.privacyClipboardClear}
          control={<Toggle checked={p.clearClipboardAfterCopy} onChange={(v) => setPrivacy({ clearClipboardAfterCopy: v })} />}
        />
        {p.clearClipboardAfterCopy && (
          <SettingRow
            title={ui.privacyClipboardSeconds}
            control={
              <Dropdown
                value={String(p.clearClipboardSeconds) as "15" | "30" | "60" | "120"}
                options={[
                  { id: "15",  label: "15 s" },
                  { id: "30",  label: "30 s" },
                  { id: "60",  label: "60 s" },
                  { id: "120", label: "120 s" },
                ]}
                onChange={(id) => setPrivacy({ clearClipboardSeconds: Number(id) as ClipboardClearSeconds })}
              />
            }
          />
        )}
      </SettingGroup>

      <SettingGroup label={ui.privacyGroupLeak}>
        <SettingRow
          title={ui.privacyHideEmail}
          description={ui.privacyHideEmailDesc}
          control={<Toggle checked={p.hideEmailInPressKits} onChange={(v) => setPrivacy({ hideEmailInPressKits: v })} />}
        />
        <SettingRow
          title={ui.privacyRedactKeys}
          description={ui.privacyRedactKeysDesc}
          control={<Toggle checked={p.redactKeysOnExport} onChange={(v) => setPrivacy({ redactKeysOnExport: v })} />}
        />
        <SettingRow
          title={ui.privacyScreenshotMode}
          description={ui.privacyScreenshotModeDesc}
          control={<Toggle checked={p.screenshotMode} onChange={(v) => setPrivacy({ screenshotMode: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.privacyGroupSession}>
        <SettingRow
          title={ui.privacyAutoLock}
          description={ui.privacyAutoLockDesc}
          control={
            <Dropdown
              value={p.autoLock}
              options={[
                { id: "off", label: ui.privacyAutoLockOff },
                { id: "5m",  label: "5 min" },
                { id: "15m", label: "15 min" },
                { id: "30m", label: "30 min" },
                { id: "1h",  label: "1 hour" },
              ]}
              onChange={(id) => setPrivacy({ autoLock: id as AutoLockTimeout })}
            />
          }
        />
        <SettingRow
          title={ui.privacySignOut}
          description={ui.privacySignOutDesc}
          control={
            <CompactButton onClick={() => {
              if (confirm(ui.privacySignOutConfirm)) signOutAndReload();
            }}>
              {ui.privacySignOut}
            </CompactButton>
          }
        />
        <SettingRow
          title={ui.privacyDeleteAll}
          description={ui.privacyDeleteAllDesc}
          control={
            <CompactButton onClick={() => setShowDeleteDialog(true)} variant="danger">
              {ui.privacyDeleteAll}
            </CompactButton>
          }
        />
      </SettingGroup>

      {showTelemetryDetails && (
        <div className="mb-modal-backdrop" onClick={() => setShowTelemetryDetails(false)}>
          <div className="mb-modal" style={{ gridTemplateColumns: "1fr", maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-modal-side" style={{ borderLeft: "none" }}>
              <h2 style={{ margin: "0 0 8px" }}>{ui.privacyTelemetryDetails}</h2>
              <p className="section-copy">{ui.privacyTelemetryModalIntro}</p>
              <ul style={{ marginTop: 12, paddingLeft: 18, color: "#cbd5e1", fontSize: 12.5, lineHeight: 1.6 }}>
                <li>{ui.privacyTelemetryItem1}</li>
                <li>{ui.privacyTelemetryItem2}</li>
                <li>{ui.privacyTelemetryItem3}</li>
                <li>{ui.privacyTelemetryItem4}</li>
              </ul>
              <p className="section-copy" style={{ marginTop: 12, fontStyle: "italic" }}>
                {ui.privacyTelemetryFooter}
              </p>
              <div style={{ marginTop: 18, textAlign: "right" }}>
                <CompactButton onClick={() => setShowTelemetryDetails(false)}>{ui.mbClose}</CompactButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteDialog && (
        <div className="mb-modal-backdrop" onClick={() => setShowDeleteDialog(false)}>
          <div className="mb-modal" style={{ gridTemplateColumns: "1fr", maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-modal-side" style={{ borderLeft: "none" }}>
              <h2 style={{ margin: "0 0 8px", color: "#fca5a5" }}>{ui.privacyDeleteConfirmTitle}</h2>
              <p className="section-copy">{ui.privacyDeleteConfirmBody}</p>
              <p className="section-copy" style={{ marginTop: 14, fontWeight: 600 }}>
                {ui.privacyDeleteConfirmInstruction}
              </p>
              <TextInput
                value={deleteConfirmText}
                onChange={setDeleteConfirmText}
                placeholder="DELETE"
                width={300}
              />
              <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <CompactButton onClick={() => { setShowDeleteDialog(false); setDeleteConfirmText(""); }}>
                  {ui.mbCancel}
                </CompactButton>
                <CompactButton
                  onClick={() => void handleDeleteAll()}
                  variant="danger"
                  disabled={deleteConfirmText !== "DELETE"}
                >
                  {ui.privacyDeleteConfirmBtn}
                </CompactButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ExperimentalPage() {
  const { ui, experimental, setExperimental, showError, language } = useAppStore();
  const e = experimental;
  const trX = (en: string, t: string) => (language === "tr" ? t : en);
  const widgets = e.customWidgets ?? [];
  const setWidgets = (next: CustomWidget[]) => setExperimental({ customWidgets: next });
  const patchWidget = (id: string, p: Partial<CustomWidget>) =>
    setWidgets(widgets.map((w) => (w.id === id ? { ...w, ...p } : w)));
  const addWidget = (type: CustomWidget["type"]) => {
    const title = type === "note" ? trX("Note", "Not") : type === "countdown" ? trX("Launch", "Çıkış") : trX("Links", "Bağlantılar");
    setWidgets([...widgets, { id: crypto.randomUUID(), type, title, text: "", date: "" }]);
  };
  const goTo = (section: string) => window.dispatchEvent(new CustomEvent("heravex:settings-go", { detail: section }));
  const graduated = <span className="setting-version-tag">{trX("Now built in", "Artık kalıcı")}</span>;

  return (
    <>
      <SettingGroup label={ui.expGroupGeneral}>
        <SettingRow
          title={ui.expBetaEnabled}
          description={trX("Master switch: while it's off, no beta feature runs, even if its own toggle is on.",
                           "Ana anahtar: kapalıyken, kendi anahtarı açık olsa bile hiçbir beta özellik çalışmaz.")}
          control={<Toggle checked={e.betaEnabled} onChange={(v) => setExperimental({ betaEnabled: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.expGroupActive}>
        {/* M7 ships no active betas — the toggles will land slice-by-slice
         *  in v1.0. We surface the design now so users can audit. */}
        <SettingRow
          title={ui.expBetaCustomWidgets}
          description={trX("Your own Dashboard panels: a pinned note, a countdown to a date, quick links.",
                           "Ana sayfaya kendi panellerin: sabit bir not, bir tarihe geri sayım, hızlı bağlantılar.")}
          disabled={!e.betaEnabled}
          control={<Toggle checked={e.betaCustomWidgets} onChange={(v) => setExperimental({ betaCustomWidgets: v })} />}
        />
        {e.betaEnabled && e.betaCustomWidgets && (
          <div className="custom-widget-editor">
            {widgets.map((w) => (
              <div key={w.id} className="custom-widget-edit">
                <div className="custom-widget-edit-head">
                  <span className="setting-version-tag setting-version-tag-muted">
                    {w.type === "note" ? trX("Note", "Not") : w.type === "countdown" ? trX("Countdown", "Geri sayım") : trX("Links", "Bağlantılar")}
                  </span>
                  <TextInput value={w.title} onChange={(v) => patchWidget(w.id, { title: v })} placeholder={trX("Title", "Başlık")} maxLength={60} width={200} />
                  {w.type === "countdown" && (
                    <input
                      type="date"
                      className="setting-text-input"
                      style={{ width: 150 }}
                      value={w.date ?? ""}
                      onChange={(ev) => patchWidget(w.id, { date: ev.target.value })}
                    />
                  )}
                  <CompactButton variant="danger" onClick={() => setWidgets(widgets.filter((x) => x.id !== w.id))}>
                    {trX("Remove", "Kaldır")}
                  </CompactButton>
                </div>
                {w.type !== "countdown" && (
                  <TextArea
                    value={w.text ?? ""}
                    onChange={(v) => patchWidget(w.id, { text: v })}
                    rows={w.type === "links" ? 3 : 4}
                    maxLength={2000}
                    width={520}
                    placeholder={w.type === "links"
                      ? trX("One per line:  Steam page | https://store.steampowered.com/…", "Her satıra bir tane:  Steam sayfası | https://store.steampowered.com/…")
                      : trX("Write anything: goals, a reminder, a short checklist…", "İstediğini yaz: hedefler, bir hatırlatma, kısa bir liste…")}
                  />
                )}
              </div>
            ))}
            <div className="custom-widget-add">
              <CompactButton onClick={() => addWidget("note")}>+ {trX("Note", "Not")}</CompactButton>
              <CompactButton onClick={() => addWidget("countdown")}>+ {trX("Countdown", "Geri sayım")}</CompactButton>
              <CompactButton onClick={() => addWidget("links")}>+ {trX("Links", "Bağlantılar")}</CompactButton>
            </div>
          </div>
        )}
        <SettingRow
          title={ui.expBetaNotionImport}
          description={trX("Out of beta: Settings → Import & Export → Notion.", "Betadan çıktı: Ayarlar → İçe/Dışa Aktar → Notion.")}
          badge={graduated}
          control={<CompactButton onClick={() => goTo("importExport")}>{trX("Open", "Aç")}</CompactButton>}
        />
        <SettingRow
          title={ui.expBetaMultiWorkspace}
          description={trX("Out of beta: create and switch workspaces from the workspace menu at the top of the sidebar.",
                           "Betadan çıktı: kenar çubuğunun üstündeki çalışma alanı menüsünden oluştur ve geçiş yap.")}
          badge={graduated}
        />
      </SettingGroup>

      <SettingGroup label={ui.expGroupDev}>
        <SettingRow
          title={ui.expDevMode}
          description={ui.expDevModeDesc}
          control={<Toggle checked={e.developerMode} onChange={(v) => setExperimental({ developerMode: v })} />}
        />
        {e.developerMode && (
          <>
            {/* DevTools row removed — the WebView still respects F12 /
                Ctrl+Shift+I on debug builds, so the dedicated button
                only confused users on stable builds where it no-op'd. */}
            <SettingRow
              title={ui.expOpenLog}
              description={ui.expOpenLogDesc}
              control={
                <CompactButton onClick={async () => {
                  try { await openLogDirectory(); } catch (err) { showError(err); }
                }}>
                  {ui.expOpen}
                </CompactButton>
              }
            />
            <SettingRow
              title={ui.expLogApi}
              description={ui.expLogApiDesc}
              control={<Toggle checked={e.logApiCalls} onChange={(v) => setExperimental({ logApiCalls: v })} />}
            />
            <SettingRow
              title={ui.expPerfMonitor}
              description={ui.expPerfMonitorDesc}
              control={<Toggle checked={e.performanceMonitor} onChange={(v) => setExperimental({ performanceMonitor: v })} />}
            />
          </>
        )}
      </SettingGroup>
    </>
  );
}

function AboutPage() {
  const { ui, language, showToast } = useAppStore();
  const open = (url: string) => void openExternal(url);
  const sendFeedback = () => {
    const subject = encodeURIComponent(language === "tr" ? "HeraVex Geri Bildirim" : "HeraVex Feedback");
    void openExternal(`mailto:${FEEDBACK_EMAIL}?subject=${subject}`);
  };
  const startTutorial = () => {
    resetTutorial();
    window.dispatchEvent(new CustomEvent("heravex:start-tutorial"));
  };
  const copyVersion = () => {
    try {
      void navigator.clipboard.writeText(`HeraVex v${APP_VERSION} (${APP_BUILD_DATE})`);
      showToast(ui.aboutCopied, "success");
    } catch {/* clipboard blocked */}
  };

  return (
    <>
      <SettingGroup label={ui.aboutGroupVersion}>
        <SettingRow
          title="HeraVex"
          description={ui.aboutVersionDesc}
          control={<span className="setting-version-tag">v{APP_VERSION}</span>}
        />
        <SettingRow
          title={ui.aboutBuildDate}
          control={<span className="setting-version-tag setting-version-tag-muted">{APP_BUILD_DATE}</span>}
        />
        <SettingRow
          title={ui.aboutCopyVersion}
          description={ui.aboutCopyVersionDesc}
          control={<CompactButton onClick={copyVersion}><Copy size={11} /></CompactButton>}
        />
      </SettingGroup>

      <SettingGroup label={ui.aboutGroupActions}>
        <SettingRow
          title={ui.aboutCheckUpdates}
          description={ui.aboutCheckUpdatesDesc}
          control={<CompactButton onClick={() => open(RELEASES_URL)}><RefreshCcw size={11} /></CompactButton>}
        />
        <SettingRow
          title={TUTORIAL_UI[language].startTitle}
          description={ui.aboutTutorialDesc}
          control={<CompactButton onClick={startTutorial}><Sparkles size={11} /></CompactButton>}
        />
        <SettingRow
          title={ui.aboutViewReleases}
          control={<CompactButton onClick={() => open(RELEASES_URL)}><ExternalLink size={11} /></CompactButton>}
        />
        <SettingRow
          title={ui.aboutFeedback}
          description={ui.aboutFeedbackDesc}
          control={<CompactButton onClick={sendFeedback}><Mail size={11} /></CompactButton>}
        />
      </SettingGroup>

      <SettingGroup label={ui.aboutGroupCommunity}>
        {/* Discord + GitHub removed — HeraVex isn't open source and
            doesn't host a community Discord server. The remaining
            channels are the studio's public socials. */}
        <SettingRow
          title="Reddit"
          control={<CompactButton onClick={() => open("https://reddit.com/r/heravex")}><ExternalLink size={11} /></CompactButton>}
        />
        <SettingRow
          title="Twitter / X"
          control={<CompactButton onClick={() => open("https://x.com/heravex_app")}><ExternalLink size={11} /></CompactButton>}
        />
      </SettingGroup>

      <SettingGroup label={ui.aboutGroupLicense}>
        {/* HeraVex is closed-source proprietary software. The MIT
            licence row and "open-source dependencies" placeholder
            were misleading; both removed. The copyright line stays
            as the single source of truth for licence status. */}
        <SettingRow
          title={ui.aboutCopyright}
        />
      </SettingGroup>
    </>
  );
}

// ── Dashboard panels — toggle + drag-reorder ─────────────────────────────────
//
// Lives inside Settings → Layout → Dashboard panels. Sits inside a
// SettingGroup but renders its own list (the layout doesn't fit the
// generic SettingRow shape because each row is the panel's surface,
// not a label + control). Sync model:
//   • The list lives in `layout.dashboardWidgets.panels` (Zustand).
//   • Reorder.Group writes the whole reordered list back via setLayout.
//   • Each row's checkbox toggles `enabled` for that panel id.
//   • Reset restores DEFAULT_DASHBOARD_PANELS.
//
// Every Dashboard panel id MUST appear here with a label + summary;
// `PANEL_COPY` is the single translation surface so new panels just
// extend the table.

const PANEL_COPY: Record<DashboardPanelId, { en: { title: string; desc: string }; tr: { title: string; desc: string }; fr: { title: string; desc: string }; es: { title: string; desc: string } }> = {
  recentGames: {
    en: { title: "Recently updated games", desc: "Last five games with progress bars." },
    tr: { title: "Son güncellenen oyunlar", desc: "İlerleme çubuğuyla son beş oyun." },
    fr: { title: "Jeux récemment mis à jour", desc: "Cinq derniers jeux avec leur progression." },
    es: { title: "Juegos actualizados recientemente", desc: "Últimos cinco juegos con barras de progreso." },
  },
  tasksAtRisk: {
    en: { title: "Tasks at risk", desc: "Overdue, due-soon, and oldest pending tasks." },
    tr: { title: "Riskli görevler", desc: "Gecikmiş, yakında ve en eski bekleyen görevler." },
    fr: { title: "Tâches à risque", desc: "En retard, bientôt et les plus anciennes en attente." },
    es: { title: "Tareas en riesgo", desc: "Atrasadas, próximas y más antiguas pendientes." },
  },
  spendTrend: {
    en: { title: "7-day spending", desc: "Daily spend chart for the last week." },
    tr: { title: "7 günlük harcama", desc: "Son haftanın günlük harcama grafiği." },
    fr: { title: "Dépenses 7 jours", desc: "Graphique quotidien de la dernière semaine." },
    es: { title: "Gasto 7 días", desc: "Gráfico diario de la última semana." },
  },
  overview: {
    en: { title: "Overview", desc: "Total spend, completion rate, spend-by-project pie." },
    tr: { title: "Genel bakış", desc: "Toplam harcama, tamamlanma oranı, proje pastası." },
    fr: { title: "Vue d'ensemble", desc: "Dépense totale, taux d'achèvement, camembert par projet." },
    es: { title: "Resumen", desc: "Gasto total, completado, gráfico por proyecto." },
  },
};

function pickPanelCopy(id: DashboardPanelId, language: string) {
  const map = PANEL_COPY[id];
  if (language === "tr") return map.tr;
  if (language === "fr") return map.fr;
  if (language === "es") return map.es;
  return map.en;
}

/** Dropdown selector for the hero left card. The 8 variants + "none"
 *  cover the workflows we discussed in v0.9.7 — pick whichever matches
 *  the user's current routine. */
function DashboardHeroCardRow({
  language,
  layout,
  setLayout,
}: {
  language: string;
  layout: LayoutSlice;
  setLayout: (patch: Partial<LayoutSlice>) => void;
}) {
  const pick = (en: string, tr: string, fr: string, es: string) =>
    language === "tr" ? tr : language === "fr" ? fr : language === "es" ? es : en;

  const options: { id: DashboardHeroCard; label: string; desc: string }[] = [
    {
      id: "studioCard",
      label: pick("Studio report card", "Stüdyo karnesi", "Carte studio", "Tarjeta del estudio"),
      desc: pick("Brand + games + shipped + focus hours + days active.",
        "Stüdyo adı + oyun sayısı + yayında + odak saati + aktif gün.",
        "Marque + jeux + publiés + heures de focus + jours actifs.",
        "Marca + juegos + publicados + horas de foco + días activos."),
    },
    {
      id: "sirada",
      label: pick("Next up", "Sırada", "Prochaine", "Siguiente"),
      desc: pick("The single most urgent task waiting on you.",
        "Bekleyen en acil tek görev.",
        "La tâche la plus urgente.",
        "La tarea más urgente."),
    },
    {
      id: "pomodoro",
      label: pick("Pomodoro session", "Pomodoro oturumu", "Session Pomodoro", "Sesión Pomodoro"),
      desc: pick("Current phase, time left, and a play/pause button.",
        "Aktif faz, kalan süre ve oynat/duraklat butonu.",
        "Phase actuelle, temps restant et bouton play/pause.",
        "Fase actual, tiempo restante y botón play/pause."),
    },
    {
      id: "quickCapture",
      label: pick("Quick capture", "Hızlı yakalama", "Capture rapide", "Captura rápida"),
      desc: pick("Inline input that creates a task or note on Enter.",
        "Enter ile anında görev/not oluşturan inline input.",
        "Champ inline qui crée une tâche/note avec Entrée.",
        "Input inline que crea tarea/nota al pulsar Enter."),
    },
    {
      id: "releaseCountdown",
      label: pick("Release countdown", "Yayın geri sayımı", "Compte à rebours", "Cuenta atrás de lanzamiento"),
      desc: pick("Closest release/build/launch milestones with day count.",
        "En yakın release/build/yayın görevleri ve kalan gün.",
        "Plus proches jalons de sortie avec jours restants.",
        "Próximos hitos de lanzamiento con días restantes."),
    },
    {
      id: "todayMicro",
      label: pick("Today's micro-stats", "Bugün özet", "Stats du jour", "Hoy resumen"),
      desc: pick("Today's closed count, focus minutes, tasks due today.",
        "Bugün kapanan, odak dakikası, bugün due görev.",
        "Tâches fermées, minutes de focus, dues du jour.",
        "Cerradas hoy, minutos de foco, vencen hoy."),
    },
    {
      id: "todayGoal",
      label: pick("Today's goal", "Bugünün hedefi", "Objectif du jour", "Meta del día"),
      desc: pick("Editable single-line goal/mantra, saved per day.",
        "Tek satır editable hedef/mantra, güne özel kaydedilir.",
        "Objectif modifiable d'une ligne, sauvegardé par jour.",
        "Meta editable de una línea, guardada por día."),
    },
    {
      id: "pinnedShortcuts",
      label: pick("Pinned shortcuts", "Sabit kısayollar", "Raccourcis épinglés", "Atajos fijados"),
      desc: pick("Three most recently active games as quick shortcuts.",
        "Son aktif 3 oyun kısayol olarak.",
        "Trois jeux les plus actifs en raccourci.",
        "Tres juegos más activos como atajos."),
    },
    {
      id: "none",
      label: pick("Hide", "Gizle", "Masquer", "Ocultar"),
      desc: pick("No card — hero shrinks accordingly.",
        "Kart yok — hero küçülür.",
        "Pas de carte — le hero rétrécit.",
        "Sin tarjeta — el hero se reduce."),
    },
  ];

  const current = layout.dashboardHeroCard ?? "studioCard";
  return (
    <SettingRow
      title={pick("Hero left card", "Hero sol kartı", "Carte gauche du hero", "Tarjeta izquierda del hero")}
      description={pick(
        "What sits in the top-left of the dashboard, next to the activity strip.",
        "Dashboard'ın sol üstünde, aktivite şeridinin yanında ne dursun.",
        "Ce qui se trouve en haut à gauche du dashboard.",
        "Lo que aparece arriba a la izquierda del dashboard.",
      )}
      control={
        <Dropdown
          value={current}
          options={options.map((o) => ({ id: o.id, label: `${o.label} — ${o.desc}` }))}
          onChange={(id) => setLayout({ dashboardHeroCard: id as DashboardHeroCard })}
        />
      }
    />
  );
}

function DashboardPanelsRow({
  language,
  layout,
  setLayout,
}: {
  language: string;
  layout: LayoutSlice;
  setLayout: (patch: Partial<LayoutSlice>) => void;
}) {
  const panels = layout.dashboardWidgets.panels;
  const pick = (en: string, tr: string, fr: string, es: string) =>
    language === "tr" ? tr : language === "fr" ? fr : language === "es" ? es : en;

  const writeOrder = (next: DashboardPanelEntry[]) =>
    setLayout({ dashboardWidgets: { panels: next } });

  const toggle = (id: DashboardPanelId) =>
    writeOrder(panels.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)));

  const reset = () =>
    writeOrder(DEFAULT_DASHBOARD_PANELS.map((p) => ({ ...p })));

  const enabledCount = panels.filter((p) => p.enabled).length;

  return (
    <div className="dashboard-panels-editor">
      <div className="dashboard-panels-hint">
        <div>
          <p className="dashboard-panels-hint-title">
            {pick(
              "Drag to reorder, click to show/hide.",
              "Sıralamak için sürükle, göstermek/gizlemek için tıkla.",
              "Glisser pour réordonner, cliquer pour afficher/masquer.",
              "Arrastra para reordenar, clic para mostrar/ocultar.",
            )}
          </p>
          <p className="dashboard-panels-hint-sub">
            {pick(
              `${enabledCount} of ${panels.length} panels visible`,
              `${panels.length} panelden ${enabledCount} tanesi açık`,
              `${enabledCount} panneaux visibles sur ${panels.length}`,
              `${enabledCount} de ${panels.length} paneles visibles`,
            )}
          </p>
        </div>
        <button type="button" className="dashboard-panels-reset" onClick={reset}>
          <RotateCcw size={12} />
          {pick("Reset", "Sıfırla", "Réinitialiser", "Restablecer")}
        </button>
      </div>

      <Reorder.Group
        as="ul"
        axis="y"
        values={panels}
        onReorder={(next) => writeOrder(next as DashboardPanelEntry[])}
        className="dashboard-panels-list"
      >
        {panels.map((p) => {
          const copy = pickPanelCopy(p.id, language);
          return (
            <Reorder.Item
              key={p.id}
              value={p}
              as="li"
              className={`dashboard-panel-row ${p.enabled ? "is-enabled" : "is-disabled"}`}
              whileDrag={{ scale: 1.015, boxShadow: "0 14px 32px rgba(0,0,0,0.4)" }}
            >
              <span className="dashboard-panel-handle" aria-hidden="true">
                <GripVertical size={14} />
              </span>
              <div className="dashboard-panel-row-body">
                <strong className="dashboard-panel-row-title">{copy.title}</strong>
                <span className="dashboard-panel-row-desc">{copy.desc}</span>
              </div>
              <Toggle checked={p.enabled} onChange={() => toggle(p.id)} />
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
    </div>
  );
}
