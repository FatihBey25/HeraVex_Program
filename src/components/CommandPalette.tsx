import { useMemo, useState } from "react";
import { Search, Command as CommandIcon, ArrowRight } from "lucide-react";
import { useAppStore, type WorkspaceTab } from "../store";
import { useEscape } from "../lib/keyboard";

type PaletteAction = {
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  run: () => void;
};

export function CommandPalette({
  onClose,
  onNewProject,
}: {
  onClose: () => void;
  onNewProject: () => void;
}) {
  const { setWorkspaceTab, language } = useAppStore();
  const [query, setQuery] = useState("");
  useEscape(onClose);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const go = (tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    onClose();
  };

  const actions: PaletteAction[] = useMemo(
    () => [
      {
        id: "new-project",
        label: tr("New project", "Yeni proje"),
        hint: tr("Open the project creator modal", "Proje oluşturma modal'ını aç"),
        shortcut: "⌘N",
        run: () => { onClose(); onNewProject(); },
      },
      {
        id: "new-task",
        label: tr("New task", "Yeni görev"),
        hint: tr("Jump to Task Center", "Görev Merkezi'ne git"),
        shortcut: "⌘T",
        run: () => go("tasks"),
      },
      {
        id: "new-note",
        label: tr("New note", "Yeni not"),
        hint: tr("Jump to Notes", "Notlar sekmesine git"),
        shortcut: "⌘/",
        run: () => go("notes"),
      },
      { id: "go-dashboard",  label: tr("Go to Dashboard",   "Dashboard'a git"),         hint: tr("Studio overview",            "Stüdyo genel bakışı"),     run: () => go("dashboard") },
      { id: "go-games",      label: tr("Go to Games",       "Oyunlar'a git"),           hint: tr("Project archive",            "Proje arşivi"),            run: () => go("library") },
      { id: "go-tasks",      label: tr("Go to Tasks",       "Görevler'e git"),          hint: tr("Task Center",                "Görev Merkezi"),           run: () => go("tasks") },
      { id: "go-notes",      label: tr("Go to Notes",       "Notlar'a git"),            hint: tr("Studio notebook",            "Stüdyo not defteri"),      run: () => go("notes") },
      { id: "go-calendar",   label: tr("Go to Calendar",    "Takvim'e git"),            hint: tr("Monthly planning view",      "Aylık plan görünümü"),     run: () => go("calendar") },
      { id: "go-storehub",   label: tr("Go to Store Hub",   "Mağaza Merkezi'ne git"),   hint: tr("Live store metrics",         "Canlı mağaza metrikleri"), run: () => go("storehub") },
      { id: "go-wallet",     label: tr("Go to Wallet",      "Cüzdan'a git"),            hint: tr("Expense tracker",            "Gider takibi"),            run: () => go("wallet") },
      { id: "go-analytics",  label: tr("Go to Analytics",   "Analitik'e git"),          hint: tr("Burn rate & reports",        "Yakım hızı & raporlar"),   run: () => go("analytics") },
      { id: "go-profile",    label: tr("Go to Profile",     "Profil'e git"),            hint: tr("Identity, prefs, API keys",  "Kimlik, tercihler, API"),  run: () => go("profile") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(language);
    if (!q) return actions;
    return actions.filter((a) =>
      `${a.label} ${a.hint}`.toLocaleLowerCase(language).includes(q)
    );
  }, [actions, query, language]);

  return (
    <div
      className="cmdk-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="cmdk-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={tr("Command palette", "Komut paleti")}
      >
        <div className="cmdk-search">
          <Search size={14} strokeWidth={2.2} className="cmdk-search-icon" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("Search commands…", "Komut ara…")}
            className="cmdk-search-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[0]) {
                filtered[0].run();
              }
            }}
          />
          <kbd className="cmdk-kbd">ESC</kbd>
        </div>

        <div className="cmdk-list">
          {filtered.length === 0 && (
            <div className="cmdk-empty">
              {tr("No matching commands.", "Eşleşen komut yok.")}
            </div>
          )}
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              className="cmdk-item"
              onClick={a.run}
            >
              <div className="cmdk-item-text">
                <strong>{a.label}</strong>
                <span>{a.hint}</span>
              </div>
              {a.shortcut && <kbd className="cmdk-kbd">{a.shortcut}</kbd>}
              <ArrowRight size={13} className="cmdk-item-chev" />
            </button>
          ))}
        </div>

        <footer className="cmdk-footer">
          <CommandIcon size={11} strokeWidth={2.2} />
          <span>
            {tr(
              "Use ↑↓ to navigate, Enter to run",
              "Gezinmek için ↑↓, çalıştırmak için Enter",
            )}
          </span>
        </footer>
      </div>
    </div>
  );
}
