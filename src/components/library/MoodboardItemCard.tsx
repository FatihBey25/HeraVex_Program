import { useState } from "react";
import { Pencil, MoreHorizontal, ListTodo, FileText, Trash2 } from "lucide-react";
import type { MoodboardItem } from "../../types";
import { imgSrc } from "../../lib/images";
import { colorForTag } from "../../lib/tagColor";

interface Props {
  item: MoodboardItem;
  /** Open the detail modal. */
  onOpen: (id: string) => void;
  /** Inline title edit shortcut — opens the modal already focused on
   *  the title input. */
  onQuickEdit: (id: string) => void;
  /** Show the "..." popover anchored to this card. The parent owns the
   *  popover so links can use the live task/note list. */
  onOpenMenu: (id: string, anchor: HTMLElement) => void;
  onDelete: (id: string) => void;
  linkedCountLabel?: string;
  editLabel: string;
  menuLabel: string;
  deleteLabel: string;
}

export function MoodboardItemCard({
  item,
  onOpen,
  onQuickEdit,
  onOpenMenu,
  onDelete,
  linkedCountLabel,
  editLabel,
  menuLabel,
  deleteLabel,
}: Props) {
  const [hovering, setHovering] = useState(false);

  const linkedCount = item.linkedTaskIds.length + item.linkedNoteIds.length;
  const visibleTags = item.tags.slice(0, 4);
  const extraTagCount = item.tags.length - visibleTags.length;

  return (
    <div
      className="mb-card"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => onOpen(item.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item.id);
        }
      }}
    >
      <div className="mb-card-media">
        <img
          src={imgSrc(item.path)}
          alt={item.title || item.filename}
          loading="lazy"
        />
        {hovering && (
          <div
            className="mb-card-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="mb-card-action"
              title={editLabel}
              aria-label={editLabel}
              onClick={(e) => {
                e.stopPropagation();
                onQuickEdit(item.id);
              }}
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              className="mb-card-action"
              title={menuLabel}
              aria-label={menuLabel}
              onClick={(e) => {
                e.stopPropagation();
                onOpenMenu(item.id, e.currentTarget);
              }}
            >
              <MoreHorizontal size={13} />
            </button>
            <button
              type="button"
              className="mb-card-action mb-card-action-danger"
              title={deleteLabel}
              aria-label={deleteLabel}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
        {linkedCount > 0 && (
          <div className="mb-card-link-badge" title={linkedCountLabel}>
            {item.linkedTaskIds.length > 0 && <ListTodo size={11} />}
            {item.linkedNoteIds.length > 0 && <FileText size={11} />}
            <span>{linkedCount}</span>
          </div>
        )}
      </div>

      <div className="mb-card-body">
        <div className="mb-card-title">{item.title || item.filename}</div>
        {item.description && (
          <div className="mb-card-description">{item.description}</div>
        )}
        {visibleTags.length > 0 && (
          <div className="mb-card-tags">
            {visibleTags.map((tag) => {
              const c = colorForTag(tag);
              return (
                <span
                  key={tag}
                  className="mb-card-tag"
                  style={{ background: c.bg, borderColor: c.border, color: c.fg }}
                >
                  #{tag}
                </span>
              );
            })}
            {extraTagCount > 0 && (
              <span className="mb-card-tag mb-card-tag-more">+{extraTagCount}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
