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

const GameDetail = lazy(() => importGameDetail().then((m) => ({ default: m.GameDetail })));
const TaskCenter = lazy(() => importTaskCenter().then((m) => ({ default: m.TaskCenter })));
const Wallet     = lazy(() => importWallet().then((m) => ({ default: m.Wallet })));
const Calendar   = lazy(() => importCalendar().then((m) => ({ default: m.Calendar })));
const Analytics  = lazy(() => importAnalytics().then((m) => ({ default: m.Analytics })));
const Profile    = lazy(() => importProfile().then((m) => ({ default: m.Profile })));
const StoreHub   = lazy(() => importStoreHub().then((m) => ({ default: m.StoreHub })));
const NoteCenter = lazy(() => importNoteCenter().then((m) => ({ default: m.NoteCenter })));

/** Warm the chunk cache during browser idle time so the first nav to a
 *  lazy page paints instantly. Order matches "most likely next page"
 *  heuristics — GameDetail + Analytics are the user's reported pain
 *  points so they go first. Errors swallowed: a failed prefetch just
 *  means the user pays the cost at navigation time instead. */
function prefetchPages() {
  const order = [
    importGameDetail, importAnalytics,
    importTaskCenter, importNoteCenter,
    importWallet,     importStoreHub,
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
import { togglePomodoro as togglePomodoroFn, refreshDurationsForCurrentPhase } from "./lib/pomodoro";
import { INITIAL_PAGE_OPTIONS } from "./lib/preferences";
import { useAutoBackupScheduler } from "./lib/autoBackup";
import { applyPrivacyClasses } from "./lib/privacyExperimental";
import { AutoLockOverlay } from "./components/AutoLockOverlay";
import { PerformanceMonitor } from "./components/PerformanceMonitor";
import { QuickCaptureWidget } from "./components/QuickCaptureWidget";
import { BusyIndicator } from "./components/BusyIndicator";

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
  const remoteNotifiedRef = useRef(false);

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
        window.dispatchEvent(new CustomEvent("heravex:new-task"));
      },
      newNote: () => {
        setWorkspaceTab("notes");
        window.dispatchEvent(new CustomEvent("heravex:new-note"));
      },
      // Actions
      togglePomodoro: () => {
        // M4 wires this to the global state machine. Widget reflects
        // the change immediately via its subscription hook.
        togglePomodoroFn();
      },
      quickBackup:        () => void handleExportBackup(),
      switchGame:         () => setWorkspaceTab("library"),
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
  useAutoBackupScheduler(backupPrefs, useAppStore.getState().handleExportBackup);

  // Silent on-launch auto-backup → AppData/heravex/backups/auto-*.json.
  // Runs once per app session, ~3s after the workspace finishes loading
  // so the heavy IPC traffic from init has settled. Throttled to one
  // backup per 6h to avoid spamming the folder for users who restart
  // the app a lot during development. The schedule the user picked in
  // Backup settings still drives the longer-term cadence on top of this.
  const launchBackupRef = useRef(false);
  useEffect(() => {
    if (isLoading || launchBackupRef.current) return;
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
        await invoke<string>("export_backup_silent");
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

  // ── Workspace sync — handles remote changes from shared folders.
  //
  // Two complementary signals feed the same toast:
  //   1. The Rust `workspace-updated` event (fires when the OS filesystem
  //      notifier picks up a change — works on local disks).
  //   2. A frontend polling loop that calls `compute_workspace_signature`
  //      on the interval the user picked in Team Mode → Watcher delay.
  //      This is the cloud-sync fallback: Drive/OneDrive/Dropbox often
  //      land files via placeholders that don't trigger notify events,
  //      so a periodic fingerprint check is the only reliable path.
  //
  // Never auto-overwrites local edits — the user opts in via "Refresh".
  // Modules that own their own data (NoteCenter, TaskCenter, Calendar)
  // listen for the `heravex:remote-changed` window event so they can
  // re-fetch their slices when the user accepts.
  const teamModePrefs = useAppStore((s) => s.teamMode);
  const watcherDelayMs = (() => {
    switch (teamModePrefs.watcherDelay) {
      case "instant": return 3000;
      case "5s":      return 5000;
      case "30s":     return 30000;
      case "2m":      return 120000;
      default:        return 5000;
    }
  })();

  // Conflict dialog state — only used when conflictStrategy === "manualMerge".
  const [conflict, setConflict] = useState<{ local: string; remote: string } | null>(null);

  const surfaceRemoteToast = useRef<(prev: string, next: string) => void>(() => {});
  useEffect(() => {
    surfaceRemoteToast.current = (prev: string, next: string) => {
      if (remoteNotifiedRef.current) return;
      remoteNotifiedRef.current = true;

      const broadcastRefresh = () => {
        void refreshGames();
        window.dispatchEvent(new CustomEvent("heravex:remote-changed"));
        window.dispatchEvent(new CustomEvent("heravex:notes-updated"));
      };

      switch (teamModePrefs.conflictStrategy) {
        case "manualMerge": {
          // Open the side-by-side dialog. Toast is suppressed because
          // the dialog itself is the surface; the dedupe ref will be
          // released by the dialog's resolve/close handlers.
          setConflict({ local: prev, remote: next });
          break;
        }
        case "autoMerge": {
          // No prompt — just silently reload from disk and tell the
          // user via a short success toast that we synced.
          broadcastRefresh();
          showToast(
            language === "tr" ? "Uzaktaki değişiklikler alındı." : "Remote changes synced.",
            "success",
          );
          remoteNotifiedRef.current = false;
          break;
        }
        case "lastWriterWins":
        default: {
          // Original behaviour — toast + manual refresh button.
          showToast(
            language === "tr"
              ? "Uzakta değişiklikler var."
              : "Remote changes detected.",
            "info",
            () => {
              broadcastRefresh();
              remoteNotifiedRef.current = false;
            },
            language === "tr" ? "Yenile" : "Refresh",
          );
        }
      }
      // Re-arm after 8s so subsequent change bursts can re-notify.
      setTimeout(() => { remoteNotifiedRef.current = false; }, 8000);
    };
  }, [language, refreshGames, showToast, teamModePrefs.conflictStrategy]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void (async () => {
      unlisten = await listen("workspace-updated", async () => {
        try {
          const wp = await import("./lib/storage").then((m) => m.getWorkspacePath());
          if (!wp) return; // Team Mode off — ignore.
        } catch { /* if path lookup fails just allow the toast */ }
        // Watcher event doesn't carry the signature — pass blanks so
        // the conflict dialog still has something to render.
        const prev = localStorage.getItem("heravex_last_sync_sig") ?? "";
        surfaceRemoteToast.current(prev, prev);
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Polling loop — frontend fingerprint check. Cheap (one Tauri call)
  // and the only way to catch cloud-synced writes from another machine.
  useEffect(() => {
    let cancelled = false;
    let lastSig: string | null = null;
    // Track consecutive poll failures. Production builds previously
    // dropped these on the floor (dev-only console.warn), so a silently
    // broken Team Mode would never reach the user. After N back-to-back
    // failures we surface a single sticky toast and back off until the
    // next success resets the counter.
    let failStreak = 0;
    let notifiedDown = false;
    const FAIL_THRESHOLD = 3;
    const tick = async () => {
      try {
        const wp = await import("./lib/storage").then((m) => m.getWorkspacePath());
        if (!wp) return; // Team Mode off — no point polling.
        const { invoke } = await import("./lib/invokeWrapper");
        const sig = await invoke<string>("compute_workspace_signature");
        // Surface the timestamp so the Team Mode settings page can show
        // "last checked X ago" — purely a UX read-out.
        try {
          localStorage.setItem("heravex_last_sync_check", String(Date.now()));
          localStorage.setItem("heravex_last_sync_sig",   sig);
        } catch { /* quota */ }
        if (failStreak > 0) {
          failStreak = 0;
          notifiedDown = false;
        }
        if (lastSig === null) { lastSig = sig; return; }
        if (sig !== lastSig) {
          const prev = lastSig;
          lastSig = sig;
          surfaceRemoteToast.current(prev, sig);
        }
      } catch (err) {
        if (cancelled) return;
        failStreak++;
        const isDev = import.meta.env.DEV;
        if (isDev) console.warn("[team-mode] poll failed:", err);
        if (failStreak >= FAIL_THRESHOLD && !notifiedDown) {
          notifiedDown = true;
          // One toast per outage. Cleared the next successful tick.
          const { showToast: toast, language: lang } = useAppStore.getState();
          toast(
            lang === "tr"
              ? "Ekip modu eşitleme şu an yapılamıyor."
              : "Team mode sync is currently failing.",
            "warning",
          );
        }
      }
    };
    void tick(); // prime immediately
    const id = window.setInterval(() => { if (!cancelled) void tick(); }, watcherDelayMs);
    // Manual force-check from the Team Mode settings page.
    const onForce = () => { void tick(); };
    window.addEventListener("heravex:force-sync-check", onForce);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("heravex:force-sync-check", onForce);
    };
  }, [watcherDelayMs]);

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
            onClose={() => {
              setConflict(null);
              remoteNotifiedRef.current = false;
            }}
            onResolve={(choice) => {
              if (choice === "takeRemote") {
                window.dispatchEvent(new CustomEvent("heravex:remote-changed"));
                window.dispatchEvent(new CustomEvent("heravex:notes-updated"));
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
              remoteNotifiedRef.current = false;
            }}
          />
        )}

        {/* v0.9 M4 — Pomodoro widget. Self-gates on the user's
         *  `visibility` preference; renders null when set to
         *  "whenTaskOpen" (reserved for a future per-task chip)
         *  or "sidebarWidget" before the first activation. */}
        <PomodoroWidget />
        <PerformanceMonitor />
        <AutoLockOverlay />
        <QuickCaptureWidget />
        <BusyIndicator />
      </div>
      </MotionConfig>
    </ErrorBoundary>
  );
}
