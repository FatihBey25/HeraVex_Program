import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "./store";
import { useKeyboardShortcuts } from "./lib/keyboard";
import { loadShortcuts, buildShortcutMap } from "./lib/shortcutConfig";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { GameList } from "./components/library/GameList";
import { CreateGameModal } from "./components/modals/CreateGameModal";
import { LanguageModal } from "./components/modals/LanguageModal";
import { NewWorkspaceModal } from "./components/modals/NewWorkspaceModal";
import { ConflictDialog } from "./components/modals/ConflictDialog";
import { Onboarding } from "./components/Onboarding";
import { TutorialOverlay, shouldShowTutorial } from "./components/Tutorial/TutorialOverlay";

// Route-level code-splitting — these pages each pull heavy deps
// (recharts in Analytics/Wallet, react-markdown in NoteCenter,
// framer-motion in TaskCenter). Lazy-loading drops the first-paint
// bundle by ~600 KB and the user only pays for the page they open.
//
// The import factories are hoisted to module scope so the
// `prefetchPages` idle-time warmup below can invoke them directly,
// reusing the same Promise React.lazy caches internally. This means
// switching pages after warmup is instant rather than blocking on a
// network round-trip.
const importGameDetail = () => import("./components/library/GameDetail");
const importTaskCenter = () => import("./components/TaskCenter");
const importWallet     = () => import("./components/Wallet");
const importCalendar   = () => import("./components/pages/Calendar");
const importAnalytics  = () => import("./components/pages/Analytics");
const importProfile    = () => import("./components/pages/Profile");
const importStoreHub   = () => import("./components/pages/StoreHub");
const importNoteCenter = () => import("./components/pages/NoteCenter");
const importFlowCenter = () => import("./components/pages/FlowCenter");

const GameDetail = lazy(() => importGameDetail().then((m) => ({ default: m.GameDetail })));
const TaskCenter = lazy(() => importTaskCenter().then((m) => ({ default: m.TaskCenter })));
const Wallet     = lazy(() => importWallet().then((m) => ({ default: m.Wallet })));
const Calendar   = lazy(() => importCalendar().then((m) => ({ default: m.Calendar })));
const Analytics  = lazy(() => importAnalytics().then((m) => ({ default: m.Analytics })));
const Profile    = lazy(() => importProfile().then((m) => ({ default: m.Profile })));
const StoreHub   = lazy(() => importStoreHub().then((m) => ({ default: m.StoreHub })));
const NoteCenter = lazy(() => importNoteCenter().then((m) => ({ default: m.NoteCenter })));
const FlowCenter = lazy(() => importFlowCenter().then((m) => ({ default: m.FlowCenter })));

/** Warm the chunk cache during browser idle time so the first nav to a
 *  lazy page paints instantly. Order matches "most likely next page"
 *  heuristics — GameDetail + Analytics are the user's reported pain
 *  points so they go first. Errors swallowed: a failed prefetch just
 *  means the user pays the cost at navigation time instead. */
function prefetchPages() {
  const order = [
    importGameDetail, importAnalytics,
    importTaskCenter, importNoteCenter,
    importFlowCenter, importWallet,     importStoreHub,
    importCalendar,   importProfile,
  ];
  const win = window as unknown as { requestIdleCallback?: (cb: () => void) => void };
  const schedule = win.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
  const next = (i = 0) => {
    if (i >= order.length) return;
    schedule(() => {
      order[i]().catch(() => {}).finally(() => next(i + 1));
    });
  };
  next();
}
import { applyAppearanceToDom } from "./lib/appearance";
import { PomodoroWidget } from "./components/PomodoroWidget";
import { BreakLockOverlay } from "./components/BreakLockOverlay";
import { togglePomodoro as togglePomodoroFn, refreshDurationsForCurrentPhase } from "./lib/pomodoro";
import { notify } from "./lib/notify";
import { requestCreate } from "./lib/createIntents";
import { INITIAL_PAGE_OPTIONS } from "./lib/preferences";
import { useAutoBackupScheduler } from "./lib/autoBackup";
import { useStoreAutoSync } from "./lib/storeSync";
import { initialWindowTab, isSecondaryWindow } from "./lib/windowRole";
import { applyPrivacyClasses } from "./lib/privacyExperimental";
import { AutoLockOverlay } from "./components/AutoLockOverlay";
import { PerformanceMonitor } from "./components/PerformanceMonitor";
import { QuickCaptureWidget } from "./components/QuickCaptureWidget";
import { BusyIndicator } from "./components/BusyIndicator";
import { PluginPageHost } from "./components/PluginPageHost";
import { initPlugins } from "./lib/plugins";

// Throttle for the "synced from team" toast (module scope — App is a singleton).
let lastRemoteToastAt = 0;

export default function App() {
  const { init, refreshGames, isLoading, games, workspaceTab, selectedId, toasts, language, ui, showToast } = useAppStore();
  // v0.9 M2 — live preview. Watch the three appearance slices and
  // mirror them to CSS custom properties on `documentElement` on
  // every change. Equality is shallow per-slice; Zustand only fires
  // when one of these references actually swaps (setters always
  // produce a fresh object), so React commits remain cheap.
  const appearance = useAppStore((s) => s.appearance);
  const typography = useAppStore((s) => s.typography);
  const layoutSlice = useAppStore((s) => s.layout);
  useEffect(() => {
    applyAppearanceToDom(appearance, typography, layoutSlice);
  }, [appearance, typography, layoutSlice]);

  const [showCreateGame, setShowCreateGame] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);
  const [showPalette, setShowPalette] = useState<false | "actions" | "search">(false);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  const { setWorkspaceTab } = useAppStore.getState();

  // Shortcut configuration is user-editable (Settings). Reload on update events.
  const [shortcutDefs, setShortcutDefs] = useState(() => loadShortcuts());
  useEffect(() => {
    const onUpdate = () => setShortcutDefs(loadShortcuts());
    window.addEventListener("heravex:shortcuts-updated", onUpdate);
    return () => window.removeEventListener("heravex:shortcuts-updated", onUpdate);
  }, []);
  // v0.9 M3 — 16 shortcut handlers wired through. Navigation actions
  // jump between workspace tabs; create actions either spawn a modal
  // (newGame) or land on the relevant page and fire a global event
  // (newTask / newNote) so the destination page can pick it up and
  // open its own creator. Pomodoro toggle and quick-backup hit
  // dedicated events / store actions.
  const { handleExportBackup } = useAppStore.getState();
  useKeyboardShortcuts(
    buildShortcutMap(shortcutDefs, {
      // Navigation
      // Cmd+K → search across notes / tasks / games.
      // Cmd+Shift+P → action picker (the classic palette).
      // Either opens the same UI; user can switch with Tab or `>` prefix.
      openCommandPalette: () => setShowPalette((o) => (o ? false : "actions")),
      quickSearch:        () => setShowPalette((o) => (o ? false : "search")),
      openDashboard:      () => setWorkspaceTab("dashboard"),
      openLibrary:        () => setWorkspaceTab("library"),
      openStoreHub:       () => setWorkspaceTab("storehub"),
      openTasks:          () => setWorkspaceTab("tasks"),
      openNotes:          () => setWorkspaceTab("notes"),
      openWallet:         () => setWorkspaceTab("wallet"),
      openAnalytics:      () => setWorkspaceTab("analytics"),
      openSettings:       () => setWorkspaceTab("profile"),
      // Create
      newGame:            () => setShowCreateGame(true),
      newTask: () => {
        setWorkspaceTab("tasks");
        requestCreate("task");
      },
      newNote: () => {
        setWorkspaceTab("notes");
        requestCreate("note");
      },
      // Actions
      togglePomodoro: () => {
        // M4 wires this to the global state machine. Widget reflects
        // the change immediately via its subscription hook.
        togglePomodoroFn();
      },
      quickBackup:        () => void handleExportBackup(),
      switchGame:         () => setWorkspaceTab("library"),
      newWindow: () => {
        if (!useAppStore.getState().startup.multiWindow) return;
        void import("./lib/invokeWrapper").then(({ invoke }) =>
          invoke("open_app_window", { tab: null }).catch((err) => useAppStore.getState().showError(err)),
        );
      },
    })
  );

  useEffect(() => {
    // `init` is a Zustand action created once at store init time, so
    // its reference is stable across every render — the dep array
    // effectively behaves like [] and this runs exactly once on mount.
    // The dep is kept (rather than []) so exhaustive-deps stays happy.
    void init();
  }, [init]);

  // Viewport hysteresis (v0.9.7).
  //
  // Toggle two root classes that drive the CSS responsiveness pass:
  //   • `viewport-narrow`       (< 1200px) — sidebar collapses to icon-only
  //   • `viewport-very-narrow`  (<  900px) — dashboard grid drops to 1 col
  //
  // Hysteresis bands avoid oscillation when the user is dragging a
  // window resize handle: the class only re-enables once the viewport
  // crosses the expansion threshold (1400 / 1080), not the contraction
  // threshold. The thresholds were tuned against a 13" laptop (1366),
  // a 15" laptop (1920), and a 27" desktop (2560).
  useEffect(() => {
    const COLLAPSE_NARROW = 1200, EXPAND_NARROW = 1400;
    const COLLAPSE_VNARROW =  900, EXPAND_VNARROW = 1080;
    const root = document.documentElement;
    const apply = () => {
      const w = window.innerWidth;
      const isNarrow  = root.classList.contains("viewport-narrow");
      const isVNarrow = root.classList.contains("viewport-very-narrow");
      if (!isNarrow  && w < COLLAPSE_NARROW)  root.classList.add("viewport-narrow");
      if ( isNarrow  && w > EXPAND_NARROW)    root.classList.remove("viewport-narrow");
      if (!isVNarrow && w < COLLAPSE_VNARROW) root.classList.add("viewport-very-narrow");
      if ( isVNarrow && w > EXPAND_VNARROW)   root.classList.remove("viewport-very-narrow");
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  // Auto-self-register membership for team workspaces (v0.9.7).
  //
  // After init resolves we check whether the active workspace is a
  // team folder (registry mode OR cloud-path heuristic). If so, we
  // write our identity into `heravex-members.json` — joining the
  // team if it's our first time, or bumping lastSeenAt otherwise.
  // The leader gating in teamMembers.ts handles the "first user
  // becomes leader" rule. Failures are swallowed: the user can still
  // use the workspace, they just won't appear in the panel until the
  // next launch.
  const studioIdentity = useAppStore((s) => s.studioIdentity);
  const profileSlice = useAppStore((s) => s.profile);
  const userAvatarPath = useAppStore((s) => s.avatarPath);
  const joinedTeamRef = useRef(false);
  useEffect(() => {
    if (isLoading || joinedTeamRef.current) return;
    void (async () => {
      try {
        const { getWorkspacePath } = await import("./lib/storage");
        const wp = await getWorkspacePath();
        if (!wp) return; // no workspace = no team membership to register
        const { detectCloudProvider, loadWorkspaces } = await import("./lib/workspaces");
        const ws = loadWorkspaces().find((w) => w.path === wp);
        const isTeam = ws?.mode === "team" || !!detectCloudProvider(wp);
        if (!isTeam) return;
        const { joinTeamWorkspace } = await import("./lib/teamMembers");
        const displayName = profileSlice.displayName?.trim()
          || studioIdentity.studioName?.trim()
          || (language === "tr" ? "İsimsiz" : "Anonymous");
        await joinTeamWorkspace(wp, {
          displayName,
          avatarPath: userAvatarPath || null,
        });
        joinedTeamRef.current = true;
        // Tell any open Members panel to refresh.
        window.dispatchEvent(new CustomEvent("heravex:team-members-changed"));
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[team-members] self-register failed:", err);
      }
    })();
  }, [isLoading, studioIdentity.studioName, profileSlice.displayName, userAvatarPath, language]);

  // Warm the lazy-page bundle cache once the initial paint is settled.
  // The user reported GameDetail + Analytics taking ~1s on first open
  // (the cold network fetch); this runs the imports during idle time so
  // the chunks land in the browser cache before the click happens.
  useEffect(() => {
    if (isLoading) return;
    prefetchPages();
  }, [isLoading]);

  // v0.9 M4 — apply the "initial page" preference once init resolves.
  // We run this *once* after `isLoading` flips false so we don't fight
  // the user if they navigate during the boot sequence.
  const startupPrefs = useAppStore((s) => s.startup);
  const initialPageApplied = useRef(false);
  useEffect(() => {
    if (isLoading || initialPageApplied.current) return;
    initialPageApplied.current = true;
    if (startupPrefs.initialPage === "lastOpen") return; // honour whatever the store boots with
    const target = INITIAL_PAGE_OPTIONS.find((o) => o.id === startupPrefs.initialPage);
    if (target?.workspaceTab) setWorkspaceTab(target.workspaceTab);
  }, [isLoading, startupPrefs.initialPage, setWorkspaceTab]);

  // Refresh Pomodoro's idle remaining-time whenever its duration prefs
  // change. Active sessions are intentionally left alone — a mid-focus
  // jump from 25→45 mins would be jarring.
  const pomodoroPrefs = useAppStore((s) => s.pomodoroPrefs);
  useEffect(() => {
    refreshDurationsForCurrentPhase();
  }, [pomodoroPrefs]);

  // v0.9 M5 — auto-backup scheduler. Runs every minute; ticks the
  // schedule against the user's preference and the last-backup
  // timestamp in localStorage. `handleExportBackup` already does
  // the heavy lift.
  const backupPrefs = useAppStore((s) => s.backupPrefs);
  // Once per app: extra windows (Settings → Startup → multi-window) skip it.
  useAutoBackupScheduler(
    isSecondaryWindow ? { ...backupPrefs, schedule: "off" } : backupPrefs,
    () => useAppStore.getState().handleExportBackup({ auto: true }),
  );

  // Settings → API keys → "Sync interval": refresh store numbers in the
  // background while the app is open.
  const gamesForSync = useAppStore((s) => s.games);
  useStoreAutoSync(gamesForSync, !isLoading && !isSecondaryWindow);

  // ── Multiple windows ───────────────────────────────────────────────
  const multiWindow = useAppStore((s) => s.startup.multiWindow === true);
  useEffect(() => {
    void import("./lib/invokeWrapper").then(({ invoke }) =>
      invoke("set_multi_window", { enabled: multiWindow }).catch(() => { /* not in Tauri */ }),
    );
  }, [multiWindow]);
  // A new window can open on a given page (`?tab=notes`).
  useEffect(() => {
    if (isLoading || !initialWindowTab) return;
    setWorkspaceTab(initialWindowTab as Parameters<typeof setWorkspaceTab>[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);
  // Another window saved something: re-read just that. Our own save
  // echoing back is a no-op (same updatedAt / same content).
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    void (async () => {
      const off = await listen<{ kind: string; ids: string[] }>("local-data-changed", (ev) => {
        const { kind, ids } = ev.payload;
        const st = useAppStore.getState();
        if (kind === "games") {
          if (ids.length) void st.syncGamesFromDisk(ids);
          else void st.refreshGames(undefined, { silent: true });
        } else if (kind === "notes") {
          window.dispatchEvent(new CustomEvent("heravex:notes-file-changed", {
            detail: ids.length ? { noteIds: ids, removedNoteIds: [] } : undefined,
          }));
        } else if (kind === "flows") {
          window.dispatchEvent(new CustomEvent("heravex:flow-file-changed"));
        } else if (kind === "wallet") {
          void st.loadWallet({ silent: true });
        }
      });
      if (disposed) off(); else unlisten = off;
    })();
    return () => { disposed = true; if (unlisten) unlisten(); };
  }, []);
  // Preferences live in localStorage; another window changing one fires
  // a `storage` event here.
  useEffect(() => {
    let t: number | undefined;
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith("heravex_")) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => useAppStore.getState().reloadPreferences(), 150);
    };
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("storage", onStorage); window.clearTimeout(t); };
  }, []);

  // Silent on-launch auto-backup → AppData/heravex/backups/auto-*.json.
  // Runs once per app session, ~3s after the workspace finishes loading
  // so the heavy IPC traffic from init has settled. Throttled to one
  // backup per 6h to avoid spamming the folder for users who restart
  // the app a lot during development. The schedule the user picked in
  // Backup settings still drives the longer-term cadence on top of this.
  const launchBackupRef = useRef(false);
  useEffect(() => {
    if (isLoading || launchBackupRef.current || isSecondaryWindow) return;
    if (backupPrefs.schedule === "off") return;
    launchBackupRef.current = true;
    const last = Number(localStorage.getItem("heravex_last_launch_backup_at") || 0);
    const sixHours = 6 * 60 * 60 * 1000;
    if (Date.now() - last < sixHours) return;
    const t = window.setTimeout(async () => {
      const busyId = `launch-backup-${Date.now()}`;
      const label = language === "tr" ? "Oto yedek alınıyor…" : "Auto-backing up…";
      window.dispatchEvent(new CustomEvent("heravex:busy", { detail: { id: busyId, label } }));
      try {
        const { invoke } = await import("./lib/invokeWrapper");
        const { backupHousekeeping } = await import("./lib/studioIdentity");
        await invoke<string>("export_backup_silent", {
          housekeeping: backupHousekeeping(useAppStore.getState().backupPrefs),
        });
        localStorage.setItem("heravex_last_launch_backup_at", String(Date.now()));
        showToast(language === "tr" ? "Otomatik yedek alındı." : "Auto-backup saved.", "success");
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[auto-backup] silent failed:", err);
      } finally {
        window.dispatchEvent(new CustomEvent("heravex:busy", { detail: { id: busyId, done: true } }));
      }
    }, 3000);
    return () => window.clearTimeout(t);
  }, [isLoading, backupPrefs.schedule]);

  // v0.9 M7 — privacy preferences flow to <html> as class hooks so
  // CSS can react (screenshot-mode blur, mask-values default).
  const privacy = useAppStore((s) => s.privacy);
  useEffect(() => {
    applyPrivacyClasses(privacy);
  }, [privacy]);

  // Tutorial trigger is now data-driven: auto-open on app start ONLY when the
  // workspace is empty AND the user hasn't disabled the gate in Settings.
  // The session-skip dismissal still works through shouldShowTutorial().
  useEffect(() => {
    if (isLoading) return;
    if (!startupPrefs.showTutorial) return;
    const hasAnyData = games.length > 0;
    if (shouldShowTutorial(hasAnyData)) {
      const t = window.setTimeout(() => setShowTutorial(true), 500);
      return () => window.clearTimeout(t);
    }
  }, [isLoading, games.length, startupPrefs.showTutorial]);
  useEffect(() => {
    const onStart = () => setShowTutorial(true);
    window.addEventListener("heravex:start-tutorial", onStart);
    return () => window.removeEventListener("heravex:start-tutorial", onStart);
  }, []);

  // Discover + activate installed plugins once at startup. Later
  // installs/toggles re-run initPlugins() from the Settings page.
  useEffect(() => { void initPlugins(); }, []);
  // A plugin that fails to load used to fail silently (only visible in
  // Settings → Plugins). Tell the user once per plugin per session.
  useEffect(() => {
    const told = new Set<string>();
    const onFail = (e: Event) => {
      const { id, name, error } = (e as CustomEvent<{ id: string; name: string; error: string }>).detail;
      if (told.has(id)) return;
      told.add(id);
      const lang = useAppStore.getState().language;
      useAppStore.getState().showToast(
        lang === "tr"
          ? `"${name}" eklentisi yüklenemedi (${error}). Ayarlar → Eklentiler'den kapatabilir veya kaldırabilirsin.`
          : `The "${name}" plugin failed to load (${error}). You can disable or remove it in Settings → Plugins.`,
        "warning",
      );
    };
    window.addEventListener("heravex:plugin-failed", onFail);
    return () => window.removeEventListener("heravex:plugin-failed", onFail);
  }, []);

  // Suppress the WebView's native right-click menu (Back / Reload / Save
  // as…) app-wide — it clashes with our custom context menus (e.g. Flow
  // Center). Editable fields keep their native menu for copy/paste.
  // v0.9.9: the same interception point now doubles as the PLUGIN
  // context-menu layer — when a plugin registered items matching the
  // right-click target, a themed menu opens instead of a bare suppress.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
      // Flow Center (and other in-app menus) preventDefault at the React
      // layer, which runs before this document listener — don't stack a
      // plugin menu on top of theirs.
      const alreadyHandled = e.defaultPrevented;
      e.preventDefault();
      if (!alreadyHandled) {
        void import("./lib/plugins").then((m) => m.openPluginContextMenu(e));
      }
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  // ── Workspace sync — v0.9.7 rewrite ──────────────────────────────
  //
  // The previous loop polled a single global signature hash and
  // surfaced a blocking "remote changes detected" toast/dialog for
  // any file change anywhere in the folder — which interrupted
  // editing and required a full `refreshGames` reload. The new
  // `teamSync` module polls a per-file manifest, diffs successive
  // snapshots, and dispatches *targeted* events:
  //   • heravex:notes-file-changed   — handled by NoteCenter
  //   • heravex:members-file-changed — handled by Sidebar / panel
  //   • heravex:games-list-changed   — handled by the store
  // Each handler re-fetches just its own slice — no full reload, no
  // modal mid-edit.
  //
  // The store hooks below ALSO kicks off the team-sync orchestrator
  // and a 30s members-heartbeat so other clients can see this user
  // come online.
  const profileSlice2 = useAppStore((s) => s.profile);
  const studioIdentity2 = useAppStore((s) => s.studioIdentity);
  const userAvatarPath2 = useAppStore((s) => s.avatarPath);
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    void (async () => {
      const { startTeamSync, stopTeamSync } = await import("./lib/teamSync");
      if (cancelled) return;
      startTeamSync({
        onSyncDown: () => {
          const { showToast: toast, language: lang } = useAppStore.getState();
          toast(
            lang === "tr"
              ? "Ekip modu eşitleme şu an yapılamıyor."
              : "Team mode sync is currently failing.",
            "warning",
          );
        },
        onSyncBackUp: () => {
          // Don't toast — silent recovery is better UX than a chirp.
        },
        getIdentity: () => {
          const displayName = profileSlice2.displayName?.trim()
            || studioIdentity2.studioName?.trim()
            || (language === "tr" ? "İsimsiz" : "Anonymous");
          return { displayName, avatarPath: userAvatarPath2 || null };
        },
        onRemoteChange: () => {
          // Teammate edited games/notes/flows → the targeted refresh
          // events already fired; surface a gentle toast too (throttled
          // so a burst of synced files doesn't spam).
          const now = Date.now();
          if (now - lastRemoteToastAt < 6000) return;
          lastRemoteToastAt = now;
          const { showToast: toast, language: lang } = useAppStore.getState();
          toast(lang === "tr" ? "Ekipten değişiklikler eşitlendi." : "Synced changes from your team.", "info");
        },
      });
      // The Settings page "Check now" button still fires this event.
      const onForce = () => {
        void import("./lib/teamSync").then((m) => m.forceSyncCheck());
      };
      window.addEventListener("heravex:force-sync-check", onForce);
      return () => {
        window.removeEventListener("heravex:force-sync-check", onForce);
        stopTeamSync();
      };
    })();
    return () => { cancelled = true; };
  }, [isLoading, profileSlice2.displayName, studioIdentity2.studioName, userAvatarPath2, language]);

  // Old Rust workspace-updated event — kept as a free signal for the
  // local-disk case (`notify` watcher fires when files change on the
  // host filesystem). When it fires we just kick the team-sync poller
  // to run sooner — no separate UI handler.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void (async () => {
      unlisten = await listen("workspace-updated", async () => {
        const { forceSyncCheck } = await import("./lib/teamSync");
        await forceSyncCheck();
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // ── System tray (bottom-right) ─────────────────────────────────────
  // Rust owns the tray icon and hide-on-close. The UI keeps it in sync
  // with the user's preference + language and runs the quick actions
  // picked from the tray menu.
  const closeToTray = useAppStore((s) => s.general.closeToTray !== false);
  useEffect(() => {
    void import("./lib/invokeWrapper").then(({ invoke }) =>
      invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => { /* not in Tauri */ }),
    );
  }, [closeToTray]);
  const minimiseToTray = useAppStore((s) => s.startup.minimiseToTray === true);
  useEffect(() => {
    void import("./lib/invokeWrapper").then(({ invoke }) =>
      invoke("set_minimise_to_tray", { enabled: minimiseToTray }).catch(() => { /* not in Tauri */ }),
    );
  }, [minimiseToTray]);
  useEffect(() => {
    void import("./lib/invokeWrapper").then(({ invoke }) =>
      invoke("set_tray_language", { language }).catch(() => { /* not in Tauri */ }),
    );
  }, [language]);
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;
    void (async () => {
      // Tray / backup events are for the main window only.
      if (isSecondaryWindow) return;
      const onAction = await listen<string>("tray-action", (ev) => {
        const { setWorkspaceTab: goTo } = useAppStore.getState();
        switch (ev.payload) {
          case "new-task":
            goTo("tasks");
            requestCreate("task");
            break;
          case "new-note":
            goTo("notes");
            requestCreate("note");
            break;
          case "pomodoro":
            togglePomodoroFn();
            break;
        }
      });
      // First hide-to-tray only: tell the user the app is still running,
      // otherwise "I closed it" + "it's still syncing" looks like a bug.
      const onHidden = await listen("hidden-to-tray", () => {
        const KEY = "heravex_tray_hint_shown";
        try {
          if (localStorage.getItem(KEY)) return;
          localStorage.setItem(KEY, "1");
        } catch { /* storage blocked: show it anyway */ }
        const lang = useAppStore.getState().language;
        void notify(
          "HeraVex",
          lang === "tr"
            ? "Arka planda çalışmaya devam ediyor. Açmak için sağ alttaki simgeye tıkla, kapatmak için sağ tıklayıp Çıkış'ı seç."
            : "Still running in the background. Click the tray icon to open it, or right-click and choose Quit to exit.",
        );
      });
      // Settings → Backup "Mirror to cloud folder" failed (folder gone,
      // drive offline). The backup itself is safe in Saves/.
      const onMirrorFailed = await listen<string>("backup-mirror-failed", (ev) => {
        const lang = useAppStore.getState().language;
        useAppStore.getState().showToast(
          (lang === "tr"
            ? "Yedek alındı ama yedek klasörüne kopyalanamadı: "
            : "Backup saved, but it couldn't be copied to the mirror folder: ") + ev.payload,
          "warning",
        );
      });
      if (disposed) { onAction(); onHidden(); onMirrorFailed(); return; }
      unlisteners.push(onAction, onHidden, onMirrorFailed);
    })();
    return () => { disposed = true; unlisteners.forEach((u) => u()); };
  }, []);

  // A webhook (Discord / custom) could not be delivered. Throttled so a
  // dead endpoint doesn't toast on every completed task.
  useEffect(() => {
    let lastAt = 0;
    const onFail = (e: Event) => {
      const { target, message } = (e as CustomEvent<{ target: string; message: string }>).detail;
      if (Date.now() - lastAt < 60_000) return;
      lastAt = Date.now();
      const lang = useAppStore.getState().language;
      useAppStore.getState().showToast(
        (lang === "tr" ? `Webhook gönderilemedi (${target}): ` : `Webhook not delivered (${target}): `) + message,
        "warning",
      );
    };
    window.addEventListener("heravex:webhook-failed", onFail);
    return () => window.removeEventListener("heravex:webhook-failed", onFail);
  }, []);

  // Rust reports record files it could not read in time (a cloud-drive
  // client stuck on a download). The UI shows what did load; this tells
  // the user why something is missing and what to do. Throttled.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let lastAt = 0;
    void (async () => {
      unlisten = await listen<string[]>("workspace-read-stalled", (ev) => {
        const now = Date.now();
        if (now - lastAt < 30_000) return;
        lastAt = now;
        const files = (ev.payload ?? []).slice(0, 3).join(", ");
        const { showToast: toast, language: lang } = useAppStore.getState();
        toast(
          lang === "tr"
            ? `Bazı dosyalar okunamadı (${files}). Bulut eşitleme istemcisini (Google Drive / OneDrive) yeniden başlat. Bu dosyalar silinmez.`
            : `Some files couldn't be read (${files}). Restart your sync client (Google Drive / OneDrive). These files are not deleted.`,
          "warning",
        );
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Silent refresh handlers — the team-sync orchestrator fires these
  // when a teammate's save touches the relevant file. We re-fetch
  // the affected slice WITHOUT bouncing the loading screen so the
  // user keeps editing without interruption.
  useEffect(() => {
    const onGamesChanged = (e: Event) => {
      // Targeted: re-read only the changed game files and skip our own
      // saves echoing back. A full reload on every autosave echo was
      // re-rendering the whole app while the user typed.
      const ids = (e as CustomEvent<{ gameIds?: string[] }>).detail?.gameIds;
      const store = useAppStore.getState();
      if (ids && ids.length > 0) void store.syncGamesFromDisk(ids);
      else void store.refreshGames(undefined, { silent: true });
    };
    window.addEventListener("heravex:games-list-changed", onGamesChanged);
    return () => window.removeEventListener("heravex:games-list-changed", onGamesChanged);
  }, []);

  // Wallet (general expenses, currency list) is per workspace since
  // v0.9.9; reload it when the file changes (teammate or our own echo —
  // reloading our own save is harmless).
  useEffect(() => {
    const onWalletChanged = () => { void useAppStore.getState().loadWallet({ silent: true }); };
    window.addEventListener("heravex:wallet-file-changed", onWalletChanged);
    return () => window.removeEventListener("heravex:wallet-file-changed", onWalletChanged);
  }, []);

  // Conflict dialog kept but only opened when something else calls it
  // (manualMerge strategy). Default is autoMerge — silent reload.
  const [conflict, setConflict] = useState<{ local: string; remote: string } | null>(null);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-orb" aria-hidden="true" />
        <h2>{ui.loadingTitle}</h2>
        <p>{ui.loadingBody}</p>
      </div>
    );
  }

  const showOnboarding = games.length === 0 && workspaceTab === "dashboard";

  // Translate the user's animation speed into a default transition
  // duration for framer-motion. "instant" gets 0 so motion components
  // jump rather than animate; the CSS kill-switch handles the rest.
  const motionDuration = (() => {
    switch (layoutSlice.animationSpeed) {
      case "instant":  return 0;
      case "fast":     return 0.10;
      case "slow":     return 0.30;
      case "standard":
      default:         return 0.18;
    }
  })();

  return (
    <ErrorBoundary>
      <MotionConfig
        transition={{ duration: motionDuration }}
        reducedMotion={layoutSlice.animationSpeed === "instant" ? "always" : "never"}
      >
      <div className="shell">
        <Sidebar
          onOpenLanguage={() => setShowLanguage(true)}
          onOpenSettings={() => setWorkspaceTab("profile")}
          onNewWorkspace={() => setShowNewWorkspace(true)}
        />

        <main className="workspace">
          {showOnboarding ? (
            <Onboarding onCreateFirstGame={() => setShowCreateGame(true)} />
          ) : (
            <Suspense fallback={<div className="loading-screen"><h2>{ui.loadingTitle}</h2></div>}>
              {workspaceTab === "dashboard" && <Dashboard onCreateGame={() => setShowCreateGame(true)} />}
              {workspaceTab === "library" && (
                <div className="library-layout">
                  <GameList onCreateGame={() => setShowCreateGame(true)} />
                  {selectedId && <GameDetail />}
                </div>
              )}
              {workspaceTab === "storehub" && <StoreHub />}
              {workspaceTab === "tasks" && <TaskCenter />}
              {workspaceTab === "notes" && <NoteCenter />}
              {workspaceTab === "flow" && <FlowCenter />}
              {workspaceTab.startsWith("plugin:") && <PluginPageHost tabKey={workspaceTab} />}
              {workspaceTab === "calendar" && <Calendar />}
              {workspaceTab === "wallet" && <Wallet />}
              {workspaceTab === "analytics" && <Analytics />}
              {workspaceTab === "profile" && (
                <Profile onOpenLanguage={() => setShowLanguage(true)} />
              )}
            </Suspense>
          )}
        </main>

        {/* ── Toast layer ── */}
        {toasts.length > 0 && (
          <div className="toast-container">
            {toasts.map((t) => (
              <div key={t.id} className={`toast toast-${t.type} ${t.exiting ? "toast-exit" : ""}`}>
                <span>{t.message}</span>
                {t.undoCallback && (
                  <button
                    className="toast-undo-btn"
                    onClick={() => { t.undoCallback!(); }}
                  >
                    {t.actionLabel ?? (language === "tr" ? "Geri Al" : "Undo")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Modals ── */}
        {showCreateGame && <CreateGameModal onClose={() => setShowCreateGame(false)} />}
        {showLanguage && <LanguageModal onClose={() => setShowLanguage(false)} />}
        {showNewWorkspace && (
          <NewWorkspaceModal onClose={() => setShowNewWorkspace(false)} />
        )}
        {showPalette && (
          <CommandPalette
            initialMode={showPalette}
            onClose={() => setShowPalette(false)}
            onNewProject={() => setShowCreateGame(true)}
          />
        )}

        {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}

        {conflict && (
          <ConflictDialog
            localSig={conflict.local}
            remoteSig={conflict.remote}
            onClose={() => setConflict(null)}
            onResolve={(choice) => {
              if (choice === "takeRemote") {
                // Tell granular surfaces to silently re-fetch; the new
                // team-sync orchestrator dispatches per-file events
                // automatically on the next manifest tick, this just
                // wakes them sooner.
                window.dispatchEvent(new CustomEvent("heravex:notes-file-changed"));
                window.dispatchEvent(new CustomEvent("heravex:members-file-changed"));
                showToast(
                  language === "tr" ? "Uzaktaki sürüm uygulandı." : "Remote version applied.",
                  "success",
                );
              } else {
                showToast(
                  language === "tr"
                    ? "Yerel sürüm korundu. Sonraki kayıtta uzaktakini ezecek."
                    : "Local version kept. Next save will overwrite remote.",
                  "info",
                );
              }
              setConflict(null);
            }}
          />
        )}

        {/* v0.9 M4 — Pomodoro widget. Self-gates on the user's
         *  `visibility` preference; renders null when set to
         *  "whenTaskOpen" (reserved for a future per-task chip)
         *  or "sidebarWidget" before the first activation. */}
        <PomodoroWidget />
        <BreakLockOverlay />
        <PerformanceMonitor />
        <AutoLockOverlay />
        <QuickCaptureWidget />
        <BusyIndicator />
      </div>
      </MotionConfig>
    </ErrorBoundary>
  );
}
