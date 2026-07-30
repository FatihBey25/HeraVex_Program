// Flow Center page (v0.9.8 — Faz 1).
//
// Left rail lists flows split into Studio (gameId = null) and Projects
// (grouped per game), mirroring NoteCenter. Right pane hosts the React
// Flow canvas for the active flow. New flows are created with a chosen
// kind + scope; persistence is owned by useFlowStore (debounced writes).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Workflow, Gamepad2, Share2 } from "lucide-react";
import { useAppStore } from "../../store";
import { useFlowStore } from "../../store/flowStore";
import { isGeneralGame } from "../../lib/general-game";
import { FlowCanvas } from "../flow/FlowCanvas";
import { ConfirmDialog } from "../shared/ConfirmDialog";

export function FlowCenter() {
  const { games: allGames, language } = useAppStore();
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const games = useMemo(() => allGames.filter((g) => !isGeneralGame(g)), [allGames]);

  const {
    flows, activeFlowId, loaded,
    loadFlows, setActiveFlow, createFlow, renameFlow, deleteFlow, reorderFlows, syncExternal,
  } = useFlowStore();

  const [newScope, setNewScope] = useState<string>("studio"); // "studio" | gameId
  const [renamingId, setRenamingId] = useState<string>("");
  const [renameValue, setRenameValue] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>("");
  const [draggingId, setDraggingId] = useState<string>("");
  const [dropTargetId, setDropTargetId] = useState<string>("");
  const dragRef = useRef<string>("");
  const dropRef = useRef<string>("");

  useEffect(() => { void loadFlows(); }, [loadFlows]);

  // Team-sync: a teammate changed a flows file on disk → merge in the
  // non-active flows without clobbering the one being edited.
  useEffect(() => {
    const handler = () => { void syncExternal(); };
    window.addEventListener("heravex:flow-file-changed", handler);
    return () => window.removeEventListener("heravex:flow-file-changed", handler);
  }, [syncExternal]);

  const sortFlows = useCallback((list: typeof flows) =>
    [...list].sort((a, b) => {
      const ao = a.order ?? 0, bo = b.order ?? 0;
      if (ao !== bo) return ao - bo;
      return b.updatedAt.localeCompare(a.updatedAt);
    }), []);
  const studioFlows = useMemo(() => sortFlows(flows.filter((f) => !f.gameId)), [flows, sortFlows]);
  const activeFlow = useMemo(() => flows.find((f) => f.id === activeFlowId) ?? null, [flows, activeFlowId]);

  // ── Drag-to-reorder (mirrors NoteCenter; scoped per Studio / game) ──
  const flowIdFromPoint = useCallback((x: number, y: number): string => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return (el?.closest("[data-flow-id]") as HTMLElement | null)?.dataset.flowId ?? "";
  }, []);
  const startFlowDrag = useCallback((flowId: string, scopeIds: string[]) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("input, button")) return;
    const startX = e.clientX, startY = e.clientY;
    let started = false;
    const onMove = (ev: MouseEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        started = true; dragRef.current = flowId; setDraggingId(flowId); document.body.style.cursor = "grabbing";
      }
      const t = flowIdFromPoint(ev.clientX, ev.clientY);
      const next = t && t !== flowId && scopeIds.includes(t) ? t : "";
      if (next !== dropRef.current) { dropRef.current = next; setDropTargetId(next); }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      const moved = dragRef.current, target = dropRef.current;
      dragRef.current = ""; dropRef.current = ""; setDraggingId(""); setDropTargetId("");
      if (!started || !moved || !target) return;
      const ids = [...scopeIds];
      const from = ids.indexOf(moved);
      if (from < 0) return;
      ids.splice(from, 1);
      const to = ids.indexOf(target);
      if (to < 0) return;
      ids.splice(to, 0, moved);
      reorderFlows(ids);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [flowIdFromPoint, reorderFlows]);

  const handleCreate = async () => {
    const gameId = newScope === "studio" ? null : newScope;
    await createFlow(tr("Untitled flow", "Adsız akış"), "freeform", gameId);
  };

  const commitRename = (id: string) => {
    const next = renameValue.trim();
    setRenamingId("");
    if (next) renameFlow(id, next);
  };

  const flowRow = (id: string, name: string, scopeIds: string[]) => {
    const isActive = activeFlowId === id;
    const cls = [
      "note-browser-item",
      isActive ? "is-active" : "",
      draggingId === id ? "is-dragging" : "",
      dropTargetId === id ? "is-drop-target" : "",
    ].filter(Boolean).join(" ");
    return (
      <motion.li
        key={id}
        layout={draggingId !== id}
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -8 }}
        transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
        className={cls}
        data-flow-id={id}
        onMouseDown={startFlowDrag(id, scopeIds)}
      >
        <Share2 size={12} className="note-browser-icon" />
        {renamingId === id ? (
          <input
            autoFocus
            className="input note-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => commitRename(id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenamingId("");
            }}
          />
        ) : (
          <button
            type="button"
            className="note-browser-title"
            onClick={() => setActiveFlow(id)}
            onDoubleClick={() => { setRenamingId(id); setRenameValue(name); }}
            title={name}
          >
            <span className="note-browser-name">{name}</span>
          </button>
        )}
        <div className="note-browser-actions">
          <button
            type="button"
            className="note-action-btn note-action-danger"
            title={tr("Delete", "Sil")}
            onClick={() => setConfirmDeleteId(id)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </motion.li>
    );
  };

  return (
    <motion.div
      className="page-fade note-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="note-center-layout" style={{ gridTemplateColumns: `320px 6px 1fr` }}>
        {/* ── Left: flow browser ─────────────────────────────────────── */}
        <aside className="note-browser panel">
          <header className="note-browser-head">
            <div>
              <p className="eyebrow">{tr("FLOW CENTER", "FLOW MERKEZİ")}</p>
              <h3 style={{ margin: 0 }}>{tr("Flows", "Akışlar")}</h3>
            </div>
          </header>

          <div className="flow-new-bar">
            <select className="input flow-new-scope" value={newScope} onChange={(e) => setNewScope(e.target.value)}>
              <option value="studio">{tr("Studio", "Stüdyo")}</option>
              {games.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
            <button className="primary-button flow-new-btn" onClick={() => void handleCreate()}>
              <Plus size={15} />
              {tr("New flow", "Yeni akış")}
            </button>
          </div>

          <div className="note-browser-scroll">
            <section className="note-browser-section">
              <header className="note-browser-section-head">
                <Workflow size={11} strokeWidth={2.2} />
                <span>{tr("📂 STUDIO", "📂 STÜDYO")}</span>
                <span className="note-browser-section-count">{studioFlows.length}</span>
              </header>
              {studioFlows.length === 0 ? (
                <p className="note-browser-section-empty">{tr("No studio flows yet.", "Henüz stüdyo akışı yok.")}</p>
              ) : (
                <ul className="note-browser-list">
                  <AnimatePresence initial={false}>
                    {(() => { const ids = studioFlows.map((f) => f.id); return studioFlows.map((f) => flowRow(f.id, f.name, ids)); })()}
                  </AnimatePresence>
                </ul>
              )}
            </section>

            <section className="note-browser-section">
              <header className="note-browser-section-head">
                <Gamepad2 size={11} strokeWidth={2.2} />
                <span>{tr("🎮 PROJECTS", "🎮 PROJELER")}</span>
              </header>
              {games.map((g) => {
                const gameFlows = sortFlows(flows.filter((f) => f.gameId === g.id));
                if (gameFlows.length === 0) return null;
                const ids = gameFlows.map((f) => f.id);
                return (
                  <div key={g.id} className="flow-project-group">
                    <p className="flow-project-name">{g.title}</p>
                    <ul className="note-browser-list">
                      <AnimatePresence initial={false}>{gameFlows.map((f) => flowRow(f.id, f.name, ids))}</AnimatePresence>
                    </ul>
                  </div>
                );
              })}
            </section>
          </div>
        </aside>

        <div className="note-resize-handle" style={{ pointerEvents: "none", opacity: 0.4 }} />

        {/* ── Right: canvas ──────────────────────────────────────────── */}
        <section className="note-editor panel flow-editor-panel">
          {activeFlow ? (
            <FlowCanvas key={activeFlow.id} flow={activeFlow} language={language} />
          ) : (
            <div className="note-editor-empty">
              <div className="note-editor-empty-icon"><Workflow size={42} strokeWidth={1.6} /></div>
              <h2>{loaded && flows.length === 0 ? tr("Create your first flow", "İlk akışını oluştur") : tr("Pick a flow", "Bir akış seç")}</h2>
              <p>{tr("Map game loops, dialogue branches, task dependencies or release roadmaps — visually.", "Oyun döngüleri, diyalog dalları, görev bağımlılıkları veya sürüm yol haritalarını görsel olarak çiz.")}</p>
            </div>
          )}
        </section>
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title={tr("Delete flow", "Akışı sil")}
          body={tr("This flow will be permanently removed.", "Bu akış kalıcı olarak silinecek.")}
          confirmLabel={tr("Delete", "Sil")}
          cancelLabel={tr("Cancel", "Vazgeç")}
          danger
          onConfirm={() => { void deleteFlow(confirmDeleteId); setConfirmDeleteId(""); }}
          onCancel={() => setConfirmDeleteId("")}
        />
      )}
    </motion.div>
  );
}
