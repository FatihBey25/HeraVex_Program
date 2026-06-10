// Notification + Startup + Pomodoro preferences.
//
// Same pattern as appearance.ts and userProfile.ts: a typed slice
// per page, default values that match the v0.8 implicit behaviour,
// localStorage helpers, and a few enum option arrays for the picker
// rendering.
//
// Most of these knobs are "honest persistence" — the value is saved
// and consumed by whichever surface actually triggers the behaviour
// (e.g., the Tauri notification helper checks
// notifications.taskApproachingDeadline before posting). A few
// (window memory, system tray, GPU acceleration) require Tauri
// build-time plumbing the app doesn't ship yet; those land in
// future milestones. We surface them on the Startup page anyway so
// the user can see what's coming and the value persists for when
// the plumbing exists. The Settings UI tags them with a "Restart
// required" hint where appropriate.

import type { WorkspaceTab } from "../store";

// ── Notifications ────────────────────────────────────────────────────

export type DeadlineNoticeWindow = 1 | 3 | 7 | 14;
export type NotificationSound = "silent" | "soft" | "classic" | "pop" | "custom";

export interface NotificationsSlice {
  // TASK
  taskApproachingDeadline: boolean;
  deadlineNoticeWindow: DeadlineNoticeWindow;
  overdueDailyReminder: boolean;
  /** HH:mm in 24h, used as the daily reminder fire time. */
  reminderTime: string;

  // POMODORO
  pomodoroSoundOnComplete: boolean;
  pomodoroDesktopNotification: boolean;
  suggestBreak: boolean;

  // SYSTEM
  storeSyncErrors: boolean;
  storeSyncSuccessSilent: boolean;
  newReleaseAvailable: boolean;
  backupCompleted: boolean;

  // SOUND
  //
  // v0.9 polish — the spec called for one configurable sound, not
  // a list of indistinguishable presets. `customSoundDataUrl` holds
  // the user-picked mp3/wav as a base64 data URL so it round-trips
  // through the backup JSON like every other preference. `volume`
  // applies to both the custom sound and the fallback synth beep.
  // `notificationSound` is kept for migration but ignored by the
  // player — the UI no longer surfaces it.
  notificationSound: NotificationSound;
  customSoundDataUrl: string;
  customSoundName: string;
  volume: number; // 0..100
}

export const DEFAULT_NOTIFICATIONS: NotificationsSlice = {
  taskApproachingDeadline: true,
  deadlineNoticeWindow: 3,
  overdueDailyReminder: true,
  reminderTime: "09:00",

  pomodoroSoundOnComplete: true,
  pomodoroDesktopNotification: true,
  suggestBreak: true,

  storeSyncErrors: true,
  storeSyncSuccessSilent: true,
  newReleaseAvailable: true,
  backupCompleted: false,

  notificationSound: "soft",
  customSoundDataUrl: "",
  customSoundName: "",
  volume: 70,
};

// ── Startup & Window ────────────────────────────────────────────────

export type InitialPage =
  | "dashboard" | "library" | "storehub" | "tasks"
  | "notes" | "calendar" | "wallet" | "analytics"
  | "lastOpen";

export interface StartupSlice {
  // LAUNCH
  initialPage: InitialPage;
  restoreLastActiveGame: boolean;
  /** When false the tutorial gate stays closed even for empty workspaces. */
  showTutorial: boolean;

  // WINDOW (Tauri integration deferred — values persist for later)
  rememberPosition: boolean;
  rememberSize: boolean;
  alwaysOnTop: boolean;
  minimiseToTray: boolean;
  closeToTray: boolean;
  multiWindow: boolean;

  // PERFORMANCE (similarly deferred)
  gpuAcceleration: boolean;
  lowPowerOnBattery: boolean;
  backgroundTasks: boolean;
}

export const DEFAULT_STARTUP: StartupSlice = {
  initialPage: "dashboard",
  restoreLastActiveGame: true,
  showTutorial: true,

  rememberPosition: true,
  rememberSize: true,
  alwaysOnTop: false,
  minimiseToTray: false,
  closeToTray: false,
  multiWindow: false,

  gpuAcceleration: true,
  lowPowerOnBattery: false,
  backgroundTasks: true,
};

// ── Pomodoro ────────────────────────────────────────────────────────

export type TimerVisibility = "always" | "whenTaskOpen" | "sidebarWidget";
export type TimerStyle = "numeric" | "bar" | "circle";
export type TimerPosition = "topRight" | "bottomLeft" | "floating";

export interface PomodoroPrefsSlice {
  // DURATIONS (minutes)
  focusMinutes: number;        // 15..60
  shortBreakMinutes: number;   // 3..15
  longBreakMinutes: number;    // 15..30
  /** Long break fires every N completed focus sessions. */
  longBreakCadence: number;    // 2..5

  // BEHAVIOUR
  autoStartNextPomodoro: boolean;
  autoResumeAfterBreak: boolean;
  markTaskDoneOnCompletion: boolean;
  lockAppDuringBreak: boolean;

  // VISUAL
  visibility: TimerVisibility;
  style: TimerStyle;
  position: TimerPosition;
}

export const DEFAULT_POMODORO_PREFS: PomodoroPrefsSlice = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakCadence: 4,

  autoStartNextPomodoro: false,
  autoResumeAfterBreak: false,
  markTaskDoneOnCompletion: false,
  lockAppDuringBreak: false,

  visibility: "sidebarWidget",
  style: "numeric",
  position: "topRight",
};

// ── Persistence ─────────────────────────────────────────────────────

const KEY_NOTIFICATIONS = "heravex_notifications_v1";
const KEY_STARTUP       = "heravex_startup_v1";
const KEY_POMODORO      = "heravex_pomodoro_prefs_v1";

export function loadNotifications(): NotificationsSlice {
  return safeRead(KEY_NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
}
export function loadStartup(): StartupSlice {
  return safeRead(KEY_STARTUP, DEFAULT_STARTUP);
}
export function loadPomodoroPrefs(): PomodoroPrefsSlice {
  return safeRead(KEY_POMODORO, DEFAULT_POMODORO_PREFS);
}
export function saveNotifications(s: NotificationsSlice) { safeWrite(KEY_NOTIFICATIONS, s); }
export function saveStartup(s: StartupSlice)             { safeWrite(KEY_STARTUP, s); }
export function savePomodoroPrefs(s: PomodoroPrefsSlice) { safeWrite(KEY_POMODORO, s); }

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

// ── Page options ────────────────────────────────────────────────────

export const INITIAL_PAGE_OPTIONS: { id: InitialPage; labelKey: string; workspaceTab: WorkspaceTab | null }[] = [
  { id: "dashboard", labelKey: "dashboard",   workspaceTab: "dashboard" },
  { id: "library",   labelKey: "library",     workspaceTab: "library" },
  { id: "storehub",  labelKey: "storeHub",    workspaceTab: "storehub" },
  { id: "tasks",     labelKey: "taskCenter",  workspaceTab: "tasks" },
  { id: "notes",     labelKey: "notebook",    workspaceTab: "notes" },
  { id: "calendar",  labelKey: "calendar",    workspaceTab: "calendar" },
  { id: "wallet",    labelKey: "wallet",      workspaceTab: "wallet" },
  { id: "analytics", labelKey: "analytics",   workspaceTab: "analytics" },
  // "lastOpen" defers to whatever workspaceTab was active when the user
  // last closed the app. App.tsx never overrides in that case.
  { id: "lastOpen",  labelKey: "startupLastOpen", workspaceTab: null },
];
