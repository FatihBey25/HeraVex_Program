import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trash, CheckCircle2, AlertTriangle, Gamepad2, Search } from "lucide-react";
import { EmptyState } from "../shared/EmptyState";
import { useAppStore } from "../../store";
import { statusLabel, statusToneClass } from "../../lib/i18n";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { imgSrc } from "../../lib/images";
import { isGeneralGame } from "../../lib/general-game";

// ── Tag categorisation ────────────────────────────────────────────────────────
// Categorises a tag based on keyword matching (TR + EN). Returns a CSS modifier.
const GENRE_KEYWORDS = [
  "2d", "3d", "pixel", "hand-drawn", "el çizimi", "voxel", "low poly", "low-poly",
  "anime", "cartoon", "realistic", "isometric", "izometrik", "topdown", "top-down",
  "side-scroller", "vr", "ar", "stylized", "stilize",
];
const MECHANIC_KEYWORDS = [
  "upgrade", "yükseltme", "roguelike", "rogue-like", "puzzle", "bulmaca",
  "platformer", "platform", "shooter", "rpg", "fps", "tps", "rts", "moba",
  "metroidvania", "souls", "deck", "kart", "card", "tower defense", "co-op",
  "coop", "multiplayer", "single", "pvp", "pve", "stealth", "survival",
  "hayatta kalma", "racing", "yarış", "rhythm", "ritim", "open world",
  "açık dünya", "sandbox", "crafting", "üretim", "battle royale", "strateji",
  "simülasyon", "simulation",
];
const THEME_KEYWORDS = [
  "atmosfer", "atmospheric", "hikaye", "story", "narrative", "anlatı",
  "horror", "korku", "hayalet", "ghost", "fantasy", "fantezi", "sci-fi",
  "scifi", "cyberpunk", "steampunk", "dark", "karanlık", "psikolojik",
  "psychological", "mystery", "gizem", "loop", "döngü", "post-apocalyptic",
  "futuristic", "fütüristik", "western", "noir", "mythology", "mitoloji",
  "retro",
];

function tagCategory(tag: string): "genre" | "mechanic" | "theme" | "default" {
  const t = tag.toLocaleLowerCase("tr").trim();
  if (GENRE_KEYWORDS.some((k) => t.includes(k))) return "genre";
  if (MECHANIC_KEYWORDS.some((k) => t.includes(k))) return "mechanic";
  if (THEME_KEYWORDS.some((k) => t.includes(k))) return "theme";
  return "default";
}

export function GameList({ onCreateGame }: { onCreateGame: () => void }) {
  const { games, selectedId, setSelectedId, handleDeleteGame, language, ui } = useAppStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<"all" | "active" | "ready">("all");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);

  // Internal marker games (e.g. "Studio General" that backs general tasks)
  // are not real projects and must never surface in the Games list or stats.
  const userGames = useMemo(() => games.filter((g) => !isGeneralGame(g)), [games]);

  const filteredGames = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase("tr");
    return userGames.filter((game) => {
      const filterPass =
        projectFilter === "all"
          ? true
          : projectFilter === "active"
            ? ["Fikir", "Prototip", "Demo", "Alpha", "Beta"].includes(game.status)
            : ["Yayina Hazir", "Yayinda"].includes(game.status);
      if (!filterPass) return false;
      if (!q) return true;
      return [game.title, game.summary, game.status, game.tags.join(" "), game.platforms.join(" ")]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(q);
    });
  }, [userGames, searchQuery, projectFilter]);

  const activeProjects = userGames.filter((g) =>
    ["Fikir", "Prototip", "Demo", "Alpha", "Beta"].includes(g.status)
  ).length;
  const readyProjects = userGames.filter((g) =>
    ["Yayina Hazir", "Yayinda"].includes(g.status)
  ).length;


  return (
    <>
    <section className="panel list-panel">
      <div className="panel-head projects-head projects-head-compact">
        <div className="projects-head-text">
          <p className="eyebrow">{ui.gamesEyebrow}</p>
          <h3>{ui.projectArchive}</h3>
          {/* Inline stat strip — replaces the three big pill cards.
              Reads like a sentence so it disappears next to the title. */}
          <p className="projects-stat-strip">
            <span><strong>{userGames.length}</strong> {language === "tr" ? "oyun" : "games"}</span>
            <span className="projects-stat-sep">·</span>
            <span><strong>{activeProjects}</strong> {language === "tr" ? "aktif" : "active"}</span>
            <span className="projects-stat-sep">·</span>
            <span><strong>{readyProjects}</strong> {language === "tr" ? "yayında" : "live"}</span>
          </p>
        </div>
        <button className="primary-button compact-button elevated-button" onClick={onCreateGame}>
          {ui.newProject}
        </button>
      </div>

      <div className="list-toolbar projects-toolbar">
        <input
          className="input projects-search"
          placeholder={ui.searchProjects}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="filter-row">
          {(["all", "active", "ready"] as const).map((f) => (
            <button
              key={f}
              className={`filter-chip ${projectFilter === f ? "filter-chip-active" : ""}`}
              onClick={() => setProjectFilter(f)}
            >
              {f === "all" ? ui.all : f === "active" ? ui.active : ui.ready}
            </button>
          ))}
        </div>
      </div>

      <motion.div className="game-list" layout>
        <AnimatePresence mode="wait">
          {!filteredGames.length && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <EmptyState
                icon={userGames.length ? Search : Gamepad2}
                title={String(userGames.length ? ui.noProjectsForFilter : ui.emptyLibrary)}
                description={String(userGames.length ? ui.noProjectsForFilterBody : ui.emptyLibraryBody)}
                action={
                  userGames.length === 0
                    ? {
                        label: String(ui.newProject ?? (language === "tr" ? "Yeni Proje" : "New Project")),
                        onClick: onCreateGame,
                      }
                    : {
                        label: language === "tr" ? "Filtreyi temizle" : "Clear filter",
                        onClick: () => { setSearchQuery(""); setProjectFilter("all"); },
                        variant: "outline",
                      }
                }
                size="compact"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {filteredGames.map((game) => {
            const isActive = game.id === selectedId;
            const openTaskCount = game.tasks.filter((t) => !t.done).length;
            const doneTaskCount = game.tasks.length - openTaskCount;
            const completionRatio = game.tasks.length
              ? Math.round((doneTaskCount / game.tasks.length) * 100)
              : 0;

            return (
              <motion.button
                key={game.id}
                layout
                className={`game-card ${isActive ? "game-card-active" : ""}`}
                onClick={() => setSelectedId(game.id)}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
              >
                <div className="game-card-media">
                  {game.coverDataUrl ? (
                    <img src={imgSrc(game.coverDataUrl)} alt={game.title} />
                  ) : (
                    <div className="cover-placeholder">{game.title.slice(0, 1)}</div>
                  )}
                  {/* Quick-action overlay */}
                  <div className="game-card-overlay">
                    <span
                      className="card-overlay-btn"
                      title={language === "tr" ? "Oyunu Görüntüle" : "View Game"}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(game.id); }}
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15">
                        <path d="M1 10s3-7 9-7 9 7 9 7-3 7-9 7-9-7-9-7z" strokeLinejoin="round" />
                        <circle cx="10" cy="10" r="3" />
                      </svg>
                    </span>
                    <span
                      className="card-overlay-btn card-overlay-btn-danger"
                      title={language === "tr" ? "Oyunu Sil" : "Delete Game"}
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete({ id: game.id, title: game.title }); }}
                    >
                      <Trash size={13} />
                    </span>
                  </div>
                </div>
                <div className="game-card-body">
                  <div className="game-card-top">
                    <strong>{game.title}</strong>
                    <span className={`status-tag ${statusToneClass(game.status)}`}>
                      {statusLabel(language, game.status)}
                    </span>
                  </div>
                  <p className="game-card-summary">{game.summary || ui.noDescription}</p>
                  <div className="tag-row">
                    {game.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className={`mini-tag mini-tag-${tagCategory(tag)}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mini-meta">
                    <span>{game.platforms.join(", ") || ui.noPlatform}</span>
                    <span className="mini-meta-versions">
                      {ui.versionCount(game.versions.length)}
                    </span>
                  </div>
                  {game.tasks.length > 0 && (
                    <div className="project-progress">
                      <div className="project-progress-label">
                        <span>{ui.taskProgress}</span>
                        <strong>%{completionRatio}</strong>
                      </div>
                      <div className="project-progress-track">
                        <span style={{ width: `${completionRatio}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="project-footer">
                    <span className="footer-task-count">{ui.openTaskCount(openTaskCount)}</span>
                    <span
                      className={`footer-build-status ${
                        game.currentBuildRelativePath ? "build-ok" : "build-missing"
                      }`}
                    >
                      {game.currentBuildRelativePath ? (
                        <>
                          <CheckCircle2 size={12} strokeWidth={2.4} />
                          {ui.buildAvailable}
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={12} strokeWidth={2.4} />
                          {ui.noBuild}
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </section>

    {confirmDelete && (
      <ConfirmDialog
        title={language === "tr" ? "Oyunu sil" : "Delete game"}
        body={`"${confirmDelete.title}" ${language === "tr" ? "ve tüm verileri silinecek. Bu işlem geri alınamaz." : "and all its data will be deleted. This cannot be undone."}`}
        confirmLabel={ui.delete ?? "Delete"}
        cancelLabel={ui.cancel ?? "Cancel"}
        danger
        onConfirm={() => { void handleDeleteGame(confirmDelete.id); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
    )}
    </>
  );
}
