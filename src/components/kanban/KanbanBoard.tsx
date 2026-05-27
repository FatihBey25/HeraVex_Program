import { useCallback, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { KanbanColumn } from "./KanbanColumn";
import { DONE_COLUMN_ID, sortedColumns } from "../../lib/boardColumns";
import type { BoardColumn, FlatTask } from "../../types";

/** Decide which column a task belongs in. Explicit `boardColumnId` wins; falls
 *  back to "done" when task.done is true, otherwise to the first non-done col. */
function colIdForTask(t: FlatTask, columns: BoardColumn[]): string {
  if (t.boardColumnId && columns.some((c) => c.id === t.boardColumnId)) {
    return t.boardColumnId;
  }
  if (t.done) {
    return columns.find((c) => c.isDone)?.id ?? DONE_COLUMN_ID;
  }
  return columns.find((c) => !c.isDone)?.id ?? columns[0]?.id ?? DONE_COLUMN_ID;
}

/** Read [data-col-key] from the element or any ancestor */
function colKeyFromPoint(x: number, y: number): string {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const colEl = el?.closest("[data-col-key]") as HTMLElement | null;
  return colEl?.dataset.colKey ?? "";
}

interface KanbanBoardProps {
  filtered: FlatTask[];
  activeTaskId: string;
  language: string;
  /** Live columns (from active game, or aggregated default for the "all games"
   *  view). The board renders these in order, with Done pinned last. */
  columns: BoardColumn[];
  onSelect: (id: string) => void;
  onDropToCol: (task: FlatTask, colId: string) => void;
  onMovePriority: (task: FlatTask, p: 1 | 2 | 3) => void;
  onToggle: (task: FlatTask) => void;
  onEdit: (task: FlatTask) => void;
  onDelete: (task: FlatTask) => void;
  onAddColumn?: () => void;
  onRenameColumn?: (colId: string, newTitle: string) => void;
  onDeleteColumn?: (colId: string) => void;
  /** Called when the user drags a column header onto another column. The
   *  callee is responsible for reordering the board's `boardColumns` array. */
  onReorderColumns?: (movedColId: string, targetColId: string) => void;
}

export function KanbanBoard({
  filtered, activeTaskId, language, columns,
  onSelect, onDropToCol, onMovePriority, onToggle, onEdit, onDelete,
  onAddColumn, onRenameColumn, onDeleteColumn, onReorderColumns,
}: KanbanBoardProps) {
  const [draggingId, setDraggingId]       = useState<string | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<string>("");
  const [draggingColId, setDraggingColId] = useState<string>("");
  const [colDropTarget, setColDropTarget] = useState<string>("");

  // Refs — never stale inside event handlers
  const ghostRef         = useRef<HTMLDivElement | null>(null);
  const draggingIdRef    = useRef<string | null>(null);
  const dropTargetColRef = useRef<string>("");
  const filteredRef      = useRef(filtered);
  filteredRef.current    = filtered;
  const columnsRef       = useRef(columns);
  columnsRef.current     = columns;
  // Column-drag refs (separate from card drag — never mixed)
  const colGhostRef          = useRef<HTMLDivElement | null>(null);
  const draggingColIdRef     = useRef<string>("");
  const colDropTargetRef     = useRef<string>("");
  const onReorderColumnsRef  = useRef(onReorderColumns);
  onReorderColumnsRef.current = onReorderColumns;

  // ── Drag cleanup ────────────────────────────────────────────────────────
  const cleanup = useCallback((didActuallyDrag: boolean) => {
    ghostRef.current?.remove();
    ghostRef.current = null;
    document.body.style.cursor = "";
    document.body.classList.remove("body-dragging");

    const id  = draggingIdRef.current;
    const col = dropTargetColRef.current;
    draggingIdRef.current    = null;
    dropTargetColRef.current = "";

    setDraggingId(null);
    setDropTargetCol("");

    if (didActuallyDrag && id && col) {
      const task = filteredRef.current.find((t) => t.id === id);
      if (task && colIdForTask(task, columnsRef.current) !== col) {
        onDropToCol(task, col);
      }
    }

    // Swallow the synthetic click that follows mouseup so the card's onSelect
    // doesn't fire after a genuine drag.
    if (didActuallyDrag) {
      const absorb = (e: Event) => {
        e.stopPropagation();
        window.removeEventListener("click", absorb, true);
      };
      window.addEventListener("click", absorb, true);
    }
  }, [onDropToCol]);

  // ── Card mouse-down → drag start ─────────────────────────────────────────
  const onCardMouseDown = useCallback((task: FlatTask, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    const cardEl   = e.currentTarget as HTMLDivElement;
    const rect     = cardEl.getBoundingClientRect();
    const startX   = e.clientX;
    const startY   = e.clientY;
    const offsetX  = e.clientX - rect.left;
    const offsetY  = e.clientY - rect.top;

    let dragging = false;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (!dragging) {
        if (Math.hypot(dx, dy) < 6) return;
        dragging = true;

        const ghost = cardEl.cloneNode(true) as HTMLDivElement;
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.cssText = [
          "position:fixed",
          `width:${rect.width}px`,
          `left:${startX - offsetX}px`,
          `top:${startY - offsetY}px`,
          "pointer-events:none",
          "z-index:9999",
          "opacity:0.82",
          "transform:scale(1.03) rotate(1.5deg)",
          "box-shadow:0 18px 40px rgba(0,0,0,0.55),0 0 0 2px rgba(79,140,255,0.45)",
          "transition:none",
        ].join(";");
        document.body.appendChild(ghost);
        ghostRef.current    = ghost;

        draggingIdRef.current = task.id;
        setDraggingId(task.id);

        document.body.style.cursor = "grabbing";
        document.body.classList.add("body-dragging");
      }

      if (ghostRef.current) {
        ghostRef.current.style.left = `${ev.clientX - offsetX}px`;
        ghostRef.current.style.top  = `${ev.clientY - offsetY}px`;
      }

      const col = colKeyFromPoint(ev.clientX, ev.clientY);
      if (col !== dropTargetColRef.current) {
        dropTargetColRef.current = col;
        setDropTargetCol(col);
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      cleanup(dragging);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [cleanup]);

  // ── Column drag (mirrors card drag — separate state to keep handlers clean)
  const colDragCleanup = useCallback((didActuallyDrag: boolean) => {
    colGhostRef.current?.remove();
    colGhostRef.current = null;
    document.body.style.cursor = "";
    document.body.classList.remove("body-col-dragging");

    const movedId  = draggingColIdRef.current;
    const targetId = colDropTargetRef.current;
    draggingColIdRef.current = "";
    colDropTargetRef.current = "";
    setDraggingColId("");
    setColDropTarget("");

    if (didActuallyDrag && movedId && targetId && movedId !== targetId) {
      onReorderColumnsRef.current?.(movedId, targetId);
    }

    // Swallow the click that follows mouseup so we don't accidentally trigger
    // the column's rename mode after a successful drag.
    if (didActuallyDrag) {
      const absorb = (e: Event) => {
        e.stopPropagation();
        window.removeEventListener("click", absorb, true);
      };
      window.addEventListener("click", absorb, true);
    }
  }, []);

  const onColumnHeaderMouseDown = useCallback((colId: string, e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    // Ignore drags from clickable controls inside the header (rename pencil,
    // delete button) — they have their own click handlers.
    const tgt = e.target as HTMLElement;
    if (tgt.closest("input, button:not(.kanban-col-label-btn), .kanban-col-rename-input")) {
      return;
    }
    if (!onReorderColumnsRef.current) return; // reordering disabled

    const colEl   = e.currentTarget as HTMLElement;
    const rect    = colEl.getBoundingClientRect();
    const startX  = e.clientX;
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    let dragging = false;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < 8) return; // dead zone — protect rename clicks
        dragging = true;

        // Build a header-shaped ghost (just the colored title bar).
        const ghost = colEl.cloneNode(true) as HTMLDivElement;
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.cssText = [
          "position:fixed",
          `width:${rect.width}px`,
          `left:${ev.clientX - offsetX}px`,
          `top:${ev.clientY - offsetY}px`,
          "pointer-events:none",
          "z-index:9999",
          "opacity:0.9",
          "transform:scale(1.03) rotate(-0.6deg)",
          "box-shadow:0 18px 40px rgba(0,0,0,0.55),0 0 0 2px rgba(167,139,250,0.45)",
          "transition:none",
          "background:rgba(20,24,35,0.95)",
          "border-radius:10px",
          "overflow:hidden",
        ].join(";");
        document.body.appendChild(ghost);
        colGhostRef.current = ghost;

        draggingColIdRef.current = colId;
        setDraggingColId(colId);

        document.body.style.cursor = "grabbing";
        document.body.classList.add("body-col-dragging");
      }

      if (colGhostRef.current) {
        colGhostRef.current.style.left = `${ev.clientX - offsetX}px`;
        colGhostRef.current.style.top  = `${ev.clientY - offsetY}px`;
      }

      // Detect target column under cursor using the same data-col-key probe
      // the card system uses. We pick the FIRST element matching, which is
      // always the column root since columns wrap their interior.
      const targetCol = colKeyFromPoint(ev.clientX, ev.clientY);
      if (targetCol !== colDropTargetRef.current) {
        colDropTargetRef.current = targetCol;
        setColDropTarget(targetCol);
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      colDragCleanup(dragging);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colDragCleanup]);

  // ── Bucket tasks per column ──────────────────────────────────────────────
  const orderedColumns = useMemo(() => sortedColumns(columns), [columns]);
  const cols = useMemo<Record<string, FlatTask[]>>(() => {
    const map: Record<string, FlatTask[]> = {};
    for (const c of orderedColumns) map[c.id] = [];
    for (const t of filtered) {
      const id = colIdForTask(t, orderedColumns);
      (map[id] ?? (map[id] = [])).push(t);
    }
    return map;
  }, [filtered, orderedColumns]);

  const emptyLabel = language === "tr" ? "Görev yok" : "No tasks";

  return (
    <div className="kanban-board">
      {orderedColumns.map((col) => (
        <KanbanColumn
          key={col.id}
          column={col}
          tasks={cols[col.id] ?? []}
          activeTaskId={activeTaskId}
          draggingId={draggingId}
          isDropTarget={dropTargetCol === col.id}
          isColumnDragging={draggingColId === col.id}
          isColumnDropTarget={!!draggingColId && colDropTarget === col.id && colDropTarget !== draggingColId}
          language={language}
          emptyLabel={emptyLabel}
          onSelect={onSelect}
          onMovePriority={onMovePriority}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onCardMouseDown={onCardMouseDown}
          onRenameColumn={onRenameColumn}
          onDeleteColumn={onDeleteColumn}
          onHeaderMouseDown={onReorderColumns ? onColumnHeaderMouseDown : undefined}
        />
      ))}

      {onAddColumn && (
        <button
          type="button"
          className="kanban-add-col"
          onClick={onAddColumn}
          title={language === "tr" ? "Yeni sütun ekle" : "Add column"}
        >
          <Plus size={16} strokeWidth={2.1} />
          <span>{language === "tr" ? "Yeni Sütun" : "Add Column"}</span>
        </button>
      )}
    </div>
  );
}
