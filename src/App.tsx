import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "./store";
import { useKeyboardShortcuts } from "./lib/keyboard";
import { loadShortcuts, buildShortcutMap } from "./lib/shortcutConfig";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { GameList } from "./components/library/GameList";
import { GameDetail } from "./components/library/GameDetail";
import { TaskCenter } from "./components/TaskCenter";
import { Wallet } from "./components/Wallet";
import { CreateGameModal } from "./components/modals/CreateGameModal";
import { LanguageModal } from "./components/modals/LanguageModal";
import { NewWorkspaceModal } from "./components/modals/NewWorkspaceModal";
import { Onboarding } from "./components/Onboarding";
import { Calendar } from "./components/pages/Calendar";
import { Analytics } from "./components/pages/Analytics";
import { Profile } from "./components/pages/Profile";
import { StoreHub } from "./components/pages/StoreHub";
import { NoteCenter } from "./components/pages/NoteCenter";
import { TutorialOverlay, shouldShowTutorial } from "./components/Tutorial/TutorialOverlay";

export default function App() {
  const { init, refreshGames, isLoading, games, workspaceTab, selectedId, toasts, language, ui, showToast } = useAppStore();

  const [showCreateGame, setShowCreateGame] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
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
  useKeyboardShortcuts(
    buildShortcutMap(shortcutDefs, {
      openCommandPalette: () => setShowPalette((o) => !o),
      newGame:            () => setShowCreateGame(true),
      openTasks:          () => setWorkspaceTab("tasks"),
      openNotes:          () => setWorkspaceTab("notes"),
    })
  );

  useEffect(() => {
    void init();
  }, [init]);

  // Tutorial trigger is now data-driven: auto-open on app start ONLY when the
  // workspace is empty (no games yet). The user can dismiss it for this session
  // by skipping; reloading with data present keeps it dismissed.
  useEffect(() => {
    if (isLoading) return;
    const hasAnyData = games.length > 0;
    if (shouldShowTutorial(hasAnyData)) {
      const t = window.setTimeout(() => setShowTutorial(true), 500);
      return () => window.clearTimeout(t);
    }
  }, [isLoading, games.length]);
  useEffect(() => {
    const onStart = () => setShowTutorial(true);
    window.addEventListener("heravex:start-tutorial", onStart);
    return () => window.removeEventListener("heravex:start-tutorial", onStart);
  }, []);

  // ── Workspace sync listener — surfaces remote changes as a non-intrusive toast.
  // Never auto-overwrites local edits; the user opts in via the "Refresh" action.
  // Belt-and-suspenders: the Rust watcher already refuses to start without a
  // configured workspace path, but we double-check here in case a stale event
  // arrives during a Team Mode transition.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void (async () => {
      unlisten = await listen("workspace-updated", async () => {
        try {
          const wp = await import("./lib/storage").then((m) => m.getWorkspacePath());
          if (!wp) return; // Team Mode off — ignore.
        } catch { /* if path lookup fails just allow the toast */ }
        if (remoteNotifiedRef.current) return; // dedupe consecutive bursts
        remoteNotifiedRef.current = true;
        showToast(
          language === "tr"
            ? "Uzakta değişiklikler var."
            : "Remote changes detected.",
          "info",
          () => {
            void refreshGames();
            remoteNotifiedRef.current = false;
          },
          language === "tr" ? "Yenile" : "Refresh"
        );
        // Re-arm after 8s so subsequent change bursts can re-notify
        setTimeout(() => { remoteNotifiedRef.current = false; }, 8000);
      });
    })();
    return () => { if (unlisten) unlisten(); };
  }, [language, refreshGames, showToast]);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <h2>{ui.loadingTitle}</h2>
        <p>{ui.loadingBody}</p>
      </div>
    );
  }

  const showOnboarding = games.length === 0 && workspaceTab === "dashboard";

  return (
    <ErrorBoundary>
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
            <>
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
            </>
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
            onClose={() => setShowPalette(false)}
            onNewProject={() => setShowCreateGame(true)}
          />
        )}

        {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}
      </div>
    </ErrorBoundary>
  );
}
