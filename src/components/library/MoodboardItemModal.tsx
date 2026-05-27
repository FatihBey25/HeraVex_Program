import { useEffect, useMemo, useRef, useState } from "react";
import { X, Trash2, Save, Link2, FileText, ListTodo, Plus } from "lucide-react";
import type { GameRecord, MoodboardCategory, MoodboardItem, NoteRecord, TaskItem } from "../../types";
import { imgSrc } from "../../lib/images";
import { colorForTag } from "../../lib/tagColor";
import { useAppStore } from "../../store";
import { getAllNotes } from "../../lib/storage";

const DESC_MAX = 280;

interface Props {
  game: GameRecord;
  item: MoodboardItem;
  focusTitle?: boolean;
  uncategorizedLabel: string;
  /** Localised labels (caller passes ui.* strings). */
  labels: {
    title: string;
    description: string;
    tags: string;
    tagsPlaceholder: string;
    category: string;
    dimensions: string;
    size: string;
    added: string;
    unknown: string;
    linkedTasks: string;
    linkedNotes: string;
    linkToTask: string;
    linkToNote: string;
    pickTask: string;
    pickNote: string;
    noTasksToLink: string;
    noNotesToLink: string;
    save: string;
    saved: string;
    delete: string;
    close: string;
    descriptionCharCount: (n: number, max: number) => string;
  };
  onClose: () => void;
  onDelete: () => void;
}

function formatBytes(n?: number): string | null {
  if (!n || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Parse a comma/space separated tag string into a deduped lowercase
 *  array. Strips leading "#" so users can paste `#low-poly` and we
 *  still store the canonical `low-poly`. */
function parseTagsInput(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  s.split(/[,\s]+/).forEach((raw) => {
    const t = raw.trim().replace(/^#+/, "").toLowerCase();
    if (!t) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  });
  return out;
}

export function MoodboardItemModal({
  game,
  item,
  focusTitle = false,
  uncategorizedLabel,
  labels,
  onClose,
  onDelete,
}: Props) {
  const {
    updateMoodboardItem,
    moveMoodboardItem,
    linkMoodboardItemToTask,
    unlinkMoodboardItemFromTask,
    linkMoodboardItemToNote,
    unlinkMoodboardItemFromNote,
  } = useAppStore();

  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [tagsInput, setTagsInput] = useState(item.tags.join(", "));
  const [savedAt, setSavedAt] = useState<number>(0);
  const [allNotes, setAllNotes] = useState<NoteRecord[]>([]);
  const [pickerOpen, setPickerOpen] = useState<"task" | "note" | "">("");

  const titleRef = useRef<HTMLInputElement | null>(null);

  // Failsafe dimension fill — modal lazy-measures images that landed
  // without width/height (legacy migrations, etc.). Writes back via
  // `updateMoodboardItem` so the next render shows the captured size.
  useEffect(() => {
    if (item.width && item.height) return;
    const img = new Image();
    img.onload = () => {
      void updateMoodboardItem(game.id, item.id, {
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    const src = imgSrc(item.path);
    if (!src) return;
    img.src = src;
  }, [item.id, item.path, item.width, item.height, game.id, updateMoodboardItem]);

  useEffect(() => {
    if (focusTitle) {
      // Defer to the next frame so the input is mounted.
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [focusTitle]);

  useEffect(() => {
    void (async () => {
      try {
        const list = await getAllNotes();
        setAllNotes(list);
      } catch {
        // ignore — picker shows the empty-state label
      }
    })();
  }, []);

  // Sync local edit state when the underlying item changes (e.g. a
  // link cascade refreshed the game while the modal is open).
  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description);
    setTagsInput(item.tags.join(", "));
  }, [item.title, item.description, item.tags]);

  const linkedTasks: TaskItem[] = useMemo(
    () =>
      item.linkedTaskIds
        .map((id) => game.tasks.find((t) => t.id === id))
        .filter((t): t is TaskItem => !!t),
    [item.linkedTaskIds, game.tasks],
  );
  const linkedNotes: NoteRecord[] = useMemo(
    () =>
      item.linkedNoteIds
        .map((id) => allNotes.find((n) => n.id === id))
        .filter((n): n is NoteRecord => !!n),
    [item.linkedNoteIds, allNotes],
  );

  const unlinkedTasks = useMemo(
    () => game.tasks.filter((t) => !item.linkedTaskIds.includes(t.id)),
    [game.tasks, item.linkedTaskIds],
  );
  const unlinkedNotes = useMemo(
    () => allNotes.filter((n) => !item.linkedNoteIds.includes(n.id)),
    [allNotes, item.linkedNoteIds],
  );

  const handleSave = async () => {
    const cleanedDesc = description.slice(0, DESC_MAX);
    const tags = parseTagsInput(tagsInput);
    await updateMoodboardItem(game.id, item.id, {
      title: title.trim(),
      description: cleanedDesc,
      tags,
    });
    setSavedAt(Date.now());
  };

  const handleCategoryChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    await moveMoodboardItem(game.id, item.id, val === "" ? null : val);
  };

  const handleLinkTask = async (taskId: string) => {
    await linkMoodboardItemToTask(game.id, item.id, taskId);
    setPickerOpen("");
  };
  const handleUnlinkTask = async (taskId: string) => {
    await unlinkMoodboardItemFromTask(game.id, item.id, taskId);
  };
  const handleLinkNote = async (noteId: string) => {
    await linkMoodboardItemToNote(game.id, item.id, noteId);
    setPickerOpen("");
  };
  const handleUnlinkNote = async (noteId: string) => {
    await unlinkMoodboardItemFromNote(game.id, item.id, noteId);
  };

  const visibleTags = parseTagsInput(tagsInput);

  const dimensionStr =
    item.width && item.height ? `${item.width} × ${item.height}` : labels.unknown;
  const sizeStr = formatBytes(item.sizeBytes) ?? labels.unknown;
  const addedStr = new Date(item.createdAt).toLocaleDateString();

  const sortedCategories = [...game.moodboard.categories].sort(
    (a, b) => a.order - b.order,
  );

  return (
    <div
      className="mb-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="mb-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className="mb-modal-close"
          onClick={onClose}
          aria-label={labels.close}
        >
          <X size={16} />
        </button>

        <div className="mb-modal-media">
          <img src={imgSrc(item.path)} alt={item.title || item.filename} />
        </div>

        <div className="mb-modal-side">
          <label className="mb-modal-field">
            <span className="mb-modal-field-label">{labels.title}</span>
            <input
              ref={titleRef}
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
          </label>

          <label className="mb-modal-field">
            <span className="mb-modal-field-label">
              {labels.description}
              <span className="mb-modal-field-counter">
                {labels.descriptionCharCount(description.length, DESC_MAX)}
              </span>
            </span>
            <textarea
              className="input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
            />
          </label>

          <label className="mb-modal-field">
            <span className="mb-modal-field-label">{labels.tags}</span>
            <input
              className="input"
              value={tagsInput}
              placeholder={labels.tagsPlaceholder}
              onChange={(e) => setTagsInput(e.target.value)}
            />
            {visibleTags.length > 0 && (
              <div className="mb-modal-tags-preview">
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
              </div>
            )}
          </label>

          <label className="mb-modal-field">
            <span className="mb-modal-field-label">{labels.category}</span>
            <select
              className="input"
              value={item.categoryId ?? ""}
              onChange={handleCategoryChange}
            >
              <option value="">{uncategorizedLabel}</option>
              {sortedCategories.map((c: MoodboardCategory) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="mb-modal-meta">
            <div>
              <span className="mb-modal-meta-label">{labels.dimensions}</span>
              <span className="mb-modal-meta-value">{dimensionStr}</span>
            </div>
            <div>
              <span className="mb-modal-meta-label">{labels.size}</span>
              <span className="mb-modal-meta-value">{sizeStr}</span>
            </div>
            <div>
              <span className="mb-modal-meta-label">{labels.added}</span>
              <span className="mb-modal-meta-value">{addedStr}</span>
            </div>
          </div>

          {/* Linked tasks */}
          <div className="mb-modal-links">
            <div className="mb-modal-links-head">
              <span>
                <ListTodo size={12} /> {labels.linkedTasks} ({linkedTasks.length})
              </span>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => setPickerOpen(pickerOpen === "task" ? "" : "task")}
              >
                <Plus size={12} /> {labels.linkToTask}
              </button>
            </div>
            {linkedTasks.map((t) => (
              <div key={t.id} className="mb-modal-link-chip">
                <span className="mb-modal-link-chip-label">{t.title}</span>
                <button
                  type="button"
                  onClick={() => void handleUnlinkTask(t.id)}
                  aria-label={labels.delete}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {pickerOpen === "task" && (
              <div className="mb-modal-picker">
                {unlinkedTasks.length === 0 ? (
                  <div className="mb-modal-picker-empty">{labels.noTasksToLink}</div>
                ) : (
                  unlinkedTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="mb-modal-picker-item"
                      onClick={() => void handleLinkTask(t.id)}
                    >
                      <Link2 size={11} /> {t.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Linked notes */}
          <div className="mb-modal-links">
            <div className="mb-modal-links-head">
              <span>
                <FileText size={12} /> {labels.linkedNotes} ({linkedNotes.length})
              </span>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => setPickerOpen(pickerOpen === "note" ? "" : "note")}
              >
                <Plus size={12} /> {labels.linkToNote}
              </button>
            </div>
            {linkedNotes.map((n) => (
              <div key={n.id} className="mb-modal-link-chip">
                <span className="mb-modal-link-chip-label">{n.title}</span>
                <button
                  type="button"
                  onClick={() => void handleUnlinkNote(n.id)}
                  aria-label={labels.delete}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {pickerOpen === "note" && (
              <div className="mb-modal-picker">
                {unlinkedNotes.length === 0 ? (
                  <div className="mb-modal-picker-empty">{labels.noNotesToLink}</div>
                ) : (
                  unlinkedNotes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className="mb-modal-picker-item"
                      onClick={() => void handleLinkNote(n.id)}
                    >
                      <Link2 size={11} /> {n.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="mb-modal-footer">
            <button
              type="button"
              className="danger-button secondary-button"
              onClick={onDelete}
            >
              <Trash2 size={13} style={{ marginRight: 6 }} />
              {labels.delete}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleSave()}
            >
              <Save size={13} style={{ marginRight: 6 }} />
              {savedAt && Date.now() - savedAt < 2500 ? labels.saved : labels.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
