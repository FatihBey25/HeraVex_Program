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

  const tr = (en: string, t: string) => (language === "tr" ? t : en);

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
              <strong>{tr("New note", "Yeni not")}</strong>
              <small>{tr("Markdown, draft, idea", "Markdown, taslak, fikir")}</small>
            </div>
          </button>
          <button type="button" className="quick-capture-act" onClick={newTask}>
            <ListTodo size={14} />
            <div>
              <strong>{tr("New task", "Yeni görev")}</strong>
              <small>{tr("Pick a game, set due date", "Oyun seç, tarih ata")}</small>
            </div>
          </button>
          <span className="quick-capture-hint">
            {tr("Shortcuts:", "Kısayollar:")} <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>
          </span>
        </div>
      )}
      <button
        type="button"
        className={`quick-capture-fab${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={tr("Quick capture", "Hızlı yakalama")}
        aria-label={tr("Quick capture", "Hızlı yakalama")}
      >
        {open ? <X size={18} /> : <Plus size={18} />}
      </button>
      {/* aria backstop */}
      <span style={{ position: "absolute", left: -9999 }}>{ui.dashboard}</span>
    </>
  );
}
