import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Trash2, NotebookPen, Pencil, BookOpen, FileText, Gamepad2,
} from "lucide-react";
import { useAppStore } from "../../store";
import {
  getAllNotes, saveNote, exportGlobalNotePdf, exportNotesPdf,
} from "../../lib/storage";
import { MarkdownWorkspace, type SaveStatus, type MarkdownTemplate } from "../shared/MarkdownWorkspace";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { useListKeyNav } from "../../lib/useListKeyNav";
import { isGeneralGame } from "../../lib/general-game";
import { MoodboardThumbStrip } from "../library/MoodboardThumbStrip";
import { getGameTemplates, getGlobalTemplates } from "../../lib/noteTemplates";
import type { GameRecord, NoteRecord } from "../../types";

const ts = () => new Date().toISOString();

// ── Smart title derivation ────────────────────────────────────────────────
// When a note is still using the default "Untitled note" / "Adsız not"
// label, derive a display title from the first non-empty line of content.
// User-renamed titles always win.
const DEFAULT_TITLES = new Set(["Untitled note", "Adsız not", "Adsiz not"]);
function deriveDisplayTitle(rawTitle: string, content: string): string {
  if (!DEFAULT_TITLES.has(rawTitle)) return rawTitle;
  const first = (content ?? "")
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/^>\s*/, "").trim())
    .find((l) => l.length > 0);
  if (!first) return rawTitle;
  return first.length > 30 ? first.slice(0, 30) + "…" : first;
}

// ── Selection model ────────────────────────────────────────────────────────

type ActiveSelection =
  | { kind: "global"; noteId: string }
  | { kind: "project"; gameId: string }
  | null;

const activeKey = (sel: ActiveSelection): string =>
  sel ? `${sel.kind}:${sel.kind === "global" ? sel.noteId : sel.gameId}` : "empty";

// ── Component ──────────────────────────────────────────────────────────────

export function NoteCenter() {
  const { games: allGames, language, ui, showToast, showError, handleSaveGame, removeNote, reorderNotes } = useAppStore();
  // Internal marker game (general tasks container) isn't a project — keep it
  // out of the Notes browser's PROJECTS list.
  const games = useMemo(() => allGames.filter((g) => !isGeneralGame(g)), [allGames]);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [selection, setSelection] = useState<ActiveSelection>(null);
  const [draft, setDraft] = useState<string>("");
  const [draftTitle, setDraftTitle] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [renamingId, setRenamingId] = useState<string>("");
  const [renameValue, setRenameValue] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // v0.9 — drag-to-reorder state for the studio notes list. Mirrors
  // the Kanban column-drag pattern: we only track which item the
  // cursor is currently hovering as the next "drop target", then on
  // mouseup splice the dragged id into that slot. No HTML5 drag API
  // (it conflicts with the existing rename-on-double-click handler).
  const [draggingNoteId, setDraggingNoteId] = useState<string>("");
  const [dropTargetNoteId, setDropTargetNoteId] = useState<string>("");
  const draggingNoteIdRef = useRef<string>("");
  const dropTargetNoteIdRef = useRef<string>("");

  // Sorted, drag-aware view of the notes list. Notes are sorted by
  // their persisted `order` ascending, with `updatedAt desc` as the
  // tie-breaker so pre-v0.9 records (all `order=0`) still render
  // most-recent first until the user reorders them.
  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => {
      const ao = a.order ?? 0;
      const bo = b.order ?? 0;
      if (ao !== bo) return ao - bo;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [notes]);
  const sortedNotesRef = useRef(sortedNotes);
  sortedNotesRef.current = sortedNotes;

  /** Lookup the note id of whatever sidebar row sits under `(x, y)`,
   *  using a `data-note-id` attribute we render on each `<li>`. Same
   *  trick the Kanban board uses for column drops. */
  const noteIdFromPoint = useCallback((x: number, y: number): string => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const row = el?.closest("[data-note-id]") as HTMLElement | null;
    return row?.dataset.noteId ?? "";
  }, []);

  const onNoteRowMouseDown = useCallback(
    (noteId: string) => (e: React.MouseEvent) => {
      // Left click only. Skip when the click landed on an actionable
      // child (rename input, delete button) so existing UX paths
      // still work.
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, button, a")) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let dragStarted = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragStarted) {
          // 6px threshold lets plain clicks select-without-drag.
          if (Math.hypot(dx, dy) < 6) return;
          dragStarted = true;
          draggingNoteIdRef.current = noteId;
          setDraggingNoteId(noteId);
          document.body.style.cursor = "grabbing";
        }
        const target = noteIdFromPoint(ev.clientX, ev.clientY);
        const next = target && target !== noteId ? target : "";
        if (next !== dropTargetNoteIdRef.current) {
          dropTargetNoteIdRef.current = next;
          setDropTargetNoteId(next);
        }
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        const moved = draggingNoteIdRef.current;
        const target = dropTargetNoteIdRef.current;
        draggingNoteIdRef.current = "";
        dropTargetNoteIdRef.current = "";
        setDraggingNoteId("");
        setDropTargetNoteId("");
        if (!dragStarted || !moved || !target) return;

        // Recompute the order: pull `moved` out, insert before `target`.
        const ids = sortedNotesRef.current.map((n) => n.id);
        const fromIdx = ids.indexOf(moved);
        const toIdx = ids.indexOf(target);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        ids.splice(fromIdx, 1);
        // After removal, the original `toIdx` may have shifted if the
        // moved item was above it — recompute on the fresh list.
        const newToIdx = ids.indexOf(target);
        ids.splice(newToIdx, 0, moved);

        // Optimistic local sort by writing matching `order` values
        // to the in-memory state; the store persists asynchronously.
        setNotes((prev) =>
          prev.map((n) => {
            const idx = ids.indexOf(n.id);
            return idx >= 0 ? { ...n, order: idx } : n;
          }),
        );
        void reorderNotes(ids);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [noteIdFromPoint, reorderNotes],
  );

  // ── Resizable sidebar ────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("noteSidebarWidth");
      const n = saved ? parseInt(saved, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : 320;
    } catch {
      return 320;
    }
  });
  useEffect(() => {
    try { localStorage.setItem("noteSidebarWidth", String(sidebarWidth)); } catch {}
  }, [sidebarWidth]);

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const onResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: sidebarWidthRef.current };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const minW = 220;
      const maxW = Math.max(minW + 40, Math.floor(window.innerWidth * 0.5));
      const next = Math.min(maxW, Math.max(minW, dragRef.current.startW + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.classList.remove("is-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // ── Initial load ─────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const list = await getAllNotes();
        setNotes(list);
        if (list.length > 0) {
          setSelection({ kind: "global", noteId: list[0].id });
        } else if (games[0]?.id) {
          // Optional chaining defends against race conditions where the
          // store's `games` slice may be momentarily empty between hydrate
          // and refreshGames.
          setSelection({ kind: "project", gameId: games[0].id });
        }
      } catch (err) {
        showError(err);
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  // ── External-update listener ─────────────────────────────────────────
  // The store fires `heravex:notes-updated` after a moodboard link
  // cascade saves a note. NoteCenter holds the notes list in local
  // state (not the global store), so we refetch to keep `moodboardImageIds`
  // and any other backend-touched fields current. Cheap because notes
  // are atomic per file and the workspace rarely holds thousands.
  useEffect(() => {
    const handler = () => {
      void (async () => {
        try {
          const list = await getAllNotes();
          setNotes(list);
        } catch {
          // Silently ignore — next initial load or user action will retry.
        }
      })();
    };
    window.addEventListener("heravex:notes-updated", handler);
    return () => window.removeEventListener("heravex:notes-updated", handler);
  }, []);

  // ── Vim-style j/k navigation on the global notes list ───────────────
  // Operates on the flat ordered ids; press Enter (or 'o') to focus
  // the editor view, 'x' / Delete to prompt the existing remove flow.
  // The hook ignores inputs so typing in the title bar / markdown
  // editor is unaffected.
  const noteIds = useMemo(() => notes.map((n) => n.id), [notes]);
  const currentNoteId = selection?.kind === "global" ? selection.noteId : null;
  useListKeyNav({
    ids: noteIds,
    currentId: currentNoteId,
    setCurrentId: (id) => setSelection({ kind: "global", noteId: id }),
    onDelete: (id) => setConfirmDeleteId(id),
  });

  // ── Resolved active item ─────────────────────────────────────────────
  const activeNote = useMemo<NoteRecord | null>(() => {
    if (selection?.kind !== "global") return null;
    return notes.find((n) => n.id === selection.noteId) ?? null;
  }, [selection, notes]);

  const activeGame = useMemo<GameRecord | null>(() => {
    if (selection?.kind !== "project") return null;
    return games.find((g) => g.id === selection.gameId) ?? null;
  }, [selection, games]);

  const selectionKey = activeKey(selection);

  // ── Sync draft on selection change ──────────────────────────────────
  useEffect(() => {
    if (activeNote) {
      setDraft(activeNote.content);
      setDraftTitle(activeNote.title);
      setSaveStatus("idle");
    } else if (activeGame) {
      setDraft(activeGame.notes ?? "");
      setDraftTitle(activeGame.title);
      setSaveStatus("idle");
    } else {
      setDraft("");
      setDraftTitle("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  // ── Persistence ──────────────────────────────────────────────────────
  const persistGlobal = useCallback(
    async (note: NoteRecord) => {
      setSaveStatus("saving");
      try {
        const saved = await saveNote(note);
        setNotes((prev) => {
          const others = prev.filter((n) => n.id !== saved.id);
          return [saved, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
        setSaveStatus("saved");
      } catch (err) {
        showError(err);
        setSaveStatus("idle");
      }
    },
    [showToast]
  );

  const persistProject = useCallback(
    async (game: GameRecord) => {
      setSaveStatus("saving");
      try {
        await handleSaveGame(game);
        setSaveStatus("saved");
      } catch (err) {
        showError(err);
        setSaveStatus("idle");
      }
    },
    [handleSaveGame, showToast]
  );

  const scheduleSave = (nextContent: string, nextTitle?: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (activeNote) {
      const merged: NoteRecord = {
        ...activeNote,
        content: nextContent,
        title: (nextTitle ?? draftTitle) || activeNote.title,
      };
      debounceRef.current = setTimeout(() => void persistGlobal(merged), 800);
    } else if (activeGame) {
      const merged: GameRecord = { ...activeGame, notes: nextContent };
      debounceRef.current = setTimeout(() => void persistProject(merged), 800);
    }
  };

  // ── Edit handlers ───────────────────────────────────────────────────
  const onContentChange = (value: string) => {
    setDraft(value);
    setSaveStatus("idle");
    scheduleSave(value);
  };

  const onTitleChange = (value: string) => {
    if (!activeNote) return; // project titles are immutable here
    setDraftTitle(value);
    setSaveStatus("idle");
    scheduleSave(draft, value);
  };

  // ── Inline rename in browser ────────────────────────────────────────
  const startRename = (n: NoteRecord) => {
    setRenamingId(n.id);
    setRenameValue(n.title);
  };

  const commitRename = async (n: NoteRecord) => {
    const next = renameValue.trim() || n.title;
    setRenamingId("");
    if (next === n.title) return;
    const isActive = activeNote?.id === n.id;
    await persistGlobal({ ...n, title: next, content: isActive ? draft : n.content });
    if (isActive) setDraftTitle(next);
  };

  // ── New / template / delete / export ────────────────────────────────
  const createNote = async (title?: string, content?: string) => {
    const fresh: NoteRecord = {
      id: "",
      title: title ?? tr("Untitled note", "Adsız not"),
      content: content ?? "",
      updatedAt: ts(),
      category: null,
    };
    try {
      const saved = await saveNote(fresh);
      setNotes((prev) => [saved, ...prev]);
      setSelection({ kind: "global", noteId: saved.id });
      setSaveStatus("saved");
    } catch (err) {
      showError(err);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    const idToRemove = confirmDeleteId;
    setConfirmDeleteId("");
    try {
      // Route through the store so moodboard links to this note get
      // cleaned up too — calling storage.deleteNote directly would
      // leave dangling `linkedNoteIds` entries on moodboard items.
      await removeNote(idToRemove);
      const remaining = notes.filter((n) => n.id !== idToRemove);
      setNotes(remaining);
      if (selection?.kind === "global" && selection.noteId === idToRemove) {
        if (remaining.length > 0) {
          setSelection({ kind: "global", noteId: remaining[0].id });
        } else if (games[0]?.id) {
          // Optional chaining defends against race conditions where the
          // store's `games` slice may be momentarily empty between hydrate
          // and refreshGames.
          setSelection({ kind: "project", gameId: games[0].id });
        } else {
          setSelection(null);
        }
      }
      showToast(tr("Note deleted.", "Not silindi."), "success");
    } catch (err) {
      showError(err);
    }
  };

  const exportPdf = async () => {
    // v0.9.7 PDF rewrite: browser-print path. The legacy Rust pipeline
    // (`exportGlobalNotePdf` / `exportNotesPdf`) rendered through
    // printpdf's BuiltinFont::Helvetica which is Latin-1 only — every
    // Turkish character came out broken — and the markdown renderer
    // didn't understand the HTML the editor stores now. The new path
    // opens a hidden iframe with print-tuned CSS, calls window.print(),
    // and lets the user "Save as PDF" from the OS dialog. UTF-8 just
    // works, and the styling is fully editable in CSS.
    try {
      const { exportNoteAsPdf } = await import("../../lib/notePdfExport");
      if (activeNote) {
        if (draft !== activeNote.content || draftTitle !== activeNote.title) {
          await persistGlobal({ ...activeNote, content: draft, title: draftTitle || activeNote.title });
        }
        await exportNoteAsPdf(draft, {
          title: draftTitle || activeNote.title,
          subtitle: activeNote.category ?? undefined,
          eyebrow: tr("HERAVEX · STUDIO NOTE", "HERAVEX · STÜDYO NOTU"),
          meta: tr("Studio Knowledge Base", "Stüdyo Bilgi Tabanı"),
        }, language);
        showToast(tr("Print dialog opened — choose Save as PDF.", "Yazdırma penceresi açıldı — PDF olarak kaydet seç."), "success");
      } else if (activeGame) {
        if (draft !== (activeGame.notes ?? "")) {
          await persistProject({ ...activeGame, notes: draft });
        }
        await exportNoteAsPdf(draft, {
          title: activeGame.title,
          subtitle: `${tr("Status", "Durum")}: ${activeGame.status}`,
          eyebrow: tr("HERAVEX · GAME DESIGN DOCUMENT", "HERAVEX · GAME DESIGN DOCUMENT"),
          meta: (activeGame.platforms || []).join(" · ") || tr("No platforms set", "Platform yok"),
        }, language);
        showToast(tr("Print dialog opened — choose Save as PDF.", "Yazdırma penceresi açıldı — PDF olarak kaydet seç."), "success");
      }
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showToast(msg, "error");
    }
  };

  // ── Templates for active scope ──────────────────────────────────────
  const editorTemplates: MarkdownTemplate[] = useMemo(() => {
    if (activeGame) {
      return getGameTemplates(language, activeGame.title).map((tpl) => ({
        id: tpl.id, label: tpl.label, build: tpl.build,
      }));
    }
    if (activeNote) {
      return getGlobalTemplates(language).map((tpl) => ({
        id: tpl.id, label: tpl.label, build: tpl.build,
      }));
    }
    return [];
  }, [activeGame, activeNote, language]);

  const isEmpty = loaded && notes.length === 0 && games.length === 0;

  return (
    <motion.div
      className="page-fade note-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div
        className="note-center-layout"
        style={{ gridTemplateColumns: `${sidebarWidth}px 6px 1fr` }}
      >
        {/* ── Left: Unified Note Browser ────────────────────────────── */}
        <aside className="note-browser panel">
          <header className="note-browser-head">
            <div>
              <p className="eyebrow">{tr("NOTEBOOK", "NOTLAR")}</p>
              <h3 style={{ margin: 0 }}>{tr("Studio Archive", "Stüdyo Arşivi")}</h3>
            </div>
            <button
              className="primary-button compact-button"
              onClick={() => void createNote()}
              title={tr("New global note", "Yeni genel not")}
            >
              <Plus size={14} style={{ marginRight: 6 }} />
              {tr("New", "Yeni")}
            </button>
          </header>

          <div className="note-browser-scroll">
            {/* ── STUDIO section ──────────────────────────────────── */}
            <section className="note-browser-section">
              <header className="note-browser-section-head">
                <FileText size={11} strokeWidth={2.2} />
                <span>{tr("📂 STUDIO", "📂 STÜDYO")}</span>
                <span className="note-browser-section-count">{notes.length}</span>
              </header>

              {notes.length === 0 ? (
                <p className="note-browser-section-empty">
                  {tr("No global notes yet.", "Henüz genel not yok.")}
                </p>
              ) : (
                <ul className="note-browser-list">
                  <AnimatePresence initial={false}>
                    {sortedNotes.map((n) => {
                      const isActive =
                        selection?.kind === "global" && selection.noteId === n.id;
                      const isDragging = draggingNoteId === n.id;
                      const isDropTarget = dropTargetNoteId === n.id;
                      return (
                        <motion.li
                          key={n.id}
                          data-note-id={n.id}
                          layout={!isDragging}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
                          className={[
                            "note-browser-item",
                            isActive ? "is-active" : "",
                            isDragging ? "is-dragging" : "",
                            isDropTarget ? "is-drop-target" : "",
                          ].filter(Boolean).join(" ")}
                          onMouseDown={onNoteRowMouseDown(n.id)}
                        >
                          <FileText size={12} className="note-browser-icon" />
                          {renamingId === n.id ? (
                            <input
                              autoFocus
                              className="input note-rename-input"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => void commitRename(n)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") setRenamingId("");
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="note-browser-title"
                              onClick={() => setSelection({ kind: "global", noteId: n.id })}
                              onDoubleClick={() => startRename(n)}
                              title={deriveDisplayTitle(n.title, n.content)}
                            >
                              <span className="note-browser-name">
                                {deriveDisplayTitle(n.title, n.content)}
                              </span>
                              <small className="note-browser-meta">
                                {new Date(n.updatedAt).toLocaleDateString()}
                              </small>
                              {n.moodboardImageIds && n.moodboardImageIds.length > 0 && (
                                <MoodboardThumbStrip
                                  imageIds={n.moodboardImageIds}
                                  max={3}
                                  label={ui.mbThumbStripLabel}
                                />
                              )}
                            </button>
                          )}

                          <div className="note-browser-actions">
                            <button
                              type="button"
                              className="note-action-btn"
                              title={tr("Rename", "Yeniden adlandır")}
                              onClick={() => startRename(n)}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              className="note-action-btn note-action-danger"
                              title={tr("Delete", "Sil")}
                              onClick={() => setConfirmDeleteId(n.id)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </section>

            {/* ── PROJECTS section ──────────────────────────────────── */}
            <section className="note-browser-section">
              <header className="note-browser-section-head">
                <Gamepad2 size={11} strokeWidth={2.2} />
                <span>{tr("🎮 PROJECTS", "🎮 PROJELER")}</span>
                <span className="note-browser-section-count">{games.length}</span>
              </header>

              {games.length === 0 ? (
                <p className="note-browser-section-empty">
                  {tr("No projects yet.", "Henüz proje yok.")}
                </p>
              ) : (
                <ul className="note-browser-list">
                  {games.map((g) => {
                    const isActive =
                      selection?.kind === "project" && selection.gameId === g.id;
                    const wordCount = (g.notes ?? "").split(/\s+/).filter(Boolean).length;
                    return (
                      <li
                        key={g.id}
                        className={`note-browser-item ${isActive ? "is-active" : ""}`}
                      >
                        <Gamepad2 size={12} className="note-browser-icon" />
                        <button
                          type="button"
                          className="note-browser-title"
                          onClick={() => setSelection({ kind: "project", gameId: g.id })}
                          title={g.title}
                        >
                          <span className="note-browser-name">{g.title}</span>
                          <small className="note-browser-meta">
                            {wordCount > 0
                              ? tr(`${wordCount} words`, `${wordCount} kelime`)
                              : tr("Empty GDD", "Boş GDD")}
                          </small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </aside>

        {/* ── Resize handle ──────────────────────────────────────────── */}
        <div
          className="note-resize-handle"
          onMouseDown={onResizerMouseDown}
          title={tr("Drag to resize", "Boyutlandırmak için sürükle")}
        />

        {/* ── Right: Editor or Empty State ─────────────────────────── */}
        <section className="note-editor panel">
          {!selection ? (
            <div className="note-editor-empty">
              <div className="note-editor-empty-icon">
                <BookOpen size={42} strokeWidth={1.6} />
              </div>
              <h2>
                {isEmpty
                  ? tr("Create your first note", "İlk notunu oluştur")
                  : tr("Pick a note from the left", "Soldan bir not seç")}
              </h2>
              <p>
                {tr(
                  "Browse global studio notes or jump straight into any project's GDD from the sidebar.",
                  "Genel stüdyo notlarına göz at ya da yan menüden bir projenin GDD'sine doğrudan dal."
                )}
              </p>
              <div className="note-editor-empty-actions">
                <button className="primary-button" onClick={() => void createNote()}>
                  <Plus size={14} style={{ marginRight: 6 }} />
                  {tr("Blank note", "Boş not")}
                </button>
              </div>
            </div>
          ) : (
            <div className="note-editor-stack">
              {activeGame && (
                <div className="note-edit-ribbon">
                  <Gamepad2 size={13} strokeWidth={2.2} />
                  <span>
                    {tr("EDITING", "DÜZENLENEN")}: <strong>{activeGame.title}</strong> — GDD
                  </span>
                </div>
              )}

              {activeNote ? (
                <input
                  className="note-title-input"
                  value={DEFAULT_TITLES.has(draftTitle) ? "" : draftTitle}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder={
                    deriveDisplayTitle(draftTitle, draft) === draftTitle
                      ? tr("Note title…", "Not başlığı…")
                      : deriveDisplayTitle(draftTitle, draft)
                  }
                  title={tr("Click to rename", "Yeniden adlandırmak için tıkla")}
                />
              ) : activeGame ? (
                <h2 className="note-title-static">{activeGame.title}</h2>
              ) : null}

              <MarkdownWorkspace
                key={selectionKey}
                value={draft}
                onChange={onContentChange}
                language={language}
                ui={ui}
                saveStatus={saveStatus}
                templates={editorTemplates}
                onExportPdf={exportPdf}
                templateLabel={tr("Use Template", "Şablon Kullan")}
                exportLabel={tr("Export PDF", "PDF Olarak Dışa Aktar")}
                customTemplateScope={activeNote ? "global" : activeGame ? `game-${activeGame.id}` : undefined}
              />
            </div>
          )}
        </section>
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title={tr("Delete note", "Notu sil")}
          body={tr(
            "This note will be permanently removed.",
            "Bu not kalıcı olarak silinecek."
          )}
          confirmLabel={tr("Delete", "Sil")}
          cancelLabel={tr("Cancel", "Vazgeç")}
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDeleteId("")}
        />
      )}

    </motion.div>
  );
}
