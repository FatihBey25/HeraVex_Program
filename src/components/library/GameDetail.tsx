import { type MouseEvent, useEffect, useState } from "react";
import type { FocusDetailTabDetail } from "../../lib/moodboardNavigate";
import { useAppStore } from "../../store";
import { tabLabel, type DetailTab, statusLabel } from "../../lib/i18n";
import { imgSrc } from "../../lib/images";
import { DashboardMetric } from "../shared/DashboardMetric";
import { OverviewTab } from "./tabs/OverviewTab";
import { NotesTab } from "./tabs/NotesTab";
import { TasksTab } from "./tabs/TasksTab";
import { VersionsTab } from "./tabs/VersionsTab";
import { ReleaseTab } from "./tabs/ReleaseTab";
import { MoodboardTab } from "./tabs/MoodboardTab";
import { IntegrationsTab } from "./tabs/IntegrationsTab";
import { StoreSyncTab } from "./tabs/StoreSyncTab";
import { ConfirmDialog } from "../shared/ConfirmDialog";

const DETAIL_TABS: { key: DetailTab }[] = [
  { key: "overview" },
  { key: "tasks" },
  { key: "notes" },
  { key: "versions" },
  { key: "moodboard" },
  { key: "release" },
  { key: "integrations" },
  { key: "storesync" },
];

export function GameDetail() {
  const { games, selectedId, setSelectedId, language, ui, handleDeleteGame } = useAppStore();
  const game = games.find((g) => g.id === selectedId) ?? null;
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Cross-tab navigation: a moodboard thumbnail on a task/note card
  // can request that we switch to a specific detail tab. We listen
  // for the dispatched custom event and filter by gameId so other
  // games' detail panels (if mounted) stay put.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<FocusDetailTabDetail>).detail;
      if (!detail || !game) return;
      if (detail.gameId !== game.id) return;
      setDetailTab(detail.tab);
    };
    window.addEventListener("heravex:focus-detail-tab", handler);
    return () => window.removeEventListener("heravex:focus-detail-tab", handler);
  }, [game?.id]);

  if (!game) return null;

  const handleBackdropMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    setSelectedId("");
    setDetailTab("overview");
  };

  const onDeleteConfirm = async () => {
    setConfirmDelete(false);
    await handleDeleteGame(game.id);
    setSelectedId("");
    setDetailTab("overview");
  };

  return (
    <>
      <div className="detail-modal-backdrop" onMouseDown={handleBackdropMouseDown}>
        <div
          key={selectedId}
          className="detail-modal detail-slide-in"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <section className="panel detail-panel detail-panel-modal">
            <div className="detail-panel-topbar">
              <div>
                <p className="eyebrow">{ui.projectDetail}</p>
                <h3>{game.title}</h3>
              </div>
              <div className="topbar-actions">
                <button
                  className="icon-button icon-button-danger"
                  title={language === "tr" ? "Oyunu Sil" : "Delete Game"}
                  onClick={() => setConfirmDelete(true)}
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18">
                    <path d="M8.5 4h3M4 6h12M5.5 6l1 10h7l1-10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button className="icon-button" onClick={() => { setSelectedId(""); setDetailTab("overview"); }}>
                  {ui.close}
                </button>
              </div>
            </div>

            <header className="detail-hero">
              <div className="detail-cover">
                {game.coverDataUrl ? (
                  <img src={imgSrc(game.coverDataUrl)} alt={game.title} />
                ) : (
                  <div className="cover-placeholder large">{game.title.slice(0, 1)}</div>
                )}
              </div>
              <div className="detail-meta">
                <p className="eyebrow">{ui.selectedGame}</p>
                <h3>{game.title}</h3>
                <p className="detail-copy">{game.summary || ui.noShortDescription}</p>
                <div className="badge-column">
                  <span className="badge">{statusLabel(language, game.status)}</span>
                  <span className="badge ghost">{game.platforms.join(" / ") || ui.noPlatformSelected}</span>
                </div>
              </div>
            </header>

            <section className="quick-insights">
              <DashboardMetric label={ui.openTasks} value={String(game.tasks.filter((t) => !t.done).length)} />
              <DashboardMetric label={ui.totalVersions} value={String(game.versions.length)} />
              <DashboardMetric label={ui.readyBuild} value={game.currentBuildRelativePath ? ui.yes : ui.no} />
              <DashboardMetric label={ui.platform} value={game.platforms[0] ?? ui.notSpecified} />
            </section>

            <nav className="tabs">
              {DETAIL_TABS.map(({ key }) => (
                <button
                  key={key}
                  className={`tab ${detailTab === key ? "tab-active" : ""}`}
                  onClick={() => setDetailTab(key)}
                >
                  {tabLabel(language, key)}
                </button>
              ))}
            </nav>

            {detailTab === "overview"      && <OverviewTab gameId={game.id} />}
            {detailTab === "notes"         && <NotesTab gameId={game.id} />}
            {detailTab === "tasks"         && <TasksTab gameId={game.id} />}
            {detailTab === "versions"      && <VersionsTab gameId={game.id} />}
            {detailTab === "release"       && <ReleaseTab gameId={game.id} />}
            {detailTab === "moodboard"     && <MoodboardTab gameId={game.id} />}
            {detailTab === "integrations"  && <IntegrationsTab gameId={game.id} />}
            {detailTab === "storesync"     && <StoreSyncTab gameId={game.id} />}
          </section>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={language === "tr" ? "Oyunu Sil" : "Delete Game"}
          body={
            language === "tr"
              ? `"${game.title}" projesini silmek istediğine emin misin? Tüm görevler, notlar, sürümler, gider kayıtları ve moodboard verileri kalıcı olarak silinecek.`
              : `Delete "${game.title}"? All tasks, notes, versions, expenses, and moodboard items will be permanently removed.`
          }
          confirmLabel={language === "tr" ? "Sil" : "Delete"}
          cancelLabel={language === "tr" ? "Vazgeç" : "Cancel"}
          danger
          onConfirm={() => void onDeleteConfirm()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
