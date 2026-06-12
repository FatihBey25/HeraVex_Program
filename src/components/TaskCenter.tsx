import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { FileText, ExternalLink, Plus, X, Inbox, ListTodo } from "lucide-react";
import { EmptyState } from "./shared/EmptyState";
import { useEscape } from "../lib/keyboard";
import { GENERAL_GAME_TAG, GENERAL_GAME_ID, isGeneralGame, findGeneralGame } from "../lib/general-game";
import { useAppStore, selectAllTasks } from "../store";
import { taskDeadlineLabel, dueToneClass, priorityLabel } from "../lib/i18n";
import { effectiveSeconds, formatHms, useSecondTicker } from "../lib/taskTimer";
import { colorForTag } from "../lib/tagColor";
import { MoodboardThumbStrip } from "./library/MoodboardThumbStrip";
import logoMarkUrl from "../assets/logo-mark.svg";
import {
  DONE_COLUMN_ID,
  defaultBoardColumns,
  ensureBoardColumns,
  newColumnId,
  nextColumnColor,
  sortedColumns,
} from "../lib/boardColumns";
import type { BoardColumn } from "../types";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { KanbanBoard } from "./kanban/KanbanBoard";
import { imgSrc } from "../lib/images";
import type { FlatTask, KanbanColKey, TaskItem } from "../types";

type ViewMode = "list" | "kanban";

export function TaskCenter() {
  const {
    games, activeTaskId, setActiveTaskId, setWorkspaceTab, setSelectedId,
    toggleTask, deleteTask, updateTaskInGame, handleSaveGame, handleCreateGame,
    language, ui,
  } = useAppStore();

  const [showAdd, setShowAdd] = useState(false);

  const [searchQuery, setSearchQuery]     = useState("");
  const [viewMode, setViewMode]           = useState<ViewMode>("list");
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("inspectorWidth");
      const parsed = saved ? parseInt(saved, 10) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 320;
    } catch {
      return 320;
    }
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{ gameId: string; taskId: string; title: string } | null>(null);
  /** Kanban-only centered detail modal. Opened via card click / quick-edit. */
  const [kanbanModalOpen, setKanbanModalOpen] = useState(false);

  // Persist inspector width on every change (debounced via rAF for resize burst)
  useEffect(() => {
    try { localStorage.setItem("inspectorWidth", String(inspectorWidth)); } catch {}
  }, [inspectorWidth]);

  // ── Resizable inspector drag ──────────────────────────────────────────────
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const inspectorWidthRef = useRef(inspectorWidth);
  inspectorWidthRef.current = inspectorWidth;

  const onResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: inspectorWidthRef.current };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - ev.clientX; // dragging left → wider panel
      // min: 22vw (dynamic),  max: viewport − sidebar(300) − task-list min(300) − gap
      const minW = Math.max(Math.floor(window.innerWidth * 0.22), 220);
      const maxW = Math.max(window.innerWidth - 300 - 320, minW + 40);
      const next = Math.min(maxW, Math.max(minW, dragRef.current.startW + delta));
      setInspectorWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const allTasks = useMemo(() => selectAllTasks(games), [games]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase(language);
    if (!q) return allTasks;
    return allTasks.filter((t) =>
      [t.title, t.description, t.gameTitle].join(" ").toLocaleLowerCase(language).includes(q)
    );
  }, [allTasks, searchQuery, language]);

  useEffect(() => {
    if (!filtered.length) { setActiveTaskId(""); return; }
    if (!activeTaskId || !filtered.some((t) => t.id === activeTaskId)) {
      setActiveTaskId(filtered[0].id);
    }
  }, [filtered, activeTaskId, setActiveTaskId]);

  const activeTask = filtered.find((t) => t.id === activeTaskId) ?? null;

  // ── Aggregate columns for the Kanban board.
  //   If a single project's tasks dominate the filtered view we use that
  //   game's columns; otherwise we fall back to the language-default set so
  //   the board still renders coherently across many projects. */
  const kanbanColumns = useMemo<BoardColumn[]>(() => {
    // Determine the focal game by counting how many filtered tasks belong to each.
    const counts = new Map<string, number>();
    for (const t of filtered) counts.set(t.gameId, (counts.get(t.gameId) ?? 0) + 1);
    let focalGameId = "";
    let max = 0;
    for (const [id, n] of counts.entries()) {
      if (n > max) { max = n; focalGameId = id; }
    }
    const focal = games.find((g) => g.id === focalGameId);
    if (focal && focal.boardColumns && focal.boardColumns.length) {
      return sortedColumns(focal.boardColumns);
    }
    return defaultBoardColumns(language as Parameters<typeof defaultBoardColumns>[0]);
  }, [filtered, games, language]);

  // ── Drop a task onto a column. If we land on the Done column we also mark
  //   the task as done; landing on any other column re-opens it. */
  //
  // v0.9.7 bug fix: drag-onto-Done was setting `done=true` but leaving
  // `completedAt` untouched. Every dashboard surface that counts
  // completions (hero "completed this week", the 7-day activity strip,
  // the "closed today" micro-stat) keys on `completedAt`, so a
  // drag-completed task wasn't appearing in any of them — only the
  // click-to-complete button (which now goes through the same patch
  // shape) wrote the timestamp. We mirror that contract here.
  const handleDropToCol = useCallback((task: FlatTask, colId: string) => {
    const game = games.find((g) => g.id === task.gameId);
    const col = (game?.boardColumns ?? kanbanColumns).find((c) => c.id === colId);
    const dropIsDone = col?.isDone === true || colId === DONE_COLUMN_ID;
    void updateTaskInGame(task.gameId, task.id, {
      boardColumnId: colId,
      done: dropIsDone,
      // Mirror the `handleToggleCard` contract: stamp on close, clear on
      // re-open. Keeping the value `null` when re-opening (instead of
      // undefined) lets the store's saver overwrite the previous time
      // explicitly so the dashboard doesn't keep counting it.
      completedAt: dropIsDone ? new Date().toISOString() : null,
    });
  }, [games, kanbanColumns, updateTaskInGame]);

  // ── Column CRUD: rename / delete / add new — only meaningful when there's
  //   a single focal game. The handlers persist to that game's record. */
  const focalGame = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of filtered) counts.set(t.gameId, (counts.get(t.gameId) ?? 0) + 1);
    let id = ""; let max = 0;
    for (const [k, n] of counts.entries()) if (n > max) { max = n; id = k; }
    return games.find((g) => g.id === id) ?? null;
  }, [filtered, games]);

  const handleAddColumn = useCallback(() => {
    if (!focalGame) return;
    const ensured = ensureBoardColumns(focalGame, language as Parameters<typeof ensureBoardColumns>[1]);
    const newCol: BoardColumn = {
      id: newColumnId(),
      title: language === "tr" ? "Yeni Sütun" : "New Column",
      color: nextColumnColor(ensured.boardColumns ?? []),
      order: (ensured.boardColumns?.length ?? 0),
    };
    // Insert before "done" so Done stays pinned visually.
    const cols = [...(ensured.boardColumns ?? [])];
    const doneIdx = cols.findIndex((c) => c.isDone);
    if (doneIdx >= 0) cols.splice(doneIdx, 0, newCol);
    else cols.push(newCol);
    void handleSaveGame({ ...ensured, boardColumns: cols });
  }, [focalGame, language, handleSaveGame]);

  const handleRenameColumn = useCallback((colId: string, newTitle: string) => {
    if (!focalGame) return;
    const cols = (focalGame.boardColumns ?? []).map((c) =>
      c.id === colId ? { ...c, title: newTitle } : c
    );
    void handleSaveGame({ ...focalGame, boardColumns: cols });
  }, [focalGame, handleSaveGame]);

  const handleDeleteColumn = useCallback((colId: string) => {
    if (!focalGame) return;
    const cols = focalGame.boardColumns ?? [];
    const target = cols.find((c) => c.id === colId);
    if (!target || target.isDone) return; // Done is undeletable
    // Move tasks from the deleted column to the first non-done column.
    const fallback = cols.find((c) => c.id !== colId && !c.isDone)?.id
                  ?? cols.find((c) => c.isDone)?.id
                  ?? "";
    const nextTasks = focalGame.tasks.map((t) =>
      t.boardColumnId === colId ? { ...t, boardColumnId: fallback } : t,
    );
    const nextCols = cols.filter((c) => c.id !== colId);
    void handleSaveGame({ ...focalGame, boardColumns: nextCols, tasks: nextTasks });
  }, [focalGame, handleSaveGame]);

  const handleReorderColumns = useCallback((movedId: string, targetId: string) => {
    if (!focalGame) return;
    const cols = (focalGame.boardColumns ?? []).slice();
    const movedIdx  = cols.findIndex((c) => c.id === movedId);
    const targetIdx = cols.findIndex((c) => c.id === targetId);
    if (movedIdx < 0 || targetIdx < 0) return;
    // Done is pinned last by sortedColumns(); we still write a sane order field.
    if (cols[movedIdx].isDone) return;
    const [moved] = cols.splice(movedIdx, 1);
    cols.splice(targetIdx, 0, moved);
    // Re-stamp `order` so the persisted array reads in the new visual order.
    const reordered = cols.map((c, i) => ({ ...c, order: i }));
    void handleSaveGame({ ...focalGame, boardColumns: reordered });
  }, [focalGame, handleSaveGame]);

  // ── ↑↓ button (priority only, task stays open) ───────────────────────────────
  const handleMovePriority = useCallback((task: FlatTask, p: 1 | 2 | 3) => {
    void updateTaskInGame(task.gameId, task.id, { priority: p });
  }, [updateTaskInGame]);

  // ── ✓ button in kanban card ───────────────────────────────────────────────────
  //
  // Bug fix v0.9.7: the bare `toggleTask` flipped `done` but left
  // `boardColumnId` untouched, so a card that had been dragged into
  // a custom column stayed put visually — `colIdForTask` (KanbanBoard)
  // honours an explicit `boardColumnId` over the `done` flag.
  //
  // The kanban variant of toggle now mirrors `handleDropToCol`:
  //   • becoming done  → snap to the game's Done column
  //   • becoming open  → clear `boardColumnId` so the task lands back
  //                       in the first non-done column on next render
  // Plus it still emits a notification (lifted from the store's
  // toggleTask path) so completion feedback parity is kept.
  const handleToggleCard = useCallback((task: FlatTask) => {
    const game = games.find((g) => g.id === task.gameId);
    if (!game) { void toggleTask(task.gameId, task.id); return; }
    const cols = game.boardColumns ?? kanbanColumns;
    const doneCol = cols.find((c) => c.isDone);
    const becomingDone = !task.done;
    void updateTaskInGame(task.gameId, task.id, {
      done: becomingDone,
      boardColumnId: becomingDone
        ? (doneCol?.id ?? DONE_COLUMN_ID)
        : null,
      completedAt: becomingDone ? new Date().toISOString() : null,
    });
  }, [games, kanbanColumns, toggleTask, updateTaskInGame]);

  const isKanban = viewMode === "kanban";
  // Inspector panel only shows in list mode; Kanban uses a centered modal so
  // the board never gets squeezed by a side panel.
  const showInspector = !isKanban;
  const gridStyle = showInspector
    ? { gridTemplateColumns: `1fr ${inspectorWidth}px` }
    : { gridTemplateColumns: "1fr" };

  // Tapping a card in kanban opens the centered modal automatically.
  const handleKanbanCardSelect = useCallback((id: string) => {
    setActiveTaskId(id);
    setKanbanModalOpen(true);
  }, [setActiveTaskId]);

  return (
    <div key="tasks" className="tasks-layout page-fade" style={gridStyle}>

      {/* ── LEFT: list / kanban ─────────────────────────────────────────────── */}
      <section className={`panel task-list-panel${isKanban ? " task-list-panel-kanban" : ""}`}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">{ui.tasksEyebrow}</p>
            <h3>{ui.taskCenter}</h3>
          </div>
          <div className="view-toggle">
            <button
              className="primary-button compact-button elevated-button task-add-btn"
              onClick={() => setShowAdd((s) => !s)}
              title={language === "tr" ? "Yeni görev ekle" : "Add new task"}
            >
              {showAdd
                ? <><X size={13} style={{ marginRight: 5 }} />{language === "tr" ? "Kapat" : "Close"}</>
                : <><Plus size={13} style={{ marginRight: 5 }} />{language === "tr" ? "Yeni Görev" : "New Task"}</>}
            </button>
            <button
              className={`filter-chip ${viewMode === "list" ? "filter-chip-active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              {language === "tr" ? "Liste" : "List"}
            </button>
            <button
              className={`filter-chip ${viewMode === "kanban" ? "filter-chip-active" : ""}`}
              onClick={() => setViewMode("kanban")}
            >
              Kanban
            </button>
            {/* Kanban no longer has a side panel toggle — taps open a centered modal. */}
          </div>
        </div>

        <div className="list-toolbar">
          <input
            className="input"
            placeholder={String(ui.searchTasks)}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <AnimatePresence>
          {showAdd && (
            <AddTaskModal
              games={games}
              defaultGameId={
                activeTask?.gameId ??
                (games.length > 0
                  ? (games.find((g) => ["Fikir","Prototip","Demo","Alpha","Beta"].includes(g.status))?.id ?? games[0].id)
                  : GENERAL_GAME_ID)
              }
              language={language}
              ui={ui as Record<string, unknown>}
              onCreate={async (pickedId, task) => {
                // Defensive wrapper: store actions already catch their own
                // failures and surface error toasts via translateError, but
                // any non-await throw (e.g. corrupted task payload, null
                // game lookup) would leave the modal stuck open. The catch
                // here keeps the modal closable on unexpected failures.
                try {
                  // Resolve "__general__" to a real (or freshly created) marker game
                  let targetGameId = pickedId;
                  if (pickedId === GENERAL_GAME_ID) {
                    const existing = findGeneralGame(games);
                    if (existing) {
                      targetGameId = existing.id;
                    } else {
                      const created = await handleCreateGame({
                        title: language === "tr" ? "Stüdyo Genel" : "Studio General",
                        summary: language === "tr"
                          ? "Belirli bir projeye bağlı olmayan genel görevler."
                          : "General tasks not tied to a specific project.",
                        status: "Fikir",
                        platforms: [],
                        tags: [GENERAL_GAME_TAG],
                      });
                      if (!created) return; // create failed → store already toasted
                      targetGameId = created.id;
                      // The game was created with no tasks; append immediately.
                      const savedNew = await handleSaveGame(
                        { ...created, tasks: [...created.tasks, task] },
                        String(ui.taskAdded ?? (language === "tr" ? "Görev eklendi" : "Task added")),
                      );
                      if (!savedNew) return; // save failed → keep modal open
                      setActiveTaskId(task.id);
                      setShowAdd(false);
                      return;
                    }
                  }
                  const game = games.find((g) => g.id === targetGameId);
                  if (!game) return;
                  const saved = await handleSaveGame(
                    { ...game, tasks: [...game.tasks, task] },
                    String(ui.taskAdded ?? (language === "tr" ? "Görev eklendi" : "Task added")),
                  );
                  if (!saved) return; // save failed → keep modal open
                  setActiveTaskId(task.id);
                  setShowAdd(false);
                } catch (err) {
                  // Last-resort guard; should be unreachable because the
                  // store wraps its IPC calls, but a defensive log keeps
                  // dev-time surprises debuggable. The modal stays open so
                  // the user can retry.
                  if (import.meta.env.DEV) console.warn("[task-add] unexpected:", err);
                }
              }}
              onClose={() => setShowAdd(false)}
            />
          )}
        </AnimatePresence>

        {viewMode === "list" ? (
          <ListView
            filtered={filtered}
            activeTaskId={activeTaskId}
            setActiveTaskId={setActiveTaskId}
            language={language}
            ui={ui}
          />
        ) : (
          <KanbanBoard
            filtered={filtered}
            activeTaskId={activeTaskId}
            language={language}
            columns={kanbanColumns}
            onSelect={handleKanbanCardSelect}
            onDropToCol={handleDropToCol}
            onMovePriority={handleMovePriority}
            onToggle={handleToggleCard}
            onEdit={(t) => { setActiveTaskId(t.id); setKanbanModalOpen(true); }}
            onDelete={(t) => setDeleteConfirm({ gameId: t.gameId, taskId: t.id, title: t.title })}
            onAddColumn={focalGame ? handleAddColumn : undefined}
            onRenameColumn={focalGame ? handleRenameColumn : undefined}
            onDeleteColumn={focalGame ? handleDeleteColumn : undefined}
            onReorderColumns={focalGame ? handleReorderColumns : undefined}
          />
        )}
      </section>

      {/* ── RIGHT: Inspector / task detail ──────────────────────────────────── */}
      {showInspector && (
        <section className={`panel task-detail-panel${isKanban ? " task-detail-panel-kanban" : ""}`} style={{ position: "relative" }}>
          {/* Drag-to-resize handle */}
          <div className="inspector-resizer" onMouseDown={onResizerMouseDown} />
          {!activeTask ? (
            <div className="empty-state">
              <svg className="empty-state-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="6" width="32" height="36" rx="4" />
                <path d="M16 16h16M16 23h16M16 30h10" />
                <circle cx="36" cy="36" r="8" fill="none" strokeWidth="2" />
                <path d="M33 36h6M36 33v6" />
              </svg>
              <h3>{ui.selectTaskTitle}</h3>
              <p>{ui.selectTaskBody}</p>
            </div>
          ) : (
            <TaskDetailFields
              task={activeTask}
              ui={ui}
              language={language}
              games={games}
              onToggle={() => void toggleTask(activeTask.gameId, activeTask.id)}
              onDelete={() => setDeleteConfirm({ gameId: activeTask.gameId, taskId: activeTask.id, title: activeTask.title })}
              onGoToGame={() => { setWorkspaceTab("library"); setSelectedId(activeTask.gameId); }}
              onPatch={(patch) => void updateTaskInGame(activeTask.gameId, activeTask.id, patch)}
              onOpenNote={() => { setSelectedId(activeTask.gameId); setWorkspaceTab("library"); }}
            />
          )}
        </section>
      )}

      {/* ── Kanban: centered detail modal ──────────────────────────────────── */}
      {isKanban && kanbanModalOpen && activeTask && (
        <KanbanTaskModal
          task={activeTask}
          ui={ui}
          language={language}
          games={games}
          onClose={() => setKanbanModalOpen(false)}
          onToggle={() => void toggleTask(activeTask.gameId, activeTask.id)}
          onDelete={() => {
            setKanbanModalOpen(false);
            setDeleteConfirm({ gameId: activeTask.gameId, taskId: activeTask.id, title: activeTask.title });
          }}
          onGoToGame={() => {
            setKanbanModalOpen(false);
            setWorkspaceTab("library");
            setSelectedId(activeTask.gameId);
          }}
          onPatch={(patch) => void updateTaskInGame(activeTask.gameId, activeTask.id, patch)}
          onOpenNote={() => {
            setKanbanModalOpen(false);
            setSelectedId(activeTask.gameId);
            setWorkspaceTab("library");
          }}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          title={String(ui.removeTask)}
          body={`"${deleteConfirm.title}" ${language === "tr" ? "silinecek. Geri alabilirsin." : "will be deleted. You can undo."}`}
          confirmLabel={String(ui.delete ?? "Delete")}
          cancelLabel={String(ui.cancel ?? "Cancel")}
          danger
          onConfirm={() => { void deleteTask(deleteConfirm.gameId, deleteConfirm.taskId); setDeleteConfirm(null); }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView({
  filtered, activeTaskId, setActiveTaskId, language, ui,
}: {
  filtered: FlatTask[];
  activeTaskId: string;
  setActiveTaskId: (id: string) => void;
  language: string;
  ui: Record<string, unknown>;
}) {
  const openTasks = filtered.filter((t) => !t.done);
  const doneTasks = filtered.filter((t) => t.done);
  return (
    <LayoutGroup>
      <motion.div className="stack-list" layout>
        {!filtered.length && (
          <EmptyState
            icon={ListTodo}
            title={String(ui.noTasksFound ?? (language === "tr" ? "Görev yok" : "No tasks"))}
            description={
              language === "tr"
                ? "Hızlıca başlamak için üstteki “+ Yeni Görev” butonunu kullan. Genel görev de ekleyebilirsin."
                : "Use the “+ New Task” button above to get started. You can also add a general task."
            }
            size="compact"
          />
        )}
        <AnimatePresence initial={false}>
          {openTasks.map((task) => (
            <ListTaskCard key={task.id} task={task} active={activeTaskId === task.id} language={language} ui={ui} onClick={() => setActiveTaskId(task.id)} />
          ))}
          {doneTasks.length > 0 && (
            <motion.h4
              key="done-label"
              layout
              className="done-section-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {String(ui.doneState)}
            </motion.h4>
          )}
          {doneTasks.map((task) => (
            <ListTaskCard key={task.id} task={task} active={activeTaskId === task.id} language={language} ui={ui} onClick={() => setActiveTaskId(task.id)} faded />
          ))}
        </AnimatePresence>
      </motion.div>
    </LayoutGroup>
  );
}

// ── Related note dropdown ─────────────────────────────────────────────────────

// ── Shared task detail body (inspector AND kanban modal) ───────────────
type TaskDetailFieldsProps = {
  task: FlatTask;
  ui: Record<string, unknown>;
  language: string;
  games: ReturnType<typeof useAppStore.getState>["games"];
  onToggle: () => void;
  onDelete: () => void;
  onGoToGame: () => void;
  onPatch: (patch: Partial<TaskItem>) => void;
  onOpenNote: () => void;
};

function TaskDetailFields({
  task, ui, language, games,
  onToggle, onDelete, onGoToGame, onPatch, onOpenNote,
}: TaskDetailFieldsProps) {
  const ut = ui as Record<string, string>;
  return (
    <div className="tab-panel">
      <div className="task-detail-header">
        <div className="task-detail-cover">
          {task.coverDataUrl ? (
            <img src={imgSrc(task.coverDataUrl)} alt={task.gameTitle} />
          ) : task.isGeneral ? (
            <img src={logoMarkUrl} alt={task.gameTitle} className="cover-placeholder-logo" />
          ) : (
            <div className="cover-placeholder large">{task.gameTitle.slice(0, 1)}</div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="eyebrow">{ut.selectedTaskEyebrow}</p>
          <h3 style={{ margin: "2px 0 4px", fontSize: "1rem" }}>{task.title}</h3>
          <p className="detail-copy" style={{ marginBottom: "0.75rem" }}>{task.gameTitle}</p>
          <div className="button-row" style={{ flexWrap: "wrap", gap: "6px" }}>
            <button className="secondary-button" onClick={onToggle}>
              {task.done ? ut.reopen : ut.markDone}
            </button>
            <button className="secondary-button danger-button" onClick={onDelete}>
              {ut.removeTask}
            </button>
            <button className="primary-button" onClick={onGoToGame}>
              {ut.goToGame}
            </button>
          </div>
        </div>
      </div>

      <label>
        <span>{ut.taskTitle}</span>
        <input
          className="input"
          value={task.title}
          onChange={(e) => onPatch({ title: e.target.value })}
        />
      </label>
      <label>
        <span>{ut.priority}</span>
        <select
          className="input"
          value={task.priority}
          onChange={(e) => onPatch({ priority: Number(e.target.value) as 1 | 2 | 3 })}
        >
          <option value={3}>{ut.high}</option>
          <option value={2}>{ut.medium}</option>
          <option value={1}>{ut.low}</option>
        </select>
      </label>
      <label>
        <span>{ut.dueDate}</span>
        <input
          className="input"
          type="date"
          value={task.dueDate ?? ""}
          onChange={(e) => onPatch({ dueDate: e.target.value || undefined })}
        />
      </label>
      <label>
        <span>{ut.description}</span>
        <textarea
          className="textarea giant"
          value={task.description}
          onChange={(e) => onPatch({ description: e.target.value })}
        />
      </label>

      <TaskTagInspector
        task={task}
        language={language}
        onChange={(tags) => onPatch({ tags })}
      />

      <RelatedNoteField
        task={task}
        gameNotes={games.find((g) => g.id === task.gameId)?.notes ?? ""}
        language={language}
        onChange={(heading) => onPatch({ relatedNoteHeading: heading })}
        onOpenNote={onOpenNote}
      />
    </div>
  );
}

// ── Kanban centered modal — wraps TaskDetailFields in a backdrop-blur shell.
function KanbanTaskModal({
  task, ui, language, games,
  onClose, onToggle, onDelete, onGoToGame, onPatch, onOpenNote,
}: TaskDetailFieldsProps & { onClose: () => void }) {
  useEscape(onClose);

  return (
    <div
      className="modal-backdrop kanban-modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <motion.div
        className="modal-box kanban-task-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
      >
        <header className="kanban-task-modal-head">
          <div>
            <p className="eyebrow">{(ui as Record<string, string>).selectedTaskEyebrow}</p>
            <h3 style={{ margin: "2px 0 0", fontSize: "1.05rem" }}>{task.title}</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={language === "tr" ? "Kapat" : "Close"}
            title={language === "tr" ? "Kapat" : "Close"}
          >
            <X size={16} />
          </button>
        </header>

        <div className="kanban-task-modal-body">
          <TaskDetailFields
            task={task}
            ui={ui}
            language={language}
            games={games}
            onToggle={onToggle}
            onDelete={onDelete}
            onGoToGame={onGoToGame}
            onPatch={onPatch}
            onOpenNote={onOpenNote}
          />
        </div>
      </motion.div>
    </div>
  );
}

// ── Tag editor used inside the inspector / kanban modal ───────────────────
function TaskTagInspector({
  task,
  language,
  onChange,
}: {
  task: FlatTask;
  language: string;
  onChange: (tags: string[]) => void;
}) {
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const tags = task.tags ?? [];
  const [input, setInput] = useState("");

  const addTag = () => {
    const t = input.trim();
    if (!t) return;
    if (tags.includes(t)) { setInput(""); return; }
    onChange([...tags, t]);
    setInput("");
  };
  const removeTag = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="task-tag-inspector">
      <label>
        <span>{tr("Tags", "Etiketler")}</span>
        <div className="task-tag-editor">
          {tags.map((t) => {
            const c = colorForTag(t);
            return (
              <span
                key={t}
                className="task-tag-chip task-tag-chip-removable"
                style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.fg }}
              >
                {t}
                <button
                  type="button"
                  className="task-tag-chip-remove"
                  aria-label={tr(`Remove ${t}`, `${t} kaldır`)}
                  onClick={() => removeTag(t)}
                >
                  ×
                </button>
              </span>
            );
          })}
          <input
            className="input task-tag-input"
            placeholder={tr("Bug, Design, Audio…", "Bug, Tasarım, Ses…")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              } else if (e.key === "Backspace" && input === "" && tags.length) {
                onChange(tags.slice(0, -1));
              }
            }}
          />
        </div>
      </label>
    </div>
  );
}

function RelatedNoteField({
  task,
  gameNotes,
  language,
  onChange,
  onOpenNote,
}: {
  task: FlatTask;
  gameNotes: string;
  language: string;
  onChange: (heading: string | null) => void;
  onOpenNote: () => void;
}) {
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const headings = useMemo(() => {
    const out: string[] = [];
    for (const line of gameNotes.split("\n")) {
      const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
      if (m) out.push(m[2].trim());
    }
    return out;
  }, [gameNotes]);

  const current = task.relatedNoteHeading ?? "";
  const exists = current && headings.includes(current);

  // Localized labels — UI copy is in 4 languages so the explainer renders
  // naturally regardless of the active language.
  const L = (key: "label" | "explain" | "placeholderNone" | "placeholderHasHeadings" | "missing" | "openNote" | "openHint" | "noHeadingsHint") => {
    const dict: Record<string, Record<string, string>> = {
      label: {
        en: "Related Note",
        tr: "İlgili Not",
        fr: "Note liée",
        es: "Nota vinculada",
      },
      explain: {
        en: "Link this task to a specific section of your Game Design Document (or any markdown note).",
        tr: "Bu görevi Oyun Tasarım Dokümanındaki (GDD) bir notla veya bölümle ilişkilendirin.",
        fr: "Liez cette tâche à une section précise de votre Game Design Document (ou de toute note markdown).",
        es: "Vincula esta tarea a una sección específica de tu Game Design Document (o cualquier nota markdown).",
      },
      placeholderNone: {
        en: "— Pick a note section to link —",
        tr: "— Bağlanacak not bölümü seç —",
        fr: "— Choisir une section à lier —",
        es: "— Elige una sección para vincular —",
      },
      placeholderHasHeadings: {
        en: "— No link (choose a heading below) —",
        tr: "— Bağlantı yok (alttan başlık seç) —",
        fr: "— Aucun lien (choisissez un titre) —",
        es: "— Sin enlace (elige un encabezado) —",
      },
      missing: { en: "missing", tr: "yok", fr: "introuvable", es: "no encontrado" },
      openNote: { en: "Open note", tr: "Notu aç", fr: "Ouvrir la note", es: "Abrir la nota" },
      openHint: {
        en: "Open in notes tab",
        tr: "Not sekmesinde aç",
        fr: "Ouvrir dans l'onglet Notes",
        es: "Abrir en la pestaña Notas",
      },
      noHeadingsHint: {
        en: "Tip: add ## headings inside the game's notes to populate this list.",
        tr: "İpucu: bu listeyi doldurmak için oyunun notlarına ## başlıkları ekleyin.",
        fr: "Astuce : ajoutez des titres ## dans les notes du jeu pour remplir cette liste.",
        es: "Consejo: añade encabezados ## en las notas del juego para llenar esta lista.",
      },
    };
    return dict[key][language] ?? dict[key].en;
  };

  return (
    <div className="related-note-field related-note-field-spaced">
      <label>
        <span title={L("explain")}>
          <FileText size={12} style={{ marginRight: 5, verticalAlign: -1 }} />
          {L("label")}
          <span className="related-note-info-dot" aria-hidden="true">?</span>
        </span>
        {/* Always-visible explainer — replaces opaque "Related Note" header */}
        <p className="related-note-explainer">{L("explain")}</p>
        <select
          className="input"
          value={current}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">
            {headings.length === 0 ? L("placeholderNone") : L("placeholderHasHeadings")}
          </option>
          {headings.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
          {current && !exists && (
            <option value={current}>{current} ({L("missing")})</option>
          )}
        </select>
      </label>
      {current && (
        <button
          type="button"
          className="secondary-button compact-button related-note-jump"
          onClick={onOpenNote}
          title={L("openHint")}
        >
          <ExternalLink size={12} style={{ marginRight: 5 }} />
          {L("openNote")}
        </button>
      )}
      {headings.length === 0 && (
        <p className="related-note-hint">{L("noHeadingsHint")}</p>
      )}
    </div>
  );
}

// ── Add task form ─────────────────────────────────────────────────────────────

function AddTaskModal({
  games, defaultGameId, language, ui, onCreate, onClose,
}: {
  games: ReturnType<typeof useAppStore.getState>["games"];
  defaultGameId: string;
  language: string;
  ui: Record<string, unknown>;
  onCreate: (gameId: string, task: TaskItem) => Promise<void>;
  onClose: () => void;
}) {
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  useEscape(onClose);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState<1 | 2 | 3>(2);
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [gameIdDraft, setGameIdDraft] = useState(defaultGameId);
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Hide the marker game from the chip list — it's represented by the
  // dedicated "Genel" chip instead.
  const visibleGames = games.filter((g) => !isGeneralGame(g));

  const submit = async () => {
    const title = titleDraft.trim();
    if (!title || !gameIdDraft) return;
    const task: TaskItem = {
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      description: descDraft.trim(),
      done: false,
      priority: priorityDraft,
      dueDate: dueDateDraft || undefined,
      timeSpentSeconds: 0,
      runningSince: new Date().toISOString(),
      tags: tagsDraft.length ? tagsDraft : undefined,
    };
    await onCreate(gameIdDraft, task);
    setTitleDraft(""); setDescDraft(""); setPriorityDraft(2); setDueDateDraft("");
    setTagsDraft([]); setTagInput("");
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (tagsDraft.includes(t)) { setTagInput(""); return; }
    setTagsDraft([...tagsDraft, t]);
    setTagInput("");
  };
  const removeTag = (t: string) => setTagsDraft(tagsDraft.filter((x) => x !== t));

  const isGeneralActive = gameIdDraft === GENERAL_GAME_ID
    || !!findGeneralGame(games.filter((g) => g.id === gameIdDraft));

  return (
    <motion.div
      className="modal-backdrop task-add-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <motion.div
        className="modal-box task-add-modal"
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={tr("Add task", "Görev Ekle")}
      >
        <header className="task-add-modal-head">
          <div>
            <p className="eyebrow">{tr("NEW TASK", "YENİ GÖREV")}</p>
            <h3 style={{ margin: "2px 0 0" }}>
              {tr("Capture what's next", "Sıradakini yakala")}
            </h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={tr("Close", "Kapat")}
            title={tr("Close", "Kapat")}
          >
            <X size={16} />
          </button>
        </header>

        <div className="task-add-form-inner task-add-form-inner-roomy">

        {/* Row 1: title (full width) */}
        <input
          className="input task-add-title-input"
          placeholder={tr("Task title", "Görev başlığı")}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && titleDraft.trim()) void submit(); }}
          autoFocus
        />

        {/* Row 2: project picker (full width, wraps) */}
        <div className="task-add-section">
          <label className="task-add-section-label">
            {tr("PROJECT", "PROJE")}
          </label>
          <div className="task-add-project-row">
            <button
              type="button"
              className={`task-project-chip task-project-chip-general ${isGeneralActive ? "is-active" : ""}`}
              onClick={() => setGameIdDraft(GENERAL_GAME_ID)}
              title={tr("Task not tied to a specific project", "Belirli bir projeye bağlı olmayan görev")}
            >
              <span className="task-project-chip-icon">
                <Inbox size={13} strokeWidth={2.2} />
              </span>
              <span className="task-project-chip-name">
                {tr("General", "Genel")}
              </span>
            </button>
            {visibleGames.map((g) => {
              const active = gameIdDraft === g.id;
              const cover = g.coverDataUrl ? imgSrc(g.coverDataUrl) : "";
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`task-project-chip ${active ? "is-active" : ""}`}
                  onClick={() => setGameIdDraft(g.id)}
                  title={g.title}
                >
                  {cover ? (
                    <img src={cover} alt="" className="task-project-chip-thumb" />
                  ) : (
                    <span className="task-project-chip-thumb task-project-chip-thumb-placeholder">
                      {g.title.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="task-project-chip-name">{g.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 3: priority + date (2 columns, breathes) */}
        <div className="task-add-form-row-split">
          <div className="task-add-section">
            <label className="task-add-section-label">
              {tr("PRIORITY", "ÖNCELİK")}
            </label>
            <div className="task-add-priority-row">
              {([3, 2, 1] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`task-priority-chip task-priority-chip-${p} ${priorityDraft === p ? "is-active" : ""}`}
                  onClick={() => setPriorityDraft(p)}
                >
                  {p === 3 ? String(ui.high) : p === 2 ? String(ui.medium) : String(ui.low)}
                </button>
              ))}
            </div>
          </div>
          <div className="task-add-section">
            <label className="task-add-section-label">
              {tr("DUE DATE", "BİTİŞ TARİHİ")}
            </label>
            <input
              className="input"
              type="date"
              value={dueDateDraft}
              onChange={(e) => setDueDateDraft(e.target.value)}
            />
          </div>
        </div>

        {/* Row 4: description */}
        <div className="task-add-section">
          <label className="task-add-section-label">
            {tr("DESCRIPTION", "AÇIKLAMA")}
          </label>
          <textarea
            className="textarea"
            rows={2}
            placeholder={tr("Optional notes…", "İsteğe bağlı notlar…")}
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
          />
        </div>

        {/* Row 5: tags */}
        <div className="task-add-section">
          <label className="task-add-section-label">
            {tr("TAGS", "ETİKETLER")}
          </label>
          <div className="task-tag-editor">
            {tagsDraft.map((t) => {
              const c = colorForTag(t);
              return (
                <span
                  key={t}
                  className="task-tag-chip task-tag-chip-removable"
                  style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.fg }}
                >
                  {t}
                  <button
                    type="button"
                    className="task-tag-chip-remove"
                    aria-label={tr(`Remove ${t}`, `${t} kaldır`)}
                    onClick={() => removeTag(t)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <input
              className="input task-tag-input"
              placeholder={tr("Bug, Design, Audio…", "Bug, Tasarım, Ses…")}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                } else if (e.key === "Backspace" && tagInput === "" && tagsDraft.length) {
                  setTagsDraft(tagsDraft.slice(0, -1));
                }
              }}
            />
          </div>
        </div>

        <div className="task-add-form-actions">
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={onClose}
          >
            {tr("Cancel", "İptal")}
          </button>
          <button
            type="button"
            className="primary-button compact-button"
            onClick={() => void submit()}
            disabled={!titleDraft.trim()}
          >
            <Plus size={12} style={{ marginRight: 5 }} />
            {tr("Add Task", "Görev Ekle")}
          </button>
        </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── List task card ────────────────────────────────────────────────────────────

function ListTaskCard({ task, active, language, ui, onClick, faded = false }: {
  task: FlatTask;
  active: boolean;
  language: string;
  ui: Record<string, unknown>;
  onClick: () => void;
  faded?: boolean;
}) {
  // Live re-render while this task's timer is running.
  const running = !task.done && !!task.runningSince;
  useSecondTicker(running);
  const seconds = effectiveSeconds(task);

  return (
    <motion.button
      layout
      layoutId={`task-card-${task.id}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: faded ? 0.55 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
      className={`task-card task-card-priority-${task.priority} ${task.done ? "task-card-done" : ""} ${active ? "task-card-active" : ""}`}
      onClick={onClick}
    >
      <div className="task-card-cover">
        {task.coverDataUrl ? (
          <img src={imgSrc(task.coverDataUrl)} alt={task.gameTitle} />
        ) : task.isGeneral ? (
          <img src={logoMarkUrl} alt={task.gameTitle} className="cover-placeholder-logo" />
        ) : (
          <div className="cover-placeholder mini">{task.gameTitle.slice(0, 1)}</div>
        )}
      </div>
      <div className="task-card-body">
        <div className="task-card-top">
          <strong
            className="task-card-title"
            style={faded ? { textDecoration: "line-through" } : undefined}
          >
            {task.title}
          </strong>
          {!faded && (
            <span className={`priority-badge priority-${task.priority}`}>
              {priorityLabel(task.priority, language as Parameters<typeof priorityLabel>[1])}
            </span>
          )}
        </div>
        <p className="task-card-game">{task.gameTitle}</p>
        {!faded && (
          <div className="task-card-foot">
            <small className={`due-chip ${dueToneClass(task)}`}>
              {taskDeadlineLabel(task, language as Parameters<typeof taskDeadlineLabel>[1])}
            </small>
            {seconds > 0 && (
              <small className={`task-timer-chip ${running ? "task-timer-chip-live" : ""}`} title={running ? (language === "tr" ? "Sayaç akıyor" : "Timer running") : (language === "tr" ? "Toplam süre" : "Total time")}>
                <span className="task-timer-dot" />
                {formatHms(seconds)}
              </small>
            )}
            {(task.tags ?? []).slice(0, 3).map((tag) => {
              const c = colorForTag(tag);
              return (
                <small
                  key={tag}
                  className="task-tag-chip"
                  style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.fg }}
                >
                  {tag}
                </small>
              );
            })}
            {(task.tags?.length ?? 0) > 3 && (
              <small className="task-tag-chip task-tag-chip-more">+{(task.tags?.length ?? 0) - 3}</small>
            )}
          </div>
        )}
        {/* Moodboard reference strip — list view counterpart of the
         *  Kanban card affordance. */}
        {!faded && task.moodboardImageIds && task.moodboardImageIds.length > 0 && (
          <MoodboardThumbStrip
            gameId={task.gameId}
            imageIds={task.moodboardImageIds}
            label={
              language === "tr" ? "Moodboard referansları"
              : language === "fr" ? "References moodboard"
              : language === "es" ? "Referencias del moodboard"
              : "Moodboard references"
            }
          />
        )}
      </div>
    </motion.button>
  );
}
