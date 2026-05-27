import { motion } from "framer-motion";
import { Check, Pencil, Trash2 } from "lucide-react";
import { dueToneClass, taskDeadlineLabel } from "../../lib/i18n";
import { imgSrc } from "../../lib/images";
import { colorForTag } from "../../lib/tagColor";
import logoMarkUrl from "../../assets/logo-mark.svg";
import { MoodboardThumbStrip } from "../library/MoodboardThumbStrip";
import type { FlatTask, KanbanColKey } from "../../types";

interface KanbanCardProps {
  task: FlatTask;
  colKey: KanbanColKey;
  active: boolean;
  /** True while this specific card is being dragged (for ghost opacity) */
  dragging: boolean;
  language: string;
  onSelect: () => void;
  // Priority up/down arrows are intentionally removed — drag-drop handles reordering.
  onMovePriority: (p: 1 | 2 | 3) => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Passed by KanbanBoard; starts the custom mouse-drag sequence */
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function KanbanCard({
  task, active, dragging, language,
  onSelect, onToggle, onEdit, onDelete, onMouseDown,
}: KanbanCardProps) {
  const toneClass     = dueToneClass(task);
  const deadlineLabel = taskDeadlineLabel(task, language as Parameters<typeof taskDeadlineLabel>[1]);
  const showBadge     = toneClass === "due-chip-overdue" || toneClass === "due-chip-soon";
  // The "Studio General" marker project has no cover image. Fall back to the
  // HeraVex logo mark instead of showing the empty initial-letter placeholder.
  const cover         = imgSrc(task.coverDataUrl) ?? (task.isGeneral ? logoMarkUrl : undefined);

  return (
    <motion.div
      layout={!dragging}
      transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
      className={[
        "kcard",
        `kcard-priority-${task.priority}`,
        active    ? "kcard-active"   : "",
        dragging  ? "kcard-dragging" : "",
        task.done ? "kcard-done"     : "",
      ].filter(Boolean).join(" ")}
      onMouseDown={onMouseDown}
      onClick={onSelect}
    >
      {/* Done check indicator (top-right) — replaced by quick actions on hover */}
      {task.done && (
        <span className="kcard-done-tick" aria-hidden="true">
          <Check size={12} strokeWidth={3} />
        </span>
      )}

      {/* Hover-revealed quick actions. Click events are stopped so the card's
       *  onClick / drag start handler doesn't fire. */}
      <div
        className="kcard-quick-actions"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="kcard-quick-btn"
          title={language === "tr" ? "Düzenle" : "Edit"}
          onClick={onEdit}
        >
          <Pencil size={11} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          className="kcard-quick-btn kcard-quick-btn-danger"
          title={language === "tr" ? "Sil" : "Delete"}
          onClick={onDelete}
        >
          <Trash2 size={11} strokeWidth={2.2} />
        </button>
      </div>

      {/* Title row — keeps right padding so hover actions don't bury the text */}
      <div className="kcard-top">
        <strong className="kcard-title">{task.title}</strong>
      </div>

      {/* Due badge moved to its own row so it never collides with the
       *  hover-revealed quick action icons in the top-right corner. */}
      {showBadge && (
        <div className="kcard-due-row">
          <span className={`kcard-due-badge ${toneClass}`}>{deadlineLabel}</span>
        </div>
      )}

      {/* Tag chips */}
      {task.tags && task.tags.length > 0 && (
        <div className="kcard-tags">
          {task.tags.slice(0, 4).map((tag) => {
            const c = colorForTag(tag);
            return (
              <span
                key={tag}
                className="kcard-tag-chip"
                style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.fg }}
              >
                {tag}
              </span>
            );
          })}
          {task.tags.length > 4 && (
            <span className="kcard-tag-chip kcard-tag-chip-more">+{task.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Moodboard reference strip — appears only when the task has
       *  linked moodboard images. Clicking jumps to Library →
       *  game → Moodboard → that item's detail modal. */}
      {task.moodboardImageIds && task.moodboardImageIds.length > 0 && (
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

      {/* Mini game badge (cover thumb + game title) */}
      <div className="kcard-game-badge" title={task.gameTitle}>
        {cover ? (
          <img src={cover} alt="" className="kcard-game-thumb" />
        ) : (
          <span className="kcard-game-thumb kcard-game-thumb-placeholder">
            {task.gameTitle.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="kcard-game-title">{task.gameTitle}</span>
      </div>

      {/* Due date (neutral — not overdue/soon) */}
      {task.dueDate && !showBadge && !task.done && (
        <p className="kcard-date">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" width="11" height="11">
            <rect x="1" y="2" width="12" height="11" rx="2" />
            <path d="M1 6h12M5 1v2M9 1v2" strokeLinecap="round" />
          </svg>
          {task.dueDate}
        </p>
      )}

      {/* Action row — only the complete/reopen toggle (arrows removed; drag-drop handles ranking) */}
      <div className="kcard-actions" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <button
          className={`kcard-btn kcard-btn-done ${task.done ? "kcard-btn-undo" : ""}`}
          title={task.done
            ? (language === "tr" ? "Geri al" : "Reopen")
            : (language === "tr" ? "Tamamla" : "Mark done")}
          onClick={onToggle}
        >
          {task.done ? "↩" : "✓"}
        </button>
      </div>
    </motion.div>
  );
}
