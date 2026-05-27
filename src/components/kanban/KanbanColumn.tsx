import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { KanbanCard } from "./KanbanCard";
import type { BoardColumn, FlatTask } from "../../types";

interface KanbanColumnProps {
  column: BoardColumn;
  tasks: FlatTask[];
  activeTaskId: string;
  draggingId: string | null;
  isDropTarget: boolean;
  /** True while THIS column is being dragged (renders dimmed in place). */
  isColumnDragging?: boolean;
  /** True while a *different* column is being dragged AND the cursor is over us. */
  isColumnDropTarget?: boolean;
  language: string;
  emptyLabel: string;
  onSelect: (id: string) => void;
  onMovePriority: (task: FlatTask, p: 1 | 2 | 3) => void;
  onToggle: (task: FlatTask) => void;
  onEdit: (task: FlatTask) => void;
  onDelete: (task: FlatTask) => void;
  onCardMouseDown: (task: FlatTask, e: React.MouseEvent<HTMLDivElement>) => void;
  onRenameColumn?: (colId: string, newTitle: string) => void;
  onDeleteColumn?: (colId: string) => void;
  /** Mouse-down on the column HEADER starts a column reorder drag. */
  onHeaderMouseDown?: (colId: string, e: React.MouseEvent<HTMLElement>) => void;
}

export function KanbanColumn({
  column, tasks, activeTaskId, draggingId, isDropTarget,
  isColumnDragging, isColumnDropTarget,
  language, emptyLabel,
  onSelect, onMovePriority, onToggle, onEdit, onDelete, onCardMouseDown,
  onRenameColumn, onDeleteColumn, onHeaderMouseDown,
}: KanbanColumnProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(column.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync draft whenever the underlying column title changes externally.
  useEffect(() => { setDraft(column.title); }, [column.title]);

  // Focus the input when we enter rename mode.
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitRename = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === column.title) return;
    onRenameColumn?.(column.id, next);
  };

  const cancelRename = () => {
    setDraft(column.title);
    setEditing(false);
  };

  const canEdit = !!onRenameColumn && !column.isDone;
  const canDelete = !!onDeleteColumn && !column.isDone;

  const canDragHeader = !!onHeaderMouseDown && !column.isDone && !editing;

  return (
    <div
      className={[
        "kanban-col",
        column.isDone ? "kanban-col-done" : "",
        isDropTarget ? "kanban-col-drop" : "",
        isColumnDragging ? "kanban-col-ghost" : "",
        isColumnDropTarget ? "kanban-col-reorder-target" : "",
      ].filter(Boolean).join(" ")}
      data-col-key={column.id}
    >
      {/* Header — also doubles as the drag handle when reordering is allowed */}
      <div
        className={`kanban-col-header${canDragHeader ? " kanban-col-header-draggable" : ""}`}
        style={{ borderTop: `3px solid ${column.color}`, color: column.color }}
        data-col-key={column.id}
        onMouseDown={canDragHeader
          ? (e) => onHeaderMouseDown?.(column.id, e)
          : undefined}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="kanban-col-rename-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
              if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
            }}
          />
        ) : (
          <button
            type="button"
            className="kanban-col-label-btn"
            onClick={() => canEdit && setEditing(true)}
            onDoubleClick={() => canEdit && setEditing(true)}
            title={canEdit
              ? (language === "tr" ? "Adlandırmak için tıkla" : "Click to rename")
              : (language === "tr" ? "Bu sütun sistem sütunudur, yeniden adlandırılamaz" : "System column — cannot be renamed")}
            disabled={!canEdit}
          >
            <span className="kanban-col-label">{column.title}</span>
            {canEdit && (
              <Pencil size={10} strokeWidth={2.2} className="kanban-col-edit-icon" />
            )}
          </button>
        )}

        <div className="kanban-col-header-right">
          <span className="kanban-count">{tasks.length}</span>
          {canDelete && (
            <button
              type="button"
              className="kanban-col-delete-btn"
              title={language === "tr" ? "Sütunu sil" : "Delete column"}
              onClick={() => onDeleteColumn?.(column.id)}
            >
              <Trash2 size={11} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      {/* Card list */}
      <div className="kanban-cards" data-col-key={column.id}>
        {tasks.length === 0 ? (
          <div className="kanban-empty-slot" data-col-key={column.id}>
            <span>{emptyLabel}</span>
          </div>
        ) : (
          tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              colKey={column.id}
              active={activeTaskId === task.id}
              dragging={draggingId === task.id}
              language={language}
              onSelect={() => onSelect(task.id)}
              onMovePriority={(p) => onMovePriority(task, p)}
              onToggle={() => onToggle(task)}
              onEdit={() => onEdit(task)}
              onDelete={() => onDelete(task)}
              onMouseDown={(e) => onCardMouseDown(task, e)}
            />
          ))
        )}
      </div>
    </div>
  );
}
