import { useState } from "react";
import { motion } from "framer-motion";
import { ClipboardList, FilePlus2 } from "lucide-react";
import { useAppStore } from "../../../store";

export function ReleaseTab({ gameId }: { gameId: string }) {
  const {
    games, handleSaveGame, releaseTemplate, handleSaveReleaseTemplate, ui, language,
  } = useAppStore();
  const game = games.find((g) => g.id === gameId);

  const [showEditor, setShowEditor] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");

  if (!game) return null;

  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const toggleItem = (itemId: string) =>
    void handleSaveGame({
      ...game,
      releaseTimeline: game.releaseTimeline.map((item) =>
        item.id === itemId ? { ...item, done: !item.done } : item
      ),
    });

  // v0.8.5: applying a template is now ALWAYS user-initiated. The
  // Rust `add_game` no longer seeds new games with the global
  // checklist; the CTA below is the only path that pulls items in.
  const applyTemplate = () =>
    void handleSaveGame(
      { ...game, releaseTimeline: releaseTemplate.map((item) => ({ ...item, done: false })) },
      ui.releaseTemplateApplied
    );

  const writeFromScratch = () => {
    // No-template branch: open the global template editor so the user
    // can compose their own checklist before applying. We don't seed a
    // placeholder item — the empty-state CTA only disappears when the
    // user genuinely adds something.
    setShowEditor(true);
  };

  const addTemplateItem = async () => {
    if (!titleDraft.trim()) return;
    await handleSaveReleaseTemplate([
      ...releaseTemplate,
      { id: crypto.randomUUID(), title: titleDraft.trim(), description: descDraft.trim() },
    ]);
    setTitleDraft(""); setDescDraft("");
  };

  const removeTemplateItem = (id: string) =>
    void handleSaveReleaseTemplate(releaseTemplate.filter((item) => item.id !== id));

  const resetTimeline = () =>
    void handleSaveGame(
      { ...game, releaseTimeline: [] },
      ui.releaseTimelineCleared
    );

  const done = game.releaseTimeline.filter((item) => item.done).length;
  const isEmpty = game.releaseTimeline.length === 0;

  return (
    <div key="release" className="tab-panel tab-content">
      {/* v0.8.5 — Butler was relocated to the Versions tab. The
       *  Release tab now focuses exclusively on the post-launch
       *  checklist; deployment lives next to the build it pushes. */}

      {isEmpty ? (
        // Opt-in CTA — replaces the old auto-applied template.
        <motion.section
          className="release-empty-card"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="release-empty-icon">
            <ClipboardList size={26} strokeWidth={1.9} />
          </div>
          <p className="eyebrow">{ui.releaseEmptyEyebrow}</p>
          <h3 style={{ margin: "4px 0 8px" }}>{ui.releaseEmptyTitle}</h3>
          <p className="section-copy" style={{ maxWidth: 480, textAlign: "center" }}>
            {ui.releaseEmptyBody}
          </p>
          <div className="release-empty-actions">
            <button
              type="button"
              className="primary-button"
              onClick={applyTemplate}
              disabled={releaseTemplate.length === 0}
              title={
                releaseTemplate.length === 0
                  ? ui.releaseEmptyNoTemplate
                  : undefined
              }
            >
              <ClipboardList size={14} style={{ marginRight: 6 }} />
              {ui.releaseEmptyApplyTemplate}
            </button>
            <button type="button" className="secondary-button" onClick={writeFromScratch}>
              <FilePlus2 size={14} style={{ marginRight: 6 }} />
              {ui.releaseEmptyWriteFromScratch}
            </button>
          </div>
          {releaseTemplate.length === 0 && (
            <small className="release-empty-hint">{ui.releaseEmptyNoTemplate}</small>
          )}
        </motion.section>
      ) : (
        <div className="release-summary">
          <strong>{done}/{game.releaseTimeline.length}</strong>
          <div>
            <span>{ui.releaseChecklistHint}</span>
            <div className="button-row release-summary-actions">
              <button className="secondary-button" onClick={() => setShowEditor((v) => !v)}>
                {showEditor ? ui.hideTemplateEditor : ui.showTemplateEditor}
              </button>
              {/* When a template is already applied, give the user an
               *  explicit reset path. Keeps the opt-in invariant: the
               *  list can always be returned to empty without leaving
               *  stale items behind. */}
              <button className="secondary-button" onClick={resetTimeline}>
                {ui.releaseClearTimeline}
              </button>
              <button className="secondary-button" onClick={applyTemplate}>
                {ui.releaseReapplyTemplate}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditor && (
        <div className="release-template-panel">
          <div className="panel-head">
            <div>
              <span className="label">{ui.releaseTemplateTitle}</span>
              <p className="helper-copy">{ui.releaseTemplateBody}</p>
            </div>
          </div>
          <div className="release-template-form">
            <input className="input" placeholder={ui.releaseStepTitle} value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} />
            <input className="input" placeholder={ui.releaseStepDescription} value={descDraft} onChange={(e) => setDescDraft(e.target.value)} />
            <button className="primary-button" onClick={() => void addTemplateItem()}>{ui.addStep}</button>
          </div>
          <div className="release-template-list">
            {releaseTemplate.map((item, index) => (
              <div key={item.id} className="release-template-item">
                <div>
                  <strong>{String(index + 1).padStart(2, "0")} · {item.title}</strong>
                  <p>{item.description || ui.noDescription}</p>
                </div>
                <button className="secondary-button danger-button" onClick={() => removeTemplateItem(item.id)}>
                  {ui.delete}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isEmpty && (
        <div className="release-timeline">
          {game.releaseTimeline.map((item, index) => (
            <button
              key={item.id}
              className={`release-card ${item.done ? "release-card-done" : ""}`}
              onClick={() => toggleItem(item.id)}
            >
              <span className="release-line" />
              <span className="release-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="release-card-content">
                <strong>{item.title}</strong>
                <p>{item.description || ui.noDescription}</p>
                <small>{item.done ? ui.checked : ui.tapToToggle}</small>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
