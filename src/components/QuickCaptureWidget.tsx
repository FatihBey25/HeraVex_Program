// Floating "+" button anchored bottom-right.
//
// Click opens a tiny popover with two actions — "New note" and
// "New task". Both reuse the existing `heravex:new-note` /
// `heravex:new-task` event flow (App.tsx tabs to the relevant page
// and the destination renderer pops its own creator), so we don't
// duplicate logic. The widget is opt-out via the General settings
// (`general.quickCapture`) — defaults to on.

import { useEffect, useState } from "react";
import { Plus, FileText, ListTodo, X } from "lucide-react";
import { useAppStore } from "../store";

export function QuickCaptureWidget() {
  const { ui, language, general, setWorkspaceTab } = useAppStore();
  const [open, setOpen] = useState(false);

  // Esc closes the popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Honour user preference. Field added in lib/preferences.ts; defaults
  // to true so most users get the widget out of the box.
  if (general.quickCapture === false) return null;

  // 4-way translator. The previous `tr(en, tr)` form silently fell
  // through to English for FR/ES users; the explicit map keeps every
  // string visible to translators in one place.
  const tr = (en: string, t: string, fr?: string, es?: string) => {
    switch (language) {
      case "tr": return t;
      case "fr": return fr ?? en;
      case "es": return es ?? en;
      default:   return en;
    }
  };

  const newNote = () => {
    setWorkspaceTab("notes");
    window.dispatchEvent(new CustomEvent("heravex:new-note"));
    setOpen(false);
  };
  const newTask = () => {
    setWorkspaceTab("tasks");
    window.dispatchEvent(new CustomEvent("heravex:new-task"));
    setOpen(false);
  };

  return (
    <>
      {open && (
        <div className="quick-capture-pop">
          <button type="button" className="quick-capture-act" onClick={newNote}>
            <FileText size={14} />
            <div>
              <strong>{tr("New note", "Yeni not", "Nouvelle note", "Nueva nota")}</strong>
              <small>{tr("Markdown, draft, idea", "Markdown, taslak, fikir", "Markdown, brouillon, idée", "Markdown, borrador, idea")}</small>
            </div>
          </button>
          <button type="button" className="quick-capture-act" onClick={newTask}>
            <ListTodo size={14} />
            <div>
              <strong>{tr("New task", "Yeni görev", "Nouvelle tâche", "Nueva tarea")}</strong>
              <small>{tr("Pick a game, set due date", "Oyun seç, tarih ata", "Choisir un jeu, définir l'échéance", "Elige un juego, fija la fecha")}</small>
            </div>
          </button>
          <span className="quick-capture-hint">
            {tr("Shortcuts:", "Kısayollar:", "Raccourcis :", "Atajos:")} <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>
          </span>
        </div>
      )}
      <button
        type="button"
        className={`quick-capture-fab${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={tr("Quick capture", "Hızlı yakalama", "Capture rapide", "Captura rápida")}
        aria-label={tr("Quick capture", "Hızlı yakalama", "Capture rapide", "Captura rápida")}
      >
        {open ? <X size={18} /> : <Plus size={18} />}
      </button>
      {/* aria backstop */}
      <span style={{ position: "absolute", left: -9999 }}>{ui.dashboard}</span>
    </>
  );
}
