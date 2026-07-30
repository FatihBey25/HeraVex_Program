import { create } from "zustand";
import { devWarn } from "../lib/devLog";
import * as storage from "../lib/storage";
import { copy, defaultReleaseTemplate, compareTasks, type AppLanguage, type DetailTab } from "../lib/i18n";
import type { ExpenseItem, GameRecord, MoodboardCategory, MoodboardItem, NoteRecord, ReleaseTemplateItem, TaskItem } from "../types";
import { defaultMoodboardCategoriesForLanguage } from "../lib/moodboardDefaults";
import {
  DEFAULT_APPEARANCE, DEFAULT_LAYOUT, DEFAULT_TYPOGRAPHY,
  loadAppearance, loadLayout, loadTypography,
  saveAppearance, saveLayout, saveTypography,
  type AppearanceSlice, type LayoutSlice, type TypographySlice,
} from "../lib/appearance";
import {
  DEFAULT_GENERAL, DEFAULT_PROFILE,
  loadGeneral, loadProfile, saveGeneral, saveProfile,
  type GeneralSlice, type ProfileSlice,
} from "../lib/userProfile";
import {
  DEFAULT_NOTIFICATIONS, DEFAULT_POMODORO_PREFS, DEFAULT_STARTUP,
  loadNotifications, loadPomodoroPrefs, loadStartup,
  saveNotifications, savePomodoroPrefs, saveStartup,
  type NotificationsSlice, type PomodoroPrefsSlice, type StartupSlice,
} from "../lib/preferences";
import {
  DEFAULT_BACKUP_PREFS, DEFAULT_STUDIO_IDENTITY,
  loadBackupPrefs, loadStudioIdentity,
  saveBackupPrefs, saveStudioIdentity,
  type BackupPrefsSlice, type StudioIdentitySlice,
} from "../lib/studioIdentity";
import {
  DEFAULT_TEAM_MODE, DEFAULT_WEBHOOKS,
  loadTeamMode, loadWebhooks, saveTeamMode, saveWebhooks,
  type TeamModeSlice, type WebhooksSlice,
} from "../lib/teamWebhooks";
import {
  DEFAULT_EXPERIMENTAL, DEFAULT_PRIVACY,
  loadExperimental, loadPrivacy, saveExperimental, savePrivacy,
  type ExperimentalSlice, type PrivacySlice,
} from "../lib/privacyExperimental";
import { notify } from "../lib/notify";
import { translateError } from "../lib/errorTranslate";
import { timerPause, timerStart } from "../lib/taskTimer";
import { ensureBoardColumns } from "../lib/boardColumns";

export type WorkspaceTab =
  | "dashboard"
  | "library"
  | "storehub"
  | "tasks"
  | "notes"
  | "flow"
  | "calendar"
  | "wallet"
  | "analytics"
  | "profile"
  // Plugin-contributed pages: `plugin:<pluginId>/<pageId>`. The union
  // stays closed for core tabs so `===` narrowing keeps working.
  | `plugin:${string}`;

export type Toast = {
  id: number;
  message: string;
  type: "success" | "error" | "info" | "warning";
  exiting: boolean;
  undoCallback?: () => void;
  actionLabel?: string;
};

const LANGUAGE_OPTIONS = ["en", "tr", "fr", "es"] as const;

let toastCounter = 0;

/** Detect and invert exchange rates that were saved in the wrong
 *  direction by pre-v0.8.5 builds. Our internal model is "USD per 1
 *  unit of CUR", so any non-USD entry greater than 2 is almost
 *  certainly "1 USD = X CUR" leaked from the Frankfurter API.
 *
 *  Returns a fresh object. USD always maps to 1. Zero or negative
 *  entries are dropped to avoid division-by-zero downstream. */
function healInvertedRates(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { USD: 1 };
  for (const [code, value] of Object.entries(raw)) {
    if (code === "USD") continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    out[code] = value > 2 ? 1 / value : value;
  }
  return out;
}

// ─── Moodboard link helpers (module-private) ─────────────────────────────────
//
// The store actions delegate every link-array mutation to the helpers
// below. Keeping them at module scope (instead of inline closures) is
// what makes the invariant easy to audit: a grep for the function
// names lists every place in the codebase that touches the link
// arrays.

/** Add or remove `id` from a possibly-undefined string array, returning
 *  a fresh array with no duplicates. `attach=true` adds; `false`
 *  removes. This is the SINGLE source of mutation for the four link
 *  arrays (`linked*Ids` and `moodboardImageIds`).
 *
 *  Exported so tests can pin down the dedupe + idempotency contract
 *  without standing up the whole store. Production code should never
 *  import this — go through the link/unlink store actions instead. */
export function mutateLinkArray(arr: string[] | undefined, id: string, attach: boolean): string[] {
  const set = new Set(arr ?? []);
  if (attach) set.add(id);
  else set.delete(id);
  return Array.from(set);
}

/** Notify any open NoteCenter that a note was modified outside its
 *  local state (e.g. moodboard link/unlink, removeNote cascade). The
 *  listener re-fetches `getAllNotes()`. We use a custom event rather
 *  than putting notes into the global store because NoteCenter's
 *  editor state is large and refactoring it into Zustand would balloon
 *  this PR. */
function notifyNotesUpdated() {
  try {
    window.dispatchEvent(new CustomEvent("heravex:notes-updated"));
  } catch {
    // Non-browser context (tests) — silent fall-through.
  }
}

/** Load a single note by id by filtering the full notes list. There
 *  is no `getNote(id)` storage primitive yet; notes are atomic per-file
 *  but only a "load all" command is exposed. For workspaces with
 *  thousands of notes this would become a hot path — promote to a
 *  dedicated Rust command then. For now it's O(n) on every link cascade. */
async function loadNoteById(noteId: string): Promise<NoteRecord | null> {
  try {
    const all = await storage.getAllNotes();
    return all.find((n) => n.id === noteId) ?? null;
  } catch {
    return null;
  }
}

type StoreGetter = () => AppStore;

/** Bidirectional link/unlink between a moodboard item and a task in
 *  the SAME game. Writes both sides in a single `handleSaveGame` call
 *  so the game JSON never serialises in a half-linked state. */
async function applyMoodboardTaskLink(
  getStore: StoreGetter,
  gameId: string,
  itemId: string,
  taskId: string,
  attach: boolean,
) {
  const { games, handleSaveGame } = getStore();
  const game = games.find((g) => g.id === gameId);
  if (!game) return;
  const item = game.moodboard.items.find((m) => m.id === itemId);
  const task = game.tasks.find((t) => t.id === taskId);
  if (!item || !task) return;

  const newItem: MoodboardItem = {
    ...item,
    linkedTaskIds: mutateLinkArray(item.linkedTaskIds, taskId, attach),
  };
  const newTask: TaskItem = {
    ...task,
    moodboardImageIds: mutateLinkArray(task.moodboardImageIds, itemId, attach),
  };

  const moodboard = {
    ...game.moodboard,
    items: game.moodboard.items.map((m) => (m.id === itemId ? newItem : m)),
  };
  const tasks = game.tasks.map((t) => (t.id === taskId ? newTask : t));
  await handleSaveGame({ ...game, tasks, moodboard });
}

/** Bidirectional link/unlink between a moodboard item and a note.
 *  Notes are persisted separately, so this writes TWO files: the
 *  game's JSON (for the moodboard side) and the note's JSON (for the
 *  `moodboardImageIds` side). Both writes are best-effort independent —
 *  if the note write fails we still save the game so the moodboard
 *  side reflects user intent, and a follow-up reconciliation pass
 *  can heal the note later. */
async function applyMoodboardNoteLink(
  getStore: StoreGetter,
  gameId: string,
  itemId: string,
  noteId: string,
  attach: boolean,
) {
  const { games, handleSaveGame } = getStore();
  const game = games.find((g) => g.id === gameId);
  if (!game) return;
  const item = game.moodboard.items.find((m) => m.id === itemId);
  if (!item) return;

  // Load the latest note from disk — NoteCenter holds its own copy
  // but we don't have access to it from the store, and a stale copy
  // would overwrite recent edits if we saved through cached data.
  const note = await loadNoteById(noteId);
  if (!note) return;

  // v0.9.7 race-condition pass: two-phase write with rollback.
  //
  // Previously the note was written first; if the subsequent game
  // write failed, the link was permanently inconsistent — the note
  // pointed at an item the moodboard had no record of. The new
  // sequence:
  //   1. Save the note (with the new link in `moodboardImageIds`).
  //   2. Save the game (with the matching link in `linkedNoteIds`).
  //   3. On step-2 failure, REVERT the note to the original copy so
  //      the two sides converge on the pre-mutation state.
  // If the revert itself fails (truly catastrophic disk error), we
  // surface a toast so the user knows a manual reconciliation is
  // needed — silently shipping inconsistent state was the old bug.
  const originalNote = note;
  const newNote: NoteRecord = {
    ...note,
    moodboardImageIds: mutateLinkArray(note.moodboardImageIds, itemId, attach),
  };
  let noteWritten = false;
  try {
    await storage.saveNote(newNote);
    notifyNotesUpdated();
    noteWritten = true;
  } catch (err) {
    devWarn(`[applyMoodboardNoteLink] note save failed:`, err);
    // Note write itself failed — nothing on disk yet, no rollback
    // needed. Skip the game write to keep both sides consistent.
    return;
  }

  const newItem: MoodboardItem = {
    ...item,
    linkedNoteIds: mutateLinkArray(item.linkedNoteIds, noteId, attach),
  };
  const moodboard = {
    ...game.moodboard,
    items: game.moodboard.items.map((m) => (m.id === itemId ? newItem : m)),
  };
  const saved = await handleSaveGame({ ...game, moodboard });
  if (saved === null && noteWritten) {
    // Game save failed AFTER the note was written — roll the note
    // back to its pre-link state so the two files converge again.
    try {
      await storage.saveNote(originalNote);
      notifyNotesUpdated();
    } catch (revertErr) {
      devWarn(`[applyMoodboardNoteLink] revert also failed:`, revertErr);
      try {
        getStore().showToast(
          "Moodboard bağlantısı yarım kaldı — Notlar ve Moodboard panelini elle kontrol et.",
          "error",
        );
      } catch { /* showToast unavailable in test contexts */ }
    }
  }
}

interface AppStore {
  // ── core data ──────────────────────────────────────────────────────────────
  games: GameRecord[];
  globalExpenses: ExpenseItem[];
  releaseTemplate: ReleaseTemplateItem[];
  exchangeRates: Record<string, number>;
  activeCurrencies: string[];
  steamApiKey: string;
  itchApiKey: string;
  steamUserId: string;
  avatarPath: string;
  googlePlayJsonPath: string;

  // ── ui state ───────────────────────────────────────────────────────────────
  language: AppLanguage;
  showLanguagePrompt: boolean;
  workspaceTab: WorkspaceTab;
  selectedId: string;
  activeTaskId: string;
  isLoading: boolean;
  statusMessage: string;
  toasts: Toast[];

  // ── computed helpers (updated via actions) ─────────────────────────────────
  ui: typeof copy["en"];

  // ── setters ────────────────────────────────────────────────────────────────
  setLanguage: (lang: AppLanguage) => Promise<void>;
  setShowLanguagePrompt: (v: boolean) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  setSelectedId: (id: string) => void;
  setActiveTaskId: (id: string) => void;
  setActiveCurrencies: (currencies: string[]) => void;

  // ── toasts ─────────────────────────────────────────────────────────────────
  showToast: (message: string, type?: "success" | "error" | "info" | "warning", undoCallback?: () => void, actionLabel?: string) => void;
  /** Translate a backend (Rust) error to the active language and show as toast.
   *  Returns the translated string for callers that also need to inspect it. */
  showError: (err: unknown) => string;

  // ── game actions ───────────────────────────────────────────────────────────
  init: () => Promise<void>;
  refreshGames: (preferredId?: string, opts?: { silent?: boolean }) => Promise<void>;
  applySavedGame: (game: GameRecord) => void;
  handleCreateGame: (opts: {
    title: string;
    summary: string;
    status: string;
    platforms: string[];
    tags: string[];
    budget?: number;
  }) => Promise<GameRecord | null>;
  /** Saves a game through the IPC layer. Returns `null` when the save
   *  fails — caller MUST check before treating the operation as a
   *  success (e.g. closing modals, resetting forms). Errors surface as
   *  toasts internally so call sites don't need their own try/catch. */
  handleSaveGame: (game: GameRecord, message?: string) => Promise<GameRecord | null>;
  handleDeleteGame: (gameId: string) => Promise<void>;

  // ── task actions ───────────────────────────────────────────────────────────
  toggleTask: (gameId: string, taskId: string) => Promise<void>;
  deleteTask: (gameId: string, taskId: string) => Promise<void>;
  updateTaskInGame: (gameId: string, taskId: string, patch: Partial<TaskItem>) => Promise<void>;

  // ── version actions ────────────────────────────────────────────────────────
  handleAddVersion: (gameId: string, version: string, notes: string) => Promise<GameRecord | null>;
  handleDeleteVersion: (gameId: string, versionId: string) => Promise<void>;

  // ── moodboard ─────────────────────────────────────────────────────────────
  addMoodboardItems: (gameId: string, items: MoodboardItem[]) => Promise<void>;
  updateMoodboardItem: (gameId: string, itemId: string, patch: Partial<MoodboardItem>) => Promise<void>;
  /** Removes the moodboard item AND cascades: strips the item id from
   *  every linked task's `moodboardImageIds`, and from every linked
   *  note's `moodboardImageIds`. Other code paths must NEVER delete a
   *  moodboard item directly — always go through this action so the
   *  bidirectional invariant holds. */
  deleteMoodboardItem: (gameId: string, itemId: string) => Promise<void>;
  /** Move an item to a different category (or to Uncategorized when
   *  `toCategoryId` is null). */
  moveMoodboardItem: (gameId: string, itemId: string, toCategoryId: string | null) => Promise<void>;
  /** Adds a category with a generated id. Returns the created entry. */
  addMoodboardCategory: (gameId: string, name: string) => Promise<MoodboardCategory | null>;
  renameMoodboardCategory: (gameId: string, categoryId: string, name: string) => Promise<void>;
  /** Deleting a category drops its `categoryId` on every contained
   *  item — items remain visible under "Uncategorized". */
  deleteMoodboardCategory: (gameId: string, categoryId: string) => Promise<void>;
  /** Persist a new explicit `order` for categories. `orderedIds` may
   *  omit unknown ids; they're appended at the end. */
  reorderMoodboardCategories: (gameId: string, orderedIds: string[]) => Promise<void>;
  /** Link helpers — these are the ONLY entry points that may write
   *  the four arrays involved in the moodboard relation:
   *    `MoodboardItem.linkedTaskIds`, `MoodboardItem.linkedNoteIds`,
   *    `TaskItem.moodboardImageIds`, `NoteRecord.moodboardImageIds`.
   *  Anywhere else mutating those arrays is a bug. */
  linkMoodboardItemToTask: (gameId: string, itemId: string, taskId: string) => Promise<void>;
  unlinkMoodboardItemFromTask: (gameId: string, itemId: string, taskId: string) => Promise<void>;
  linkMoodboardItemToNote: (gameId: string, itemId: string, noteId: string) => Promise<void>;
  unlinkMoodboardItemFromNote: (gameId: string, itemId: string, noteId: string) => Promise<void>;
  /** Delete a note AND clean up every moodboard item that linked to
   *  it. NoteCenter calls this instead of `storage.deleteNote` so the
   *  cascade can never be skipped. */
  removeNote: (noteId: string) => Promise<void>;
  /** Persist a new global order for studio notes. Receives the ids in
   *  the desired display order; assigns `order = idx` to each and
   *  saves them one by one. The frontend then refetches via the
   *  `heravex:notes-updated` event so other panes pick up the change. */
  reorderNotes: (orderedIds: string[]) => Promise<void>;

  // ── release template ──────────────────────────────────────────────────────
  handleSaveReleaseTemplate: (template: ReleaseTemplateItem[]) => Promise<void>;

  // ── expenses ───────────────────────────────────────────────────────────────
  handleAddExpense: (expense: ExpenseItem, gameId: string | null) => Promise<void>;
  handleDeleteExpense: (expenseId: string, gameId: string | null) => Promise<void>;
  /** Patch a single global (studio-wide) expense — used for toggling
   *  `sharedWithGameIds` from the wallet's general expense list. */
  updateGlobalExpense: (expenseId: string, patch: Partial<ExpenseItem>) => Promise<void>;

  // ── settings / backup ─────────────────────────────────────────────────────
  handleSaveExchangeRates: (rates: Record<string, number>) => Promise<void>;
  handleExportBackup: () => Promise<void>;
  handleImportBackup: (path?: string) => Promise<void>;

  // ── v0.9 M2: appearance / typography / layout (live preview) ──────────────
  appearance: AppearanceSlice;
  typography: TypographySlice;
  layout: LayoutSlice;
  // ── v0.9 M3: profile + general locale (localStorage-backed) ───────────────
  profile: ProfileSlice;
  general: GeneralSlice;
  setProfile: (patch: Partial<ProfileSlice>) => void;
  setGeneral: (patch: Partial<GeneralSlice>) => void;
  resetProfile: () => void;
  resetGeneral: () => void;
  // ── v0.9 M4: notifications / startup / pomodoro prefs ─────────────────────
  notifications: NotificationsSlice;
  startup: StartupSlice;
  pomodoroPrefs: PomodoroPrefsSlice;
  setNotifications: (patch: Partial<NotificationsSlice>) => void;
  setStartup: (patch: Partial<StartupSlice>) => void;
  setPomodoroPrefs: (patch: Partial<PomodoroPrefsSlice>) => void;
  resetNotifications: () => void;
  resetStartup: () => void;
  resetPomodoroPrefs: () => void;
  // ── v0.9 M5: studio identity + backup prefs ──────────────────────────────
  studioIdentity: StudioIdentitySlice;
  backupPrefs: BackupPrefsSlice;
  setStudioIdentity: (patch: Partial<StudioIdentitySlice>) => void;
  setBackupPrefs: (patch: Partial<BackupPrefsSlice>) => void;
  resetStudioIdentity: () => void;
  resetBackupPrefs: () => void;
  // ── v0.9 M6: team mode + webhooks ────────────────────────────────────────
  teamMode: TeamModeSlice;
  webhooks: WebhooksSlice;
  setTeamMode: (patch: Partial<TeamModeSlice>) => void;
  setWebhooks: (patch: Partial<WebhooksSlice>) => void;
  resetTeamMode: () => void;
  resetWebhooks: () => void;
  // ── v0.9 M7: privacy + experimental ─────────────────────────────────────
  privacy: PrivacySlice;
  experimental: ExperimentalSlice;
  setPrivacy: (patch: Partial<PrivacySlice>) => void;
  setExperimental: (patch: Partial<ExperimentalSlice>) => void;
  resetPrivacy: () => void;
  resetExperimental: () => void;
  /** Patch a subset of the appearance slice and persist immediately.
   *  All three setters debounce on react-render rather than a timer,
   *  so the CSS-var apply effect runs once per commit. */
  setAppearance: (patch: Partial<AppearanceSlice>) => void;
  setTypography: (patch: Partial<TypographySlice>) => void;
  setLayout: (patch: Partial<LayoutSlice>) => void;
  /** Reset a specific page's slice back to defaults — wired to the
   *  shell's "Reset this page" header button. */
  resetAppearance: () => void;
  resetTypography: () => void;
  resetLayout: () => void;

  // ── store integrations ────────────────────────────────────────────────────
  handleSaveApiKeys: (keys: {
    steamApiKey?: string;
    itchApiKey?: string;
    steamUserId?: string;
    googlePlayJsonPath?: string;
  }) => Promise<void>;
  handlePickAvatar: () => Promise<void>;
  handleClearAvatar: () => Promise<void>;
}

// ── FX rates helper (silent refresh) ───────────────────────────────
//
// Tries Frankfurter first, falls back to exchangerate.host. Both
// providers ship USD-base rates as "1 USD = X CUR"; we invert to
// "USD per CUR" so the rest of the codebase can multiply by amount.
//
// Errors are swallowed — the user keeps their last saved rates when
// offline. dev-only console hint stays for debugging.
async function refreshFxRatesFromInternet(
  set: (s: Partial<AppStore>) => void,
  get: () => AppStore,
): Promise<void> {
  // Rust-side fetch — bypasses the renderer's CSP allowlist and tries
  // multiple providers (open.er-api.com / exchangerate.host / frankfurter).
  // Frankfurter alone leaves TRY stuck on the fallback because the ECB
  // dropped Turkish Lira from its reference feed in 2022.
  try {
    const next = await storage.fetchLiveExchangeRates();
    if (next && typeof next === "object" && Object.keys(next).length >= 10) {
      set({ exchangeRates: next });
      await storage.saveExchangeRates(next).catch(() => null);
      try {
        localStorage.setItem("studiohub_rates_fetched_at", new Date().toISOString());
      } catch { /* quota */ }
      return;
    }
    if (import.meta.env.DEV) console.warn("[fx] thin payload, keeping cache");
  } catch (err) {
    if (import.meta.env.DEV) console.warn("[fx] tauri fetch failed:", err);
  }
  void get;
}

export const useAppStore = create<AppStore>((set, get) => ({
  games: [],
  globalExpenses: [],
  releaseTemplate: defaultReleaseTemplate(),
  exchangeRates: { USD: 1, EUR: 1.05, TRY: 0.028 },
  steamApiKey: "",
  itchApiKey: "",
  steamUserId: "",
  avatarPath: "",
  googlePlayJsonPath: "",
  activeCurrencies: (() => {
    try {
      const saved = localStorage.getItem("studiohub_active_currencies");
      return saved ? (JSON.parse(saved) as string[]) : ["USD"];
    } catch {
      return ["USD"];
    }
  })(),

  // v0.9 M2 — appearance/typography/layout slices for live preview.
  // Loaded from localStorage on boot; the App-level effect mirrors
  // them to CSS custom properties on `documentElement` so every
  // visible knob applies without a remount.
  appearance: loadAppearance(),
  typography: loadTypography(),
  layout:     loadLayout(),
  profile:    loadProfile(),
  general:    loadGeneral(),
  notifications: loadNotifications(),
  startup:       loadStartup(),
  pomodoroPrefs: loadPomodoroPrefs(),
  studioIdentity: loadStudioIdentity(),
  backupPrefs:   loadBackupPrefs(),
  teamMode:      loadTeamMode(),
  webhooks:      loadWebhooks(),
  privacy:       loadPrivacy(),
  experimental:  loadExperimental(),

  language: "en",
  showLanguagePrompt: false,
  workspaceTab: "dashboard",
  selectedId: "",
  activeTaskId: "",
  isLoading: true,
  statusMessage: "Ready",
  toasts: [],
  ui: copy["en"],

  // ── setters ────────────────────────────────────────────────────────────────

  setLanguage: async (lang) => {
    set({ language: lang, ui: copy[lang] });
    // Mirror to localStorage so ErrorBoundary (which can't reach into
    // Zustand during componentDidCatch) can render its recovery copy in
    // the user's language. The disk-backed Tauri preference is still
    // the source of truth — this is a synchronous shadow.
    try { localStorage.setItem("heravex_lang", lang); } catch { /* quota */ }
    await storage.setPreferredLanguage(lang).catch(() => null);
  },

  setShowLanguagePrompt: (v) => set({ showLanguagePrompt: v }),

  setWorkspaceTab: (tab) => set({ workspaceTab: tab }),

  setSelectedId: (id) => set({ selectedId: id }),

  setActiveTaskId: (id) => set({ activeTaskId: id }),

  setActiveCurrencies: (currencies) => {
    set({ activeCurrencies: currencies });
    try {
      localStorage.setItem("studiohub_active_currencies", JSON.stringify(currencies));
    } catch {}
  },

  // ── appearance / typography / layout ──────────────────────────────────────
  setAppearance: (patch) => {
    const next = { ...get().appearance, ...patch };
    set({ appearance: next });
    saveAppearance(next);
  },
  setTypography: (patch) => {
    const next = { ...get().typography, ...patch };
    set({ typography: next });
    saveTypography(next);
  },
  setLayout: (patch) => {
    const next = { ...get().layout, ...patch };
    set({ layout: next });
    saveLayout(next);
  },
  resetAppearance: () => {
    set({ appearance: DEFAULT_APPEARANCE });
    saveAppearance(DEFAULT_APPEARANCE);
  },
  resetTypography: () => {
    set({ typography: DEFAULT_TYPOGRAPHY });
    saveTypography(DEFAULT_TYPOGRAPHY);
  },
  resetLayout: () => {
    set({ layout: DEFAULT_LAYOUT });
    saveLayout(DEFAULT_LAYOUT);
  },

  setProfile: (patch) => {
    const next = { ...get().profile, ...patch };
    set({ profile: next });
    saveProfile(next);
  },
  setGeneral: (patch) => {
    const next = { ...get().general, ...patch };
    set({ general: next });
    saveGeneral(next);
  },
  resetProfile: () => {
    set({ profile: DEFAULT_PROFILE });
    saveProfile(DEFAULT_PROFILE);
  },
  resetGeneral: () => {
    set({ general: DEFAULT_GENERAL });
    saveGeneral(DEFAULT_GENERAL);
  },

  setNotifications: (patch) => {
    const next = { ...get().notifications, ...patch };
    set({ notifications: next });
    saveNotifications(next);
  },
  setStartup: (patch) => {
    const next = { ...get().startup, ...patch };
    set({ startup: next });
    saveStartup(next);
  },
  setPomodoroPrefs: (patch) => {
    const next = { ...get().pomodoroPrefs, ...patch };
    set({ pomodoroPrefs: next });
    savePomodoroPrefs(next);
  },
  resetNotifications: () => {
    set({ notifications: DEFAULT_NOTIFICATIONS });
    saveNotifications(DEFAULT_NOTIFICATIONS);
  },
  resetStartup: () => {
    set({ startup: DEFAULT_STARTUP });
    saveStartup(DEFAULT_STARTUP);
  },
  resetPomodoroPrefs: () => {
    set({ pomodoroPrefs: DEFAULT_POMODORO_PREFS });
    savePomodoroPrefs(DEFAULT_POMODORO_PREFS);
  },

  setStudioIdentity: (patch) => {
    const next = { ...get().studioIdentity, ...patch };
    set({ studioIdentity: next });
    saveStudioIdentity(next);
  },
  setBackupPrefs: (patch) => {
    const next = { ...get().backupPrefs, ...patch };
    set({ backupPrefs: next });
    saveBackupPrefs(next);
  },
  resetStudioIdentity: () => {
    set({ studioIdentity: DEFAULT_STUDIO_IDENTITY });
    saveStudioIdentity(DEFAULT_STUDIO_IDENTITY);
  },
  resetBackupPrefs: () => {
    set({ backupPrefs: DEFAULT_BACKUP_PREFS });
    saveBackupPrefs(DEFAULT_BACKUP_PREFS);
  },

  setTeamMode: (patch) => {
    const next = { ...get().teamMode, ...patch };
    set({ teamMode: next });
    saveTeamMode(next);
  },
  setWebhooks: (patch) => {
    const next = { ...get().webhooks, ...patch };
    set({ webhooks: next });
    saveWebhooks(next);
  },
  resetTeamMode: () => {
    set({ teamMode: DEFAULT_TEAM_MODE });
    saveTeamMode(DEFAULT_TEAM_MODE);
  },
  resetWebhooks: () => {
    set({ webhooks: DEFAULT_WEBHOOKS });
    saveWebhooks(DEFAULT_WEBHOOKS);
  },

  setPrivacy: (patch) => {
    const next = { ...get().privacy, ...patch };
    set({ privacy: next });
    savePrivacy(next);
  },
  setExperimental: (patch) => {
    const next = { ...get().experimental, ...patch };
    set({ experimental: next });
    saveExperimental(next);
  },
  resetPrivacy: () => {
    set({ privacy: DEFAULT_PRIVACY });
    savePrivacy(DEFAULT_PRIVACY);
  },
  resetExperimental: () => {
    set({ experimental: DEFAULT_EXPERIMENTAL });
    saveExperimental(DEFAULT_EXPERIMENTAL);
  },

  // ── toasts ─────────────────────────────────────────────────────────────────

  showError: (err) => {
    const msg = translateError(err, get().language);
    get().showToast(msg, "error");
    return msg;
  },

  showToast: (message, type = "success", undoCallback, actionLabel) => {
    const id = ++toastCounter;
    set((s) => ({
      toasts: [...s.toasts, { id, message, type, exiting: false, undoCallback, actionLabel }],
      statusMessage: message,
    }));
    const duration = undoCallback ? 15000 : 3000;
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)) }));
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 220);
    }, duration);
  },

  // ── game actions ───────────────────────────────────────────────────────────

  init: async () => {
    const { showToast } = get();
    try {
      const settings = await storage.loadAppSettings().catch(() => null);
      const savedLang =
        settings?.preferredLanguage ?? (await storage.getPreferredLanguage().catch(() => null));

      if (savedLang && LANGUAGE_OPTIONS.includes(savedLang as AppLanguage)) {
        const lang = savedLang as AppLanguage;
        set({ language: lang, ui: copy[lang] });
        // Mirror to localStorage so ErrorBoundary can read it sync.
        try { localStorage.setItem("heravex_lang", lang); } catch { /* quota */ }
      } else {
        set({ showLanguagePrompt: true });
      }

      set({
        globalExpenses: settings?.globalExpenses ?? [],
        // Disk-rehab: a v0.8.4 bug stored Frankfurter's raw "1 USD = X CUR"
        // value as our "USD per CUR" rate, inflating non-USD totals by
        // ~30× for currencies like TRY. Detect & invert any non-USD
        // entry greater than 2 — no real-world fiat is worth more than
        // 2 USD per unit (gold/BTC aren't currencies in this list).
        exchangeRates: healInvertedRates(
          settings?.exchangeRates ?? { USD: 1, EUR: 1 / 1.05, TRY: 1 / 35 },
        ),
        releaseTemplate: settings?.releaseTemplate ?? defaultReleaseTemplate(),
        steamApiKey: settings?.steamApiKey ?? "",
        itchApiKey: settings?.itchApiKey ?? "",
        steamUserId: settings?.steamUserId ?? "",
        avatarPath: settings?.avatarPath ?? "",
        googlePlayJsonPath: settings?.googlePlayJsonPath ?? "",
      });

      await get().refreshGames();

      // ── Overdue summary notification (max once per calendar day) ────────────
      try {
        const today = new Date().toDateString();
        const notifiedKey = "studiohub_overdue_notified";
        if (localStorage.getItem(notifiedKey) !== today) {
          const { games: loadedGames, language: lang, ui: uiNow } = get();
          const todayDate = new Date();
          todayDate.setHours(0, 0, 0, 0);
          const overdueCount = loadedGames.reduce((sum, g) =>
            sum + g.tasks.filter((t) => {
              if (t.done || !t.dueDate) return false;
              const d = new Date(t.dueDate);
              d.setHours(0, 0, 0, 0);
              return d < todayDate;
            }).length, 0);
          if (overdueCount > 0) {
            localStorage.setItem(notifiedKey, today);
            const msg = lang === "tr"
              ? `${overdueCount} gecikmiş göreviniz var.`
              : String(uiNow.overdueNotification ?? `You have ${overdueCount} overdue task${overdueCount > 1 ? "s" : ""}.`);
            void notify("HeraVex ⚠️", msg);
          }
        }
      } catch { /* non-critical */ }

      // ── Live exchange rates ───────────────────────────────────
      //
      // Frankfurter returns "1 USD = X CUR" (USD-base). Our internal
      // model stores `rates[c]` as "USD per 1 unit of c" so the
      // multiplier in `calculateAccumulatedAmount(exp, rate)` produces
      // USD when applied to a foreign-currency amount.
      //
      // We MUST invert here. Older builds stored the raw API value,
      // which left every non-USD wallet total inflated by ~30× for
      // currencies like TRY. The disk-rehab block in `applyExchangeRatesFromDisk`
      // below catches that case for offline users on their first
      // upgrade run.
      // Auto-fetch happens silently every launch. We try two endpoints
      // so a single provider hiccup doesn't leave the user with stale
      // rates. No toast — the spec is "user shouldn't notice".
      void refreshFxRatesFromInternet(set, get).catch(() => null);
    } catch (err) {
      showToast(translateError(err, get().language), "error");
      set({ isLoading: false });
    }
  },

  refreshGames: async (preferredId, opts) => {
    const silent = opts?.silent === true;
    if (!silent) set({ isLoading: true });
    try {
      const lang = get().language;
      let next = await storage.loadGames();
      next = next.map((g) => ensureBoardColumns({ ...g, expenses: g.expenses ?? [] }, lang));
      const { selectedId, activeTaskId } = get();
      const fallback = preferredId ?? selectedId;
      const exists = fallback && next.some((g) => g.id === fallback);
      // Silent mode preserves the user's current selection so the
      // dashboard, library detail pane, and task center don't jump.
      // Loud mode resets activeTaskId because a full refresh usually
      // means the task list was reordered or replaced.
      set({
        games: next,
        selectedId: exists ? fallback : (silent ? selectedId : ""),
        activeTaskId: silent ? activeTaskId : "",
        ...(silent ? {} : { isLoading: false }),
      });
    } catch (err) {
      if (!silent) get().showToast(translateError(err, get().language), "error");
      if (!silent) set({ isLoading: false });
    }
  },

  applySavedGame: (savedGame) => {
    set((s) => {
      const idx = s.games.findIndex((g) => g.id === savedGame.id);
      if (idx === -1) return { games: [savedGame, ...s.games] };
      const next = [...s.games];
      next[idx] = savedGame;
      return { games: next };
    });
  },

  handleCreateGame: async ({ title, summary, status, platforms, tags, budget }) => {
    const { showToast, applySavedGame, ui, language } = get();
    try {
      const raw = await storage.createGame({ title, summary, status: status as import("../types").GameStatus, platforms, tags });
      // Brand-new games never come back with board columns — inject defaults.
      // Same goes for moodboard categories: seed the localised default
      // channels (Character / UI / Color / …) so first-time users land
      // in a populated tab strip rather than a single Uncategorized.
      const withBoard = ensureBoardColumns(raw, language);
      const created: GameRecord = {
        ...withBoard,
        moodboard: {
          categories: withBoard.moodboard.categories.length
            ? withBoard.moodboard.categories
            : defaultMoodboardCategoriesForLanguage(language),
          items: withBoard.moodboard.items,
        },
      };
      if (budget && budget > 0) {
        const withBudget = await storage.saveGame({ ...created, budget });
        applySavedGame(withBudget);
        set({ selectedId: withBudget.id, workspaceTab: "library" });
        showToast(ui.gameCreated);
        return withBudget;
      }
      const persisted = await storage.saveGame(created);
      applySavedGame(persisted);
      set({ selectedId: persisted.id, workspaceTab: "library" });
      showToast(ui.gameCreated);
      void notify("HeraVex", `${ui.gameCreated}: ${persisted.title}`);
      return persisted;
    } catch (err) {
      showToast(translateError(err, get().language), "error");
      return null;
    }
  },

  handleSaveGame: async (game, message) => {
    const { showToast, applySavedGame } = get();
    try {
      const saved = await storage.saveGame(game);
      applySavedGame(saved);
      if (message) showToast(message);
      return saved;
    } catch (err) {
      showToast(translateError(err, get().language), "error");
      return null;
    }
  },

  handleDeleteGame: async (gameId) => {
    const { showToast, ui, selectedId } = get();
    try {
      await storage.deleteGame(gameId);
      set((s) => ({
        games: s.games.filter((g) => g.id !== gameId),
        selectedId: selectedId === gameId ? "" : selectedId,
      }));
      showToast(ui.gameRemoved ?? "Game removed.");
    } catch (err) {
      showToast(translateError(err, get().language), "error");
    }
  },

  // ── task actions ───────────────────────────────────────────────────────────

  toggleTask: async (gameId, taskId) => {
    const { games, applySavedGame, ui } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    const task = game.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const becomingDone = !task.done;
    const tasks = game.tasks.map((t) => {
      if (t.id !== taskId) return t;
      // Toggling done flushes the running timer; toggling back resumes from now.
      // `completedAt` is set on the done→on transition and cleared on the
      // reverse so the dashboard's weekly stat only counts genuine new
      // completions; restoring a task and re-finishing it later rolls
      // the timestamp forward.
      const next: TaskItem = { ...t, done: !t.done };
      if (becomingDone) {
        return { ...next, ...timerPause(t), completedAt: new Date().toISOString() };
      }
      // becoming open again — start fresh window if not already running
      return { ...next, ...timerStart(next), completedAt: null };
    });
    const saved = await storage.saveGame({ ...game, tasks });
    applySavedGame(saved);
    if (becomingDone) {
      void notify("HeraVex", `✅ ${task.title} ${ui.taskCompleted ?? "tamamlandı!"}`);
    }
  },

  deleteTask: async (gameId, taskId) => {
    const { games, applySavedGame, showToast, ui } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    const snapshot = { ...game };
    const tasks = game.tasks.filter((t) => t.id !== taskId);
    // Cascade: strip the task id from every moodboard item that
    // pointed back to it. Same single save handles both arrays so
    // the undo path can restore the pre-cascade snapshot atomically.
    const moodboardItems = game.moodboard.items.map((m) => {
      if (!m.linkedTaskIds.includes(taskId)) return m;
      return { ...m, linkedTaskIds: mutateLinkArray(m.linkedTaskIds, taskId, false) };
    });
    const moodboard = { ...game.moodboard, items: moodboardItems };
    const saved = await storage.saveGame({ ...game, tasks, moodboard });
    applySavedGame(saved);
    showToast(ui.taskRemoved, "success", async () => {
      // Undo restores the snapshot — both task list and the original
      // linkedTaskIds come back in one shot.
      const restored = await storage.saveGame(snapshot);
      get().applySavedGame(restored);
    });
  },

  updateTaskInGame: async (gameId, taskId, patch) => {
    const { games, applySavedGame } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    const tasks = game.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
    const saved = await storage.saveGame({ ...game, tasks });
    applySavedGame(saved);
  },

  // ── version actions ────────────────────────────────────────────────────────

  handleAddVersion: async (gameId, version, notes) => {
    const { showToast, applySavedGame, ui } = get();
    try {
      const updated = await storage.addVersionWithBuild(gameId, version, notes);
      applySavedGame(updated);
      showToast(ui.versionAdded);
      void notify("HeraVex", `${ui.versionAdded}: v${version}`);
      return updated;
    } catch (err) {
      const msg = String(err);
      const friendly = msg.includes("Build secimi iptal edildi")
        ? ui.buildSelectionCancelled
        : translateError(err, get().language);
      showToast(friendly, "error");
      return null;
    }
  },

  handleDeleteVersion: async (gameId, versionId) => {
    const { games, showToast, applySavedGame, ui } = get();
    const snapshot = games.find((g) => g.id === gameId);
    try {
      const updated = await storage.deleteVersion(gameId, versionId);
      applySavedGame(updated);
      showToast(ui.versionRemoved, "success", snapshot ? async () => {
        const restored = await storage.saveGame(snapshot);
        get().applySavedGame(restored);
      } : undefined);
    } catch (err) {
      showToast(translateError(err, get().language), "error");
    }
  },

  // ── moodboard ─────────────────────────────────────────────────────────────
  //
  // Link invariant: the five mutually-referencing arrays
  //   MoodboardItem.linkedTaskIds
  //   MoodboardItem.linkedNoteIds
  //   TaskItem.moodboardImageIds
  //   NoteRecord.moodboardImageIds
  //   (and the categories list when an item's categoryId references a
  //    deleted category — handled by `deleteMoodboardCategory`)
  // are ONLY mutated by the link/unlink/delete actions below. Calling
  // `setMoodboardItemRaw` or hand-editing `game.tasks[i].moodboardImageIds`
  // anywhere else is a bug — the cascade cleanup would silently miss
  // those edges.

  addMoodboardItems: async (gameId, items) => {
    const { games, handleSaveGame, ui } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    const moodboard = {
      ...game.moodboard,
      items: [...items, ...game.moodboard.items],
    };
    await handleSaveGame({ ...game, moodboard }, ui.moodboardSaved);
  },

  updateMoodboardItem: async (gameId, itemId, patch) => {
    const { games, handleSaveGame } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    // Reject patches that would touch the link arrays — those must go
    // through the dedicated link helpers so the other side stays in
    // sync. This is a development guard; in production it's a no-op
    // because the UI never tries this path.
    if ("linkedTaskIds" in patch || "linkedNoteIds" in patch) {
      devWarn("[updateMoodboardItem] linked*Ids must be mutated via link helpers; ignored");
      delete (patch as Partial<MoodboardItem>).linkedTaskIds;
      delete (patch as Partial<MoodboardItem>).linkedNoteIds;
    }
    const moodboard = {
      ...game.moodboard,
      items: game.moodboard.items.map((m) => (m.id === itemId ? { ...m, ...patch } : m)),
    };
    await handleSaveGame({ ...game, moodboard });
  },

  deleteMoodboardItem: async (gameId, itemId) => {
    const { games, handleSaveGame, ui } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    const item = game.moodboard.items.find((m) => m.id === itemId);
    if (!item) return;

    // ── Cascade 1: strip the item id from every task in this game that
    // ── referenced it. We use `linkedTaskIds` as the source of truth
    // ── for which tasks to touch (avoids scanning every task), but we
    // ── ALSO defensively strip from any task that has the id even if
    // ── the back-reference was missing (belt + suspenders against a
    // ── prior bug).
    const taskIdsToClean = new Set(item.linkedTaskIds);
    const tasks = game.tasks.map((t) => {
      const has = t.moodboardImageIds?.includes(itemId);
      if (!taskIdsToClean.has(t.id) && !has) return t;
      return { ...t, moodboardImageIds: mutateLinkArray(t.moodboardImageIds, itemId, false) };
    });

    // ── Cascade 2: same logic for notes. Notes live in separate JSON
    // ── files, so we load each affected note, patch, save.
    for (const noteId of item.linkedNoteIds) {
      try {
        const note = await loadNoteById(noteId);
        if (!note) continue;
        const patched: NoteRecord = {
          ...note,
          moodboardImageIds: mutateLinkArray(note.moodboardImageIds, itemId, false),
        };
        await storage.saveNote(patched);
      } catch (err) {
        devWarn(`[deleteMoodboardItem] note cleanup failed for ${noteId}:`, err);
        // Don't abort — the moodboard side still needs to be cleaned.
      }
    }
    notifyNotesUpdated();

    const moodboard = {
      ...game.moodboard,
      items: game.moodboard.items.filter((m) => m.id !== itemId),
    };
    await handleSaveGame({ ...game, tasks, moodboard }, ui.moodboardRemoved);
  },

  moveMoodboardItem: async (gameId, itemId, toCategoryId) => {
    const { games, handleSaveGame } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    // Validate target id (must exist or be null for Uncategorized).
    const validTarget =
      toCategoryId === null ||
      game.moodboard.categories.some((c) => c.id === toCategoryId);
    if (!validTarget) return;
    const moodboard = {
      ...game.moodboard,
      items: game.moodboard.items.map((m) =>
        m.id === itemId ? { ...m, categoryId: toCategoryId } : m,
      ),
    };
    await handleSaveGame({ ...game, moodboard });
  },

  // ── moodboard: categories ──────────────────────────────────────────────────

  addMoodboardCategory: async (gameId, name) => {
    const { games, handleSaveGame } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    const maxOrder = game.moodboard.categories.reduce(
      (acc, c) => Math.max(acc, c.order),
      -1,
    );
    const created: MoodboardCategory = {
      id: `cat_${crypto.randomUUID()}`,
      name: trimmed,
      order: maxOrder + 1,
    };
    const moodboard = {
      ...game.moodboard,
      categories: [...game.moodboard.categories, created],
    };
    await handleSaveGame({ ...game, moodboard });
    return created;
  },

  renameMoodboardCategory: async (gameId, categoryId, name) => {
    const { games, handleSaveGame } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const moodboard = {
      ...game.moodboard,
      categories: game.moodboard.categories.map((c) =>
        c.id === categoryId ? { ...c, name: trimmed } : c,
      ),
    };
    await handleSaveGame({ ...game, moodboard });
  },

  deleteMoodboardCategory: async (gameId, categoryId) => {
    const { games, handleSaveGame } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    // Items in the deleted category fall back to Uncategorized
    // (`categoryId = null`). We do NOT delete the items themselves —
    // visual references are precious and accidental category removal
    // shouldn't blow them away.
    const moodboard = {
      categories: game.moodboard.categories.filter((c) => c.id !== categoryId),
      items: game.moodboard.items.map((m) =>
        m.categoryId === categoryId ? { ...m, categoryId: null } : m,
      ),
    };
    await handleSaveGame({ ...game, moodboard });
  },

  reorderMoodboardCategories: async (gameId, orderedIds) => {
    const { games, handleSaveGame } = get();
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    const byId = new Map(game.moodboard.categories.map((c) => [c.id, c]));
    const reordered: MoodboardCategory[] = [];
    orderedIds.forEach((id, idx) => {
      const c = byId.get(id);
      if (c) {
        reordered.push({ ...c, order: idx });
        byId.delete(id);
      }
    });
    // Append any categories not mentioned in `orderedIds` (defensive
    // against partial inputs from racing drag-drops).
    let nextOrder = reordered.length;
    byId.forEach((c) => reordered.push({ ...c, order: nextOrder++ }));
    const moodboard = { ...game.moodboard, categories: reordered };
    await handleSaveGame({ ...game, moodboard });
  },

  // ── moodboard: link helpers (the only writers of the link arrays) ──────────

  linkMoodboardItemToTask: async (gameId, itemId, taskId) => {
    await applyMoodboardTaskLink(get, gameId, itemId, taskId, true);
  },
  unlinkMoodboardItemFromTask: async (gameId, itemId, taskId) => {
    await applyMoodboardTaskLink(get, gameId, itemId, taskId, false);
  },
  linkMoodboardItemToNote: async (gameId, itemId, noteId) => {
    await applyMoodboardNoteLink(get, gameId, itemId, noteId, true);
  },
  unlinkMoodboardItemFromNote: async (gameId, itemId, noteId) => {
    await applyMoodboardNoteLink(get, gameId, itemId, noteId, false);
  },

  removeNote: async (noteId) => {
    const { games, handleSaveGame } = get();
    // Strip noteId from every moodboard item across every game that
    // linked to it. Save only games that actually changed.
    for (const game of games) {
      let touched = false;
      const items = game.moodboard.items.map((m) => {
        if (!m.linkedNoteIds.includes(noteId)) return m;
        touched = true;
        return { ...m, linkedNoteIds: mutateLinkArray(m.linkedNoteIds, noteId, false) };
      });
      if (touched) {
        await handleSaveGame({ ...game, moodboard: { ...game.moodboard, items } });
      }
    }
    await storage.deleteNote(noteId);
    notifyNotesUpdated();
  },

  reorderNotes: async (orderedIds) => {
    // Load fresh notes so we don't overwrite content edits that
    // happened in NoteCenter between renders. Then rewrite each one
    // with its new `order` slot. Notes are atomic per-file, so even
    // if a save in the middle fails the prefix landed correctly and
    // the user can retry — no half-state on the relation side.
    if (orderedIds.length === 0) return;
    const fresh = await storage.getAllNotes().catch(() => null);
    if (!fresh) return;
    const byId = new Map(fresh.map((n) => [n.id, n]));
    for (let idx = 0; idx < orderedIds.length; idx++) {
      const note = byId.get(orderedIds[idx]);
      if (!note) continue;
      // Skip the write when the order already matches — saves disk
      // churn on a drag that didn't actually move anything.
      if ((note.order ?? 0) === idx) continue;
      try {
        await storage.saveNote({ ...note, order: idx });
      } catch (err) {
        devWarn(`[reorderNotes] save failed for ${note.id}:`, err);
      }
    }
    notifyNotesUpdated();
  },

  // ── release template ──────────────────────────────────────────────────────

  handleSaveReleaseTemplate: async (template) => {
    const { showToast, ui } = get();
    try {
      const saved = await storage.saveReleaseTemplate(template);
      set({ releaseTemplate: saved });
      showToast(ui.releaseTemplateSaved);
    } catch (err) {
      showToast(translateError(err, get().language), "error");
    }
  },

  // ── expenses ───────────────────────────────────────────────────────────────

  updateGlobalExpense: async (expenseId, patch) => {
    const { globalExpenses } = get();
    const next = globalExpenses.map((e) =>
      e.id === expenseId ? { ...e, ...patch } : e,
    );
    await storage.saveGlobalExpenses(next);
    set({ globalExpenses: next });
  },

  handleAddExpense: async (expense, gameId) => {
    const { games, applySavedGame, globalExpenses, showToast, ui } = get();
    try {
      if (gameId) {
        const game = games.find((g) => g.id === gameId);
        if (!game) return;
        const saved = await storage.saveGame({ ...game, expenses: [expense, ...game.expenses] });
        applySavedGame(saved);
      } else {
        const next = [expense, ...globalExpenses];
        await storage.saveGlobalExpenses(next);
        set({ globalExpenses: next });
      }
      showToast(ui.expenseAdded);
    } catch (err) {
      showToast(translateError(err, get().language), "error");
    }
  },

  handleDeleteExpense: async (expenseId, gameId) => {
    const { games, applySavedGame, globalExpenses, showToast, ui } = get();
    try {
      if (gameId) {
        const game = games.find((g) => g.id === gameId);
        if (!game) return;
        const saved = await storage.saveGame({
          ...game,
          expenses: game.expenses.filter((e) => e.id !== expenseId),
        });
        applySavedGame(saved);
        showToast(ui.wExpenseDeleted, "success");
      } else {
        const next = globalExpenses.filter((e) => e.id !== expenseId);
        await storage.saveGlobalExpenses(next);
        set({ globalExpenses: next });
        showToast(ui.wGeneralExpenseDeleted, "success");
      }
    } catch (err) {
      showToast(translateError(err, get().language), "error");
    }
  },

  // ── settings / backup ─────────────────────────────────────────────────────

  handleSaveExchangeRates: async (rates) => {
    set({ exchangeRates: rates });
    await storage.saveExchangeRates(rates).catch(() => null);
  },

  handleExportBackup: async () => {
    const { showToast, ui, privacy, language } = get();
    const busyId = `backup-${Date.now()}`;
    const busyLabel = language === "tr" ? "Yedek alınıyor…" : "Saving backup…";
    window.dispatchEvent(new CustomEvent("heravex:busy", { detail: { id: busyId, label: busyLabel } }));
    try {
      // Default behaviour is now silent → <AppData>/heravex/Saves/.
      // The Rust side runs on a blocking thread so this await doesn't
      // freeze the UI even on multi-MB workspaces.
      const { invoke } = await import("../lib/invokeWrapper");
      const path = await invoke<string>("export_backup_silent", { prefix: "manual" });
      // v0.9 M7 — redaction gate. When the user toggles "Redact API
      // keys on export" we read the freshly written JSON back, strip
      // the secret fields, and rewrite it before the toast fires.
      // Only JSON files are redactable (ZIP archives need Rust-side
      // work; we leave those alone). The path returned by Rust is
      // already a write-confirmed full path on disk.
      if (privacy.redactKeysOnExport && path.toLowerCase().endsWith(".json")) {
        try {
          const raw = await storage.readTextFile(path);
          const obj = JSON.parse(raw) as Record<string, unknown>;
          // Redact at every known location. The shape is stable so a
          // simple key-by-key blank-out is safer than recursing.
          const REDACT_KEYS = ["steamApiKey", "itchApiKey", "steamUserId", "googlePlayJsonPath"];
          for (const k of REDACT_KEYS) {
            if (k in obj) (obj as Record<string, string>)[k] = "***REDACTED***";
          }
          if (obj.settings && typeof obj.settings === "object") {
            const s = obj.settings as Record<string, unknown>;
            for (const k of REDACT_KEYS) {
              if (k in s) (s as Record<string, string>)[k] = "***REDACTED***";
            }
          }
          await storage.writeTextFile(path, JSON.stringify(obj, null, 2));
        } catch (err) {
          // Silently skip redaction on parse/IO failure — the export
          // itself was successful and that's the higher-priority signal.
          devWarn("[redactKeysOnExport] skipped:", err);
        }
      }
      showToast(ui.backupExported(path));
      // Notification kept lightweight — full path can be very long on
      // Windows AppData; let the toast carry the detail and keep the
      // OS notification short.
      void notify("HeraVex", language === "tr" ? "Yedek alındı." : "Backup saved.");
    } catch (err) {
      showToast(translateError(err, get().language), "error");
    } finally {
      window.dispatchEvent(new CustomEvent("heravex:busy", { detail: { id: busyId, done: true } }));
    }
  },

  handleSaveApiKeys: async ({
    steamApiKey,
    itchApiKey,
    steamUserId,
    googlePlayJsonPath,
  }) => {
    const { showToast } = get();
    try {
      const s = get();
      const nextSteam = steamApiKey ?? s.steamApiKey;
      const nextItch = itchApiKey ?? s.itchApiKey;
      const nextUser = steamUserId ?? s.steamUserId;
      const nextPlay = googlePlayJsonPath ?? s.googlePlayJsonPath;
      await storage.saveApiKeys({
        steamApiKey: nextSteam || null,
        itchApiKey: nextItch || null,
        steamUserId: nextUser || null,
        googlePlayJsonPath: nextPlay || null,
      });
      set({
        steamApiKey: nextSteam,
        itchApiKey: nextItch,
        steamUserId: nextUser,
        googlePlayJsonPath: nextPlay,
      });
      showToast(get().language === "tr" ? "API anahtarları kaydedildi." : "API keys saved.", "success");
    } catch (err) {
      showToast(translateError(err, get().language), "error");
    }
  },

  handlePickAvatar: async () => {
    const { showToast } = get();
    try {
      const path = await storage.pickAndSaveAvatar();
      set({ avatarPath: path });
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showToast(translateError(err, get().language), "error");
    }
  },

  handleClearAvatar: async () => {
    const { showToast } = get();
    try {
      await storage.clearAvatar();
      set({ avatarPath: "" });
    } catch (err) {
      showToast(translateError(err, get().language), "error");
    }
  },

  handleImportBackup: async (path?: string) => {
    const { showToast, ui, refreshGames, language } = get();
    const busyId = `restore-${Date.now()}`;
    const busyLabel = language === "tr" ? "Yedek geri yükleniyor…" : "Restoring backup…";
    window.dispatchEvent(new CustomEvent("heravex:busy", { detail: { id: busyId, label: busyLabel } }));
    try {
      const resolved = await storage.importBackup(path);
      set({ selectedId: "", activeTaskId: "" });
      await refreshGames();
      const settings = await storage.loadAppSettings().catch(() => null);
      const savedLang =
        settings?.preferredLanguage ?? (await storage.getPreferredLanguage().catch(() => null));
      if (savedLang && LANGUAGE_OPTIONS.includes(savedLang as AppLanguage)) {
        const lang = savedLang as AppLanguage;
        set({ language: lang, ui: copy[lang] });
      }
      set({
        globalExpenses: settings?.globalExpenses ?? [],
        releaseTemplate: settings?.releaseTemplate ?? defaultReleaseTemplate(),
      });
      showToast(ui.backupImported(resolved));
    } catch (err) {
      showToast(translateError(err, get().language), "error");
    } finally {
      window.dispatchEvent(new CustomEvent("heravex:busy", { detail: { id: busyId, done: true } }));
    }
  },
}));

// ── derived selectors (call in components) ─────────────────────────────────

export function selectSelectedGame(games: GameRecord[], selectedId: string) {
  return games.find((g) => g.id === selectedId) ?? null;
}

export function selectAllTasks(games: GameRecord[]) {
  return games
    .flatMap((g) => {
      const general = (g.tags ?? []).includes("__general_tasks__");
      return g.tasks.map((t) => ({
        ...t,
        gameId: g.id,
        gameTitle: g.title,
        coverDataUrl: g.coverDataUrl,
        isGeneral: general,
      }));
    })
    .sort((a, b) => {
      const o = compareTasks(a, b);
      return o !== 0 ? o : a.gameTitle.localeCompare(b.gameTitle, "tr");
    });
}
