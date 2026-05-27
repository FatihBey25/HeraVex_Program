import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, Check, Pencil } from "lucide-react";
import type { MoodboardCategory } from "../../types";

/** Virtual tab id for "show items across every category". The store
 *  never persists this — it's a UI affordance only. */
export const VIRTUAL_ALL_ID = "__all__";
/** Virtual tab id for items with `categoryId == null`. */
export const VIRTUAL_UNCATEGORIZED_ID = "__uncategorized__";

interface Props {
  categories: MoodboardCategory[];
  /** Active tab id. Either a real category id, `VIRTUAL_ALL_ID`, or
   *  `VIRTUAL_UNCATEGORIZED_ID`. */
  activeId: string;
  /** Count of items per real category id, plus a magic "" key for
   *  uncategorized count. Used to hide Uncategorized when empty. */
  countByCategoryId: Record<string, number>;
  totalItems: number;
  uncategorizedLabel: string;
  allLabel: string;
  addLabel: string;
  renameLabel: string;
  deleteLabel: string;
  onSelect: (id: string) => void;
  onAdd: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => Promise<void>;
}

/** Read [data-cat-id] from elementFromPoint(x, y) or any ancestor. */
function catIdFromPoint(x: number, y: number): string {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const catEl = el?.closest("[data-cat-id]") as HTMLElement | null;
  return catEl?.dataset.catId ?? "";
}

export function MoodboardCategoryTabs({
  categories,
  activeId,
  countByCategoryId,
  totalItems,
  uncategorizedLabel,
  allLabel,
  addLabel,
  renameLabel,
  deleteLabel,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onReorder,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string>("");
  const [renameDraft, setRenameDraft] = useState("");

  // Drag-reorder state — mirrors the Kanban column-drag pattern but
  // simplified because we only care about a single ordered list.
  const [draggingId, setDraggingId] = useState<string>("");
  const [dropTargetId, setDropTargetId] = useState<string>("");

  const draggingIdRef = useRef<string>("");
  const dropTargetIdRef = useRef<string>("");
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  const cleanupDrag = useCallback(() => {
    setDraggingId("");
    setDropTargetId("");
    draggingIdRef.current = "";
    dropTargetIdRef.current = "";
    document.body.style.cursor = "";
  }, []);

  const onTabMouseDown = useCallback(
    (catId: string) => (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Only real categories drag — virtual tabs are pinned.
      if (catId === VIRTUAL_ALL_ID || catId === VIRTUAL_UNCATEGORIZED_ID) return;
      const startX = e.clientX;
      const startY = e.clientY;

      let actuallyDragging = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!actuallyDragging) {
          // Treat as a drag only after a small threshold so plain
          // clicks (select) still work.
          if (Math.hypot(dx, dy) < 6) return;
          actuallyDragging = true;
          draggingIdRef.current = catId;
          setDraggingId(catId);
          document.body.style.cursor = "grabbing";
        }
        const target = catIdFromPoint(ev.clientX, ev.clientY);
        // Targets that are virtual or self are ignored.
        const valid =
          target &&
          target !== catId &&
          target !== VIRTUAL_ALL_ID &&
          target !== VIRTUAL_UNCATEGORIZED_ID;
        const next = valid ? target : "";
        if (next !== dropTargetIdRef.current) {
          dropTargetIdRef.current = next;
          setDropTargetId(next);
        }
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const moved = draggingIdRef.current;
        const target = dropTargetIdRef.current;
        cleanupDrag();
        if (!actuallyDragging || !moved || !target) return;

        // Compute new order: take current list, drop `moved` out, then
        // insert just before `target`.
        const current = categoriesRef.current
          .slice()
          .sort((a, b) => a.order - b.order);
        const ordered = current.filter((c) => c.id !== moved).map((c) => c.id);
        const idx = ordered.indexOf(target);
        if (idx < 0) return;
        ordered.splice(idx, 0, moved);
        void onReorder(ordered);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [cleanupDrag, onReorder],
  );

  useEffect(() => () => cleanupDrag(), [cleanupDrag]);

  const submitAdd = async () => {
    const name = addDraft.trim();
    if (!name) {
      setAdding(false);
      setAddDraft("");
      return;
    }
    await onAdd(name);
    setAdding(false);
    setAddDraft("");
  };

  const submitRename = async (id: string) => {
    const name = renameDraft.trim();
    if (!name) {
      setRenamingId("");
      setRenameDraft("");
      return;
    }
    await onRename(id, name);
    setRenamingId("");
    setRenameDraft("");
  };

  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  const uncategorizedCount = countByCategoryId[""] ?? 0;

  return (
    <div className="mb-cat-tabs">
      {/* Virtual: Tümü — pinned first, never draggable */}
      <button
        data-cat-id={VIRTUAL_ALL_ID}
        className={`mb-cat-tab ${activeId === VIRTUAL_ALL_ID ? "is-active" : ""}`}
        onClick={() => onSelect(VIRTUAL_ALL_ID)}
        type="button"
      >
        <span className="mb-cat-tab-label">{allLabel}</span>
        <span className="mb-cat-tab-count">{totalItems}</span>
      </button>

      {sortedCategories.map((cat) => {
        const count = countByCategoryId[cat.id] ?? 0;
        const isActive = activeId === cat.id;
        const isDragging = draggingId === cat.id;
        const isDropTarget = dropTargetId === cat.id;
        const isRenaming = renamingId === cat.id;
        return (
          <div
            key={cat.id}
            data-cat-id={cat.id}
            className={[
              "mb-cat-tab",
              isActive ? "is-active" : "",
              isDragging ? "is-dragging" : "",
              isDropTarget ? "is-drop-target" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseDown={isRenaming ? undefined : onTabMouseDown(cat.id)}
            onClick={(e) => {
              // Ignore clicks that came after a real drag motion.
              if (draggingId) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              if (!isRenaming) onSelect(cat.id);
            }}
          >
            {isRenaming ? (
              <>
                <input
                  className="mb-cat-tab-input"
                  value={renameDraft}
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitRename(cat.id);
                    else if (e.key === "Escape") {
                      setRenamingId("");
                      setRenameDraft("");
                    }
                  }}
                  onBlur={() => void submitRename(cat.id)}
                />
                <button
                  type="button"
                  className="mb-cat-tab-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    void submitRename(cat.id);
                  }}
                  aria-label={renameLabel}
                >
                  <Check size={12} />
                </button>
              </>
            ) : (
              <>
                <span className="mb-cat-tab-label">{cat.name}</span>
                <span className="mb-cat-tab-count">{count}</span>
                {isActive && (
                  <span className="mb-cat-tab-actions">
                    <button
                      type="button"
                      className="mb-cat-tab-icon"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(cat.id);
                        setRenameDraft(cat.name);
                      }}
                      title={renameLabel}
                      aria-label={renameLabel}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      className="mb-cat-tab-icon"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(cat.id);
                      }}
                      title={deleteLabel}
                      aria-label={deleteLabel}
                    >
                      <X size={11} />
                    </button>
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Virtual: Uncategorized — only shown when at least one item lives there */}
      {uncategorizedCount > 0 && (
        <button
          data-cat-id={VIRTUAL_UNCATEGORIZED_ID}
          className={`mb-cat-tab mb-cat-tab-uncategorized ${activeId === VIRTUAL_UNCATEGORIZED_ID ? "is-active" : ""}`}
          onClick={() => onSelect(VIRTUAL_UNCATEGORIZED_ID)}
          type="button"
        >
          <span className="mb-cat-tab-label">{uncategorizedLabel}</span>
          <span className="mb-cat-tab-count">{uncategorizedCount}</span>
        </button>
      )}

      {adding ? (
        <div className="mb-cat-tab mb-cat-tab-adding">
          <input
            className="mb-cat-tab-input"
            value={addDraft}
            autoFocus
            placeholder={addLabel}
            onChange={(e) => setAddDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitAdd();
              else if (e.key === "Escape") {
                setAdding(false);
                setAddDraft("");
              }
            }}
            onBlur={() => void submitAdd()}
          />
        </div>
      ) : (
        <button
          type="button"
          className="mb-cat-tab mb-cat-tab-add"
          onClick={() => setAdding(true)}
          title={addLabel}
          aria-label={addLabel}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
