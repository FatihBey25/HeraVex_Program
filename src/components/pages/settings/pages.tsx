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
import { ACCENT_PRESETS } from "../../../lib/appearance";
import {
  ENGINE_OPTIONS, EXPERIENCE_OPTIONS, LANGUAGE_OPTIONS, ROLE_OPTIONS,
  type EngineId, type ExperienceLevel, type RoleId, type LanguageId,
} from "../../../lib/userProfile";
import { imgSrc } from "../../../lib/images";
import { APP_VERSION, APP_BUILD_DATE, RELEASES_URL, FEEDBACK_EMAIL } from "../../../lib/app-meta";
import {
  openExternal, revealInFolder, getWorkspacePath, setWorkspacePath, clearWorkspacePath,
  pickDirectory, pickGooglePlayJson, fetchStoreGames,
  computeStorageStats, listBackups, deleteBackup,
  type StorageStats, type BackupEntry,
} from "../../../lib/storage";
import { postDiscordWebhook, type WebhookEvent } from "../../../lib/teamWebhooks";
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
import { useEffect, useState } from "react";
import type { SettingsSection } from "./sections";

/** A throwaway "this control will be wired up later" chip. Sits in
 *  the SettingRow control slot so the row's right edge looks
 *  identical to a real future control. */
function ComingChip() {
  const { ui } = useAppStore();
  return <span className="setting-row-soon-chip">{ui.settingsRowComingSoon}</span>;
}

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
  const { ui, studioIdentity, setStudioIdentity } = useAppStore();
  const s = studioIdentity;
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
          description={ui.studioLogoDesc}
          badge="v1.0"
          disabled
          control={<ComingChip />}
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
  const { ui, language } = useAppStore();
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
        <span className="setting-row-desc">{language === "tr" ? "Side bar + arkaplanı tek tıkla eşleştir." : "Pair sidebar + background in one click."}</span>
      </div>
      <div className="theme-preview-grid">
        {presets.map((p) => {
          const isActive = activeMain === p.main && activeSidebar === p.sidebar;
          return (
            <button
              key={p.id}
              type="button"
              className={`theme-preview-card theme-preview-${p.main}${isActive ? " is-active" : ""}`}
              onClick={() => onPick(p.main, p.sidebar)}
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
      </div>
      <span style={{ fontSize: 11, color: "#94a3b8" }}>{ui.themeAccentTargetSidebar /* "Apply to sidebar" — reused tag */}</span>
    </div>
  );
}

function ThemePage() {
  const { ui, appearance, setAppearance } = useAppStore();
  const a = appearance;
  // Light mode lives behind a "v1.0" badge: the CSS class hook lands
  // in M2 but the light palette refactor itself is a future move. We
  // disable selecting it rather than silently swap to a half-styled
  // page.
  return (
    <>
      <SettingGroup label={ui.themeGroupMode}>
        <SettingRow
          title={ui.themeMode}
          description={ui.themeModeDesc}
          control={
            <PillGroup
              value={a.theme}
              options={[
                { id: "system", label: ui.themeModeSystem },
                { id: "dark",   label: ui.themeModeDark },
              ]}
              onChange={(id) => setAppearance({ theme: id })}
            />
          }
        />
        <SettingRow
          title={ui.themeModeLight}
          description={ui.themeModeLightDesc}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
      </SettingGroup>

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
          onPick={(mainId, sidebarId) => setAppearance({
            bgMain: mainId as typeof a.bgMain,
            bgSidebar: sidebarId as typeof a.bgSidebar,
          })}
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
  const defaultWidgets = { overview: true, projects: true, tasks: true };
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
          title={ui.layoutSidebarCollapseHover}
          badge="v1.0"
          disabled
          control={<ComingChip />}
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
        <SettingRow
          title={language === "tr" ? "Genel bakış paneli" : "Overview panel"}
          description={language === "tr" ? "Toplam harcama, oranlar, harcama grafiği." : "Total spend, ratios, spend-by-project chart."}
          control={
            <Toggle
              checked={(l.dashboardWidgets ?? defaultWidgets).overview}
              onChange={(v) => setLayout({ dashboardWidgets: { ...(l.dashboardWidgets ?? defaultWidgets), overview: v } })}
            />
          }
        />
        <SettingRow
          title={language === "tr" ? "Projeler paneli" : "Projects panel"}
          description={language === "tr" ? "Son projeler ve ilerleme çubukları." : "Recent projects with progress bars."}
          control={
            <Toggle
              checked={(l.dashboardWidgets ?? defaultWidgets).projects}
              onChange={(v) => setLayout({ dashboardWidgets: { ...(l.dashboardWidgets ?? defaultWidgets), projects: v } })}
            />
          }
        />
        <SettingRow
          title={language === "tr" ? "Görev paneli" : "Tasks panel"}
          description={language === "tr" ? "Öncelikli bekleyen görevler." : "High-priority pending tasks."}
          control={
            <Toggle
              checked={(l.dashboardWidgets ?? defaultWidgets).tasks}
              onChange={(v) => setLayout({ dashboardWidgets: { ...(l.dashboardWidgets ?? defaultWidgets), tasks: v } })}
            />
          }
        />
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
          title={ui.generalWeekStart}
          control={
            <PillGroup
              value={g.weekStart}
              options={[
                { id: "monday",   label: ui.generalWeekMon },
                { id: "saturday", label: ui.generalWeekSat },
                { id: "sunday",   label: ui.generalWeekSun },
              ]}
              onChange={(id) => setGeneral({ weekStart: id as typeof g.weekStart })}
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
  const { ui, startup, setStartup } = useAppStore();
  const s = startup;
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
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
        <SettingRow
          title={ui.startupCloseTray}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
        <SettingRow
          title={ui.startupMultiWindow}
          description={ui.startupMultiWindowDesc}
          badge="v1.0"
          disabled
          control={<ComingChip />}
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
  const { ui, pomodoroPrefs, setPomodoroPrefs } = useAppStore();
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
          badge="v1.0"
          disabled
          control={<ComingChip />}
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
  const { ui, language, showError, showToast, refreshGames } = useAppStore();
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
        <SettingRow title={ui.storageClearCache}        badge="v1.0" disabled control={<ComingChip />} />
        <SettingRow title={ui.storageRemoveTemp}        badge="v1.0" disabled control={<ComingChip />} />
        <SettingRow title={ui.storageOrphanMoodboard}   badge="v1.0" disabled control={<ComingChip />} />
        <SettingRow title={ui.storageIntegrityCheck}    badge="v1.0" disabled control={<ComingChip />} />
      </SettingGroup>

      <SettingGroup label={ui.storageGroupAutoMaintenance}>
        <SettingRow title={ui.storageAutoPrune}     badge="v1.0" disabled control={<ComingChip />} />
        <SettingRow title={ui.storageVersionsKeep}  badge="v1.0" disabled control={<ComingChip />} />
      </SettingGroup>
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
  const [history, setHistory] = useState<BackupEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

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
          description={ui.backupMirrorCloudDesc}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
      </SettingGroup>

      <SettingGroup label={ui.backupGroupRetention}>
        <SettingRow
          title={ui.backupRetention}
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
          badge="v1.0"
          disabled
          control={<ComingChip />}
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
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
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

function ImportExportPage() {
  const { ui, handleExportBackup } = useAppStore();
  return (
    <>
      <SettingGroup label={ui.ieGroupExport}>
        <SettingRow
          title={ui.ieExportAll}
          description={ui.ieExportAllDesc}
          control={
            <CompactButton onClick={() => void handleExportBackup()}>
              {ui.ieExportBtn}
            </CompactButton>
          }
        />
        <SettingRow
          title={ui.ieExportGame}
          description={ui.ieExportGameDesc}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
        <SettingRow
          title={ui.ieExportNotesMd}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
        <SettingRow
          title={ui.ieExportTasksCsv}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
      </SettingGroup>

      <SettingGroup label={ui.ieGroupImport} hint={ui.ieImportBanner}>
        <SettingRow title="Notion"          badge="v1.0" disabled control={<ComingChip />} />
        <SettingRow title="Trello"          badge="v1.0" disabled control={<ComingChip />} />
        <SettingRow title="Obsidian"        badge="v1.0" disabled control={<ComingChip />} />
        <SettingRow title={ui.ieImportMd}   badge="v1.0" disabled control={<ComingChip />} />
        <SettingRow title={ui.ieImportCsv}  badge="v1.0" disabled control={<ComingChip />} />
        <SettingRow title={ui.ieImportJson} badge="v1.0" disabled control={<ComingChip />} />
      </SettingGroup>
    </>
  );
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
        <SettingRow
          title={ui.apiSyncInterval}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
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
        <SettingRow
          title={ui.apiSyncInterval}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
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
        <SettingRow
          title={ui.apiSyncInterval}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
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
  const { ui, teamMode, setTeamMode, showToast, showError, refreshGames } = useAppStore();
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

  const pickWorkspace = async () => {
    setBusy(true);
    try {
      const dir = await pickDirectory();
      if (dir) {
        await setWorkspacePath(dir);
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
        <SettingRow
          title={ui.teamModeConflictStrategy}
          control={
            <Dropdown
              value={teamMode.conflictStrategy}
              options={[
                { id: "lastWriterWins", label: ui.teamModeConflictLast },
                { id: "manualMerge",    label: ui.teamModeConflictManual },
                { id: "autoMerge",      label: ui.teamModeConflictAuto },
              ]}
              onChange={(id) => setTeamMode({ conflictStrategy: id as typeof teamMode.conflictStrategy })}
            />
          }
        />
        <SettingRow
          title={ui.teamModeWatcherDelay}
          description={ui.teamModeWatcherDelayDesc}
          control={
            <PillGroup
              value={teamMode.watcherDelay}
              options={[
                { id: "instant", label: ui.teamModeDelayInstant },
                { id: "5s",      label: "5s" },
                { id: "30s",     label: "30s" },
                { id: "2m",      label: "2m" },
              ]}
              onChange={(id) => setTeamMode({ watcherDelay: id as typeof teamMode.watcherDelay })}
            />
          }
        />
        <SettingRow
          title={ui.teamModeShowLogs}
          control={<Toggle checked={teamMode.showWatcherLogs} onChange={(v) => setTeamMode({ showWatcherLogs: v })} />}
        />
        <SyncStatusRow />
        <SettingRow
          title={ui.teamModePresence}
          control={<Toggle checked={teamMode.showPresence} onChange={(v) => setTeamMode({ showPresence: v })} />}
        />
      </SettingGroup>

      <SettingGroup label={ui.teamModeGroupInfo}>
        <SettingRow title={ui.teamModeInfoAtomic}   description={ui.teamModeInfoAtomicDesc} />
        <SettingRow title={ui.teamModeInfoWatcher}  description={ui.teamModeInfoWatcherDesc} />
        <SettingRow title={ui.teamModeInfoActivity} description={ui.teamModeInfoActivityDesc} />
      </SettingGroup>
    </>
  );
}

function WebhooksPage() {
  const { ui, webhooks, setWebhooks, showToast, showError } = useAppStore();
  const d = webhooks.discord;
  const g = webhooks.github;
  const [testing, setTesting] = useState(false);

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

      <SettingGroup label={ui.webhookGroupCustom} hint={ui.webhookCustomBanner}>
        <SettingRow
          title={ui.webhookCustomNone}
          description={ui.webhookCustomDesc}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
      </SettingGroup>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SYSTEM
// ─────────────────────────────────────────────────────────────────────

function PrivacyPage() {
  const { ui, privacy, setPrivacy, showToast, showError, refreshGames } = useAppStore();
  const p = privacy;
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
          description={ui.privacyKeychainDesc}
          badge="v1.0"
          disabled
          control={<ComingChip />}
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
  const { ui, experimental, setExperimental, showError } = useAppStore();
  const e = experimental;

  return (
    <>
      <SettingGroup label={ui.expGroupGeneral}>
        <SettingRow
          title={ui.expBetaEnabled}
          description={ui.expBetaEnabledDesc}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
        <SettingRow
          title={ui.expChannel}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
        <SettingRow
          title={ui.expJoin}
          description={ui.expJoinDesc}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
      </SettingGroup>

      <SettingGroup label={ui.expGroupActive}>
        {/* M7 ships no active betas — the toggles will land slice-by-slice
         *  in v1.0. We surface the design now so users can audit. */}
        <SettingRow
          title={ui.expBetaNotionImport}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
        <SettingRow
          title={ui.expBetaMultiWorkspace}
          badge="v1.0"
          disabled
          control={<ComingChip />}
        />
        <SettingRow
          title={ui.expBetaCustomWidgets}
          badge="v1.0"
          disabled
          control={<ComingChip />}
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
