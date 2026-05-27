import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { OpenMoodboardItemDetail } from "../../../lib/moodboardNavigate";
import { Filter, Search, X } from "lucide-react";
import { useAppStore } from "../../../store";
import { saveImageToDisk, fileToBase64 } from "../../../lib/images";
import { ConfirmDialog } from "../../shared/ConfirmDialog";
import { colorForTag } from "../../../lib/tagColor";
import type { MoodboardItem } from "../../../types";
import {
  MoodboardCategoryTabs,
  VIRTUAL_ALL_ID,
  VIRTUAL_UNCATEGORIZED_ID,
} from "../MoodboardCategoryTabs";
import { MoodboardItemCard } from "../MoodboardItemCard";
import { MoodboardItemModal } from "../MoodboardItemModal";

// Backwards-compat: this tab keeps its old name and prop shape so the
// surrounding GameDetail wiring does not change. The whole component
// is the v0.8 refactor target — categories, tags, bidirectional links.
export function MoodboardTab({ gameId }: { gameId: string }) {
  const {
    games,
    addMoodboardItems,
    deleteMoodboardItem,
    addMoodboardCategory,
    renameMoodboardCategory,
    deleteMoodboardCategory,
    reorderMoodboardCategories,
    showError,
    language,
    ui,
  } = useAppStore();
  const game = games.find((g) => g.id === gameId);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [activeCategoryId, setActiveCategoryId] = useState<string>(VIRTUAL_ALL_ID);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [detailItemId, setDetailItemId] = useState<string>("");
  const [detailFocusTitle, setDetailFocusTitle] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>("");
  /** When non-empty, the staged files are waiting on the user to pick
   *  a target category (Uncategorized by default). Cleared once they
   *  confirm or cancel. */
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  // Cross-tab navigation: a thumbnail click on a task card or note
  // list item dispatches `heravex:open-moodboard-item` after the
  // workspace+selectedId hops. We pick that up here and open the
  // matching item's detail modal, then it's the modal's job from
  // there. Filtered by gameId so siblings don't fire each other.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<OpenMoodboardItemDetail>).detail;
      if (!detail || !game) return;
      if (detail.gameId !== game.id) return;
      // Verify the item still exists (could have been deleted between
      // dispatch and arrival during a cascade).
      const exists = game.moodboard.items.some((m) => m.id === detail.itemId);
      if (!exists) return;
      setDetailItemId(detail.itemId);
      setDetailFocusTitle(false);
    };
    window.addEventListener("heravex:open-moodboard-item", handler);
    return () => window.removeEventListener("heravex:open-moodboard-item", handler);
  }, [game?.id, game?.moodboard.items]);

  if (!game) return null;

  // All copy strings now live in i18n.ts (`mb*` keys). Each language's
  // moodboard block holds the exact same set — type system enforces
  // that via the `copy.en` schema.
  const allLabel = ui.mbAll;
  const uncategorizedLabel = ui.mbUncategorized;
  const addCategoryLabel = ui.mbAddCategory;
  const renameLabel = ui.mbRename;
  const deleteLabel = ui.mbDelete;
  const editLabel = ui.mbEdit;
  const menuLabel = ui.mbMore;
  const tagFilterLabel = ui.mbTagFilter;
  const clearFiltersLabel = ui.mbClearFilters;
  const searchPlaceholder = ui.mbSearchPlaceholder;
  const linkedCountLabel = ui.mbLinkedCount;
  const emptyCategoryLabel = ui.mbEmptyCategory;
  const pickCategoryTitle = ui.mbPickCategoryTitle;
  const pickCategoryBody = ui.mbPickCategoryBody;
  const cancelLabel = ui.mbCancel;
  const confirmLabel = ui.mbAdd;

  const items = game.moodboard.items;
  const categories = game.moodboard.categories;

  // ── Aggregations ─────────────────────────────────────────────────────────
  const countByCategoryId = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((it) => {
      const key = it.categoryId ?? "";
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [items]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => it.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [items]);

  // ── Filtering ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = items;
    if (activeCategoryId === VIRTUAL_UNCATEGORIZED_ID) {
      list = list.filter((it) => !it.categoryId);
    } else if (activeCategoryId !== VIRTUAL_ALL_ID) {
      list = list.filter((it) => it.categoryId === activeCategoryId);
    }
    if (activeTags.length > 0) {
      // OR semantics: an item passes if it has at least one selected tag.
      list = list.filter((it) =>
        activeTags.some((tag) => it.tags.includes(tag)),
      );
    }
    const q = searchQuery.trim().toLocaleLowerCase(language);
    if (q) {
      list = list.filter((it) => {
        const hay = [it.title, it.description, it.filename, it.tags.join(" ")]
          .join(" ")
          .toLocaleLowerCase(language);
        return hay.includes(q);
      });
    }
    return list;
  }, [items, activeCategoryId, activeTags, searchQuery, language]);

  const detailItem = detailItemId
    ? items.find((it) => it.id === detailItemId) ?? null
    : null;

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleFilesPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    // Stage the files, then ask which category they belong in.
    setPendingFiles(files);
  };

  const commitPendingFiles = async (categoryId: string | null) => {
    if (!pendingFiles) return;
    const files = pendingFiles;
    setPendingFiles(null);
    try {
      const newItems = await Promise.all(
        files.map(async (file): Promise<MoodboardItem> => {
          const base64 = await fileToBase64(file);
          const path = await saveImageToDisk(base64, game.id);
          // Measure on the way in so the card and modal can show
          // dimensions immediately. The lazy modal-time measurement
          // still acts as a failsafe for any item that slips through.
          const dims = await measureImage(base64);
          return {
            id: crypto.randomUUID(),
            filename: file.name,
            path,
            categoryId,
            title: file.name.replace(/\.[^.]+$/, ""),
            description: "",
            tags: [],
            linkedTaskIds: [],
            linkedNoteIds: [],
            createdAt: new Date().toISOString(),
            width: dims?.width,
            height: dims?.height,
            sizeBytes: file.size,
          };
        }),
      );
      await addMoodboardItems(game.id, newItems);
    } catch (err) {
      showError(err);
    }
  };

  const handleCategoryDelete = (catId: string) => {
    // No confirm modal — the items survive (move to Uncategorized).
    // This keeps the gesture cheap and reversible (recreate the
    // category, drag items back). If we ever start hard-deleting
    // items along with their category, add a confirm prompt here.
    void deleteMoodboardCategory(game.id, catId);
    if (activeCategoryId === catId) setActiveCategoryId(VIRTUAL_ALL_ID);
  };

  const toggleTag = (tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    );
  };

  const clearFilters = () => {
    setActiveTags([]);
    setSearchQuery("");
  };

  const onOpenDetail = (id: string) => {
    setDetailItemId(id);
    setDetailFocusTitle(false);
  };
  const onQuickEdit = (id: string) => {
    setDetailItemId(id);
    setDetailFocusTitle(true);
  };
  // Item card's "..." menu currently maps directly to the detail
  // modal — the modal already houses link controls. A dedicated
  // popover would speed up the common case but adds positioning
  // logic; revisit if usage data shows the modal is too heavy.
  const onOpenMenu = (id: string) => {
    setDetailItemId(id);
    setDetailFocusTitle(false);
  };

  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);

  return (
    <div key="moodboard" className="tab-panel tab-content mb-tab">
      <div className="panel-head">
        <div>
          <span className="label">{ui.moodboard}</span>
          <p className="helper-copy">{ui.moodboardHint}</p>
        </div>
        <button className="primary-button" onClick={() => inputRef.current?.click()}>
          {ui.addReference}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleFilesPicked}
      />

      {/* Category tab strip */}
      <MoodboardCategoryTabs
        categories={categories}
        activeId={activeCategoryId}
        countByCategoryId={countByCategoryId}
        totalItems={items.length}
        uncategorizedLabel={uncategorizedLabel}
        allLabel={allLabel}
        addLabel={addCategoryLabel}
        renameLabel={renameLabel}
        deleteLabel={deleteLabel}
        onSelect={setActiveCategoryId}
        onAdd={async (name) => {
          const created = await addMoodboardCategory(game.id, name);
          if (created) setActiveCategoryId(created.id);
        }}
        onRename={async (id, name) => {
          await renameMoodboardCategory(game.id, id, name);
        }}
        onDelete={handleCategoryDelete}
        onReorder={async (orderedIds) => {
          await reorderMoodboardCategories(game.id, orderedIds);
        }}
      />

      {/* Tag filter + search row */}
      <div className="mb-toolbar">
        <div className="mb-search">
          <Search size={13} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </div>
        {allTags.length > 0 && (
          <div className="mb-tag-filter">
            <span className="mb-tag-filter-label">
              <Filter size={11} /> {tagFilterLabel}
            </span>
            {allTags.map((tag) => {
              const c = colorForTag(tag);
              const isOn = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`mb-card-tag ${isOn ? "is-active" : ""}`}
                  style={{
                    background: isOn ? c.bg : "transparent",
                    borderColor: c.border,
                    color: c.fg,
                  }}
                  onClick={() => toggleTag(tag)}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        )}
        {(activeTags.length > 0 || searchQuery) && (
          <button
            type="button"
            className="mb-clear-filters"
            onClick={clearFilters}
            title={clearFiltersLabel}
          >
            <X size={11} /> {clearFiltersLabel}
          </button>
        )}
      </div>

      {/* Grid or empty state */}
      {filtered.length === 0 ? (
        <div className="empty-inline-state mb-empty">
          {items.length === 0 ? ui.moodboardEmpty : emptyCategoryLabel}
        </div>
      ) : (
        <div className="mb-grid">
          {filtered.map((item) => (
            <MoodboardItemCard
              key={item.id}
              item={item}
              onOpen={onOpenDetail}
              onQuickEdit={onQuickEdit}
              onOpenMenu={onOpenMenu}
              onDelete={(id) => setConfirmDeleteId(id)}
              linkedCountLabel={linkedCountLabel}
              editLabel={editLabel}
              menuLabel={menuLabel}
              deleteLabel={deleteLabel}
            />
          ))}
        </div>
      )}

      {/* Bulk-add category picker */}
      {pendingFiles && (
        <div
          className="mb-modal-backdrop"
          onClick={() => setPendingFiles(null)}
          role="presentation"
        >
          <div
            className="mb-picker-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3>{pickCategoryTitle}</h3>
            <p className="helper-copy">{pickCategoryBody}</p>
            <div className="mb-picker-options">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void commitPendingFiles(
                    activeCategoryId === VIRTUAL_ALL_ID ||
                      activeCategoryId === VIRTUAL_UNCATEGORIZED_ID
                      ? null
                      : activeCategoryId,
                  )
                }
              >
                {confirmLabel} →{" "}
                {activeCategoryId === VIRTUAL_ALL_ID ||
                activeCategoryId === VIRTUAL_UNCATEGORIZED_ID
                  ? uncategorizedLabel
                  : sortedCategories.find((c) => c.id === activeCategoryId)?.name ??
                    uncategorizedLabel}
              </button>
              {sortedCategories
                .filter((c) => c.id !== activeCategoryId)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="secondary-button"
                    onClick={() => void commitPendingFiles(c.id)}
                  >
                    {confirmLabel} → {c.name}
                  </button>
                ))}
              {activeCategoryId !== VIRTUAL_UNCATEGORIZED_ID &&
                activeCategoryId !== VIRTUAL_ALL_ID && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void commitPendingFiles(null)}
                  >
                    {confirmLabel} → {uncategorizedLabel}
                  </button>
                )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPendingFiles(null)}
              >
                {cancelLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailItem && (
        <MoodboardItemModal
          game={game}
          item={detailItem}
          focusTitle={detailFocusTitle}
          uncategorizedLabel={uncategorizedLabel}
          labels={{
            title: ui.mbModalTitle,
            description: ui.mbModalDescription,
            tags: ui.mbModalTags,
            tagsPlaceholder: ui.mbTagsPlaceholder,
            category: ui.mbModalCategory,
            dimensions: ui.mbModalDimensions,
            size: ui.mbModalSize,
            added: ui.mbModalAdded,
            unknown: "—",
            linkedTasks: ui.mbLinkedTasks,
            linkedNotes: ui.mbLinkedNotes,
            linkToTask: ui.mbLinkToTask,
            linkToNote: ui.mbLinkToNote,
            pickTask: ui.mbLinkToTask,
            pickNote: ui.mbLinkToNote,
            noTasksToLink: ui.mbNoTasksToLink,
            noNotesToLink: ui.mbNoNotesToLink,
            save: ui.mbSave,
            saved: ui.mbSaved,
            delete: deleteLabel,
            close: ui.mbClose,
            descriptionCharCount: (n, max) => `${n}/${max}`,
          }}
          onClose={() => setDetailItemId("")}
          onDelete={() => {
            setConfirmDeleteId(detailItem.id);
          }}
        />
      )}

      {confirmDeleteId && (() => {
        const it = items.find((m) => m.id === confirmDeleteId);
        const label = it?.title || it?.filename || String(ui.moodboard);
        return (
          <ConfirmDialog
            title={ui.mbDeleteImageTitle}
            body={ui.mbDeleteImageBody(label)}
            confirmLabel={ui.mbDelete}
            cancelLabel={ui.mbCancel}
            variant="danger"
            onConfirm={() => {
              void deleteMoodboardItem(game.id, confirmDeleteId);
              setConfirmDeleteId("");
              setDetailItemId("");
            }}
            onCancel={() => setConfirmDeleteId("")}
          />
        );
      })()}
    </div>
  );
}

/** Measure an image from a base64 data URL. Resolves with `null` if
 *  the browser can't decode it (e.g. unsupported format). Used at
 *  add-time so the new item lands with width/height already filled. */
function measureImage(base64: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = base64;
  });
}
