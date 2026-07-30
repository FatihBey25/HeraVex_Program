import { useEffect, useMemo, useState } from "react";
import { Search, Command as CommandIcon, ArrowRight, ChevronRight, FileText, ListTodo, Gamepad2 } from "lucide-react";
import { useAppStore, type WorkspaceTab } from "../store";
import { useEscape } from "../lib/keyboard";
import { getAllNotes } from "../lib/storage";
import { getPluginCommands, getPluginPages } from "../lib/plugins";
import { invoke } from "../lib/invokeWrapper";
import type { NoteRecord } from "../types";

/** Shape returned by the Rust `search_notes` command. */
interface RustNoteHit {
  kind: "global" | "game";
  noteId: string;
  gameId?: string | null;
  title: string;
  snippet: string;
  score: number;
}

type PaletteMode = "actions" | "search";

type PaletteAction = {
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  run: () => void;
};

type SearchHit = {
  id: string;
  kind: "note" | "task" | "game";
  label: string;
  hint: string;
  run: () => void;
};

export function CommandPalette({
  onClose,
  onNewProject,
  initialMode = "actions",
}: {
  onClose: () => void;
  onNewProject: () => void;
  /** Cmd+Shift+P opens with mode="actions"; Cmd+K opens with mode="search". */
  initialMode?: PaletteMode;
}) {
  const { setWorkspaceTab, setSelectedId, setActiveTaskId, games, language } = useAppStore();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  // Lazily fetched studio notes — only loaded when search mode is entered.
  const [notes, setNotes] = useState<NoteRecord[] | null>(null);
  useEscape(onClose);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  // Effective query strips the `>` actions prefix. Typing `>` is the
  // VS Code convention to jump from search → action picker mid-flight,
  // and an empty input also defaults to actions so opening the palette
  // never shows a blank state.
  const effectiveQuery = (() => {
    if (query.startsWith(">")) return query.slice(1).trimStart();
    return query;
  })();
  useEffect(() => {
    if (query.startsWith(">")) setMode("actions");
    else if (query.length > 0) setMode("search");
    else setMode(initialMode);
  }, [query, initialMode]);

  // Load notes once when search mode kicks in.
  useEffect(() => {
    if (mode !== "search" || notes !== null) return;
    void (async () => {
      try { setNotes(await getAllNotes()); }
      catch { setNotes([]); }
    })();
  }, [mode, notes]);

  // v0.9.7 — Rust-side global search for notes. Debounced 150ms so a
  // burst of keystrokes doesn't fire ten Tauri calls. Falls back to
  // the JS in-memory substring search below if the command fails
  // (older builds without the `search_notes` handler).
  const [rustHits, setRustHits] = useState<RustNoteHit[]>([]);
  useEffect(() => {
    if (mode !== "search" || !effectiveQuery.trim()) { setRustHits([]); return; }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void invoke<RustNoteHit[]>("search_notes", { query: effectiveQuery, limit: 12 })
        .then((hits) => { if (!cancelled) setRustHits(hits); })
        .catch(() => { if (!cancelled) setRustHits([]); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [effectiveQuery, mode]);

  const go = (tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    onClose();
  };

  const actions: PaletteAction[] = useMemo(
    () => [
      { id: "new-project", label: tr("New project", "Yeni proje"), hint: tr("Open the project creator modal", "Proje oluşturma modal'ını aç"), shortcut: "Ctrl+N",
        run: () => { onClose(); onNewProject(); } },
      { id: "new-task", label: tr("New task", "Yeni görev"), hint: tr("Jump to Task Center", "Görev Merkezi'ne git"), shortcut: "Ctrl+T",
        run: () => go("tasks") },
      { id: "new-note", label: tr("New note", "Yeni not"), hint: tr("Jump to Notes", "Notlar sekmesine git"), shortcut: "Ctrl+/",
        run: () => go("notes") },
      { id: "go-dashboard",  label: tr("Go to Dashboard",   "Dashboard'a git"),         hint: tr("Studio overview",            "Stüdyo genel bakışı"),     run: () => go("dashboard") },
      { id: "go-games",      label: tr("Go to Games",       "Oyunlar'a git"),           hint: tr("Project archive",            "Proje arşivi"),            run: () => go("library") },
      { id: "go-tasks",      label: tr("Go to Tasks",       "Görevler'e git"),          hint: tr("Task Center",                "Görev Merkezi"),           run: () => go("tasks") },
      { id: "go-notes",      label: tr("Go to Notes",       "Notlar'a git"),            hint: tr("Studio notebook",            "Stüdyo not defteri"),      run: () => go("notes") },
      { id: "go-calendar",   label: tr("Go to Calendar",    "Takvim'e git"),            hint: tr("Monthly planning view",      "Aylık plan görünümü"),     run: () => go("calendar") },
      { id: "go-storehub",   label: tr("Go to Store Hub",   "Mağaza Merkezi'ne git"),   hint: tr("Live store metrics",         "Canlı mağaza metrikleri"), run: () => go("storehub") },
      { id: "go-wallet",     label: tr("Go to Wallet",      "Cüzdan'a git"),            hint: tr("Expense tracker",            "Gider takibi"),            run: () => go("wallet") },
      { id: "go-analytics",  label: tr("Go to Analytics",   "Analitik'e git"),          hint: tr("Burn rate & reports",        "Yakım hızı & raporlar"),   run: () => go("analytics") },
      { id: "go-profile",    label: tr("Go to Profile",     "Profil'e git"),            hint: tr("Identity, prefs, API keys",  "Kimlik, tercihler, API"),  run: () => go("profile") },
      // ── Plugin contributions (v0.9.9) — pages as "go to" actions,
      //    commands run in place. The palette unmounts on close, so a
      //    fresh open always reflects the current plugin set.
      ...getPluginPages().map((p): PaletteAction => ({
        id: `plugin-page-${p.key}`,
        label: tr(`Go to ${p.title}`, `${p.title} sayfasına git`),
        hint: p.pluginName,
        run: () => go(p.key as WorkspaceTab),
      })),
      ...getPluginCommands().map((c): PaletteAction => ({
        id: `plugin-cmd-${c.id}`,
        label: c.label,
        hint: tr("Plugin command", "Eklenti komutu"),
        run: () => { onClose(); void c.run(); },
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language]
  );

  const filteredActions = useMemo(() => {
    const q = effectiveQuery.toLocaleLowerCase(language);
    if (!q) return actions;
    return actions.filter((a) =>
      `${a.label} ${a.hint}`.toLocaleLowerCase(language).includes(q)
    );
  }, [actions, effectiveQuery, language]);

  // Cross-content search — notes (title/content), tasks (across all
  // games), games (title/summary/tags). Cap each kind so the list
  // stays scannable even with a broad query.
  const searchHits = useMemo<SearchHit[]>(() => {
    const q = effectiveQuery.toLocaleLowerCase(language);
    if (!q) return [];
    const hits: SearchHit[] = [];

    games.forEach((g) => {
      if (hits.filter((h) => h.kind === "game").length >= 6) return;
      const hay = `${g.title} ${g.summary} ${(g.tags || []).join(" ")}`.toLocaleLowerCase(language);
      if (hay.includes(q)) {
        hits.push({
          id: `game:${g.id}`,
          kind: "game",
          label: g.title,
          hint: g.summary?.slice(0, 60) || tr("Game project", "Oyun projesi"),
          run: () => { setSelectedId(g.id); go("library"); },
        });
      }
    });

    let taskCount = 0;
    for (const g of games) {
      for (const t of (g.tasks || [])) {
        if (taskCount >= 6) break;
        const hay = `${t.title} ${t.description ?? ""} ${(t.tags || []).join(" ")}`.toLocaleLowerCase(language);
        if (hay.includes(q)) {
          taskCount++;
          hits.push({
            id: `task:${t.id}`,
            kind: "task",
            label: t.title,
            hint: `${g.title} · ${t.done ? tr("Done", "Bitti") : tr("Task", "Görev")}`,
            run: () => { setSelectedId(g.id); setActiveTaskId(t.id); go("tasks"); },
          });
        }
      }
      if (taskCount >= 6) break;
    }

    // Rust-side note search results — ranked, with snippet. If the
    // Rust call hasn't returned yet (or returned empty), fall back to
    // the legacy JS substring scan against the in-memory notes
    // cache so the user sees *something* immediately.
    const fromRust = rustHits.slice(0, 8).map<SearchHit>((r) => ({
      id: `${r.kind}-note:${r.noteId}`,
      kind: "note",
      label: r.title || tr("Untitled note", "Adsız not"),
      hint: r.snippet.replace(/\s+/g, " "),
      run: () => {
        if (r.kind === "game" && r.gameId) {
          setSelectedId(r.gameId);
          go("library");
        } else {
          go("notes");
        }
      },
    }));
    if (fromRust.length > 0) {
      hits.push(...fromRust);
    } else {
      (notes || []).slice(0, 50).forEach((n) => {
        if (hits.filter((h) => h.kind === "note").length >= 6) return;
        const hay = `${n.title} ${n.content}`.toLocaleLowerCase(language);
        if (hay.includes(q)) {
          hits.push({
            id: `note:${n.id}`,
            kind: "note",
            label: n.title || tr("Untitled note", "Adsız not"),
            hint: (n.content || "").slice(0, 80).replace(/\s+/g, " "),
            run: () => { go("notes"); },
          });
        }
      });
    }

    return hits;
  }, [effectiveQuery, language, games, notes, rustHits, setSelectedId, setActiveTaskId, setWorkspaceTab]);

  const showActions = mode === "actions";
  const list = showActions ? filteredActions : searchHits;

  const placeholder = showActions
    ? tr("Search commands…  (type > for actions)", "Komut ara…  (eylem için > yaz)")
    : tr("Search notes, tasks, games…", "Not, görev, oyun ara…");

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
            placeholder={placeholder}
            className="cmdk-search-input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && list[0]) list[0].run();
              if (e.key === "Tab") {
                e.preventDefault();
                setMode((m) => (m === "actions" ? "search" : "actions"));
              }
            }}
          />
          <span className="cmdk-mode-pill">
            {showActions ? tr("ACTIONS", "EYLEM") : tr("SEARCH", "ARAMA")}
          </span>
          <kbd className="cmdk-kbd">ESC</kbd>
        </div>

        <div className="cmdk-list">
          {list.length === 0 && (
            <div className="cmdk-empty">
              {showActions
                ? tr("No matching commands.", "Eşleşen komut yok.")
                : tr("No matches. Type more or press Tab to switch.", "Eşleşme yok. Yazmaya devam et veya Tab'a bas.")}
            </div>
          )}
          {showActions
            ? filteredActions.map((a) => (
                <button key={a.id} type="button" className="cmdk-item" onClick={a.run}>
                  <div className="cmdk-item-text">
                    <strong>{a.label}</strong>
                    <span>{a.hint}</span>
                  </div>
                  {a.shortcut && <kbd className="cmdk-kbd">{a.shortcut}</kbd>}
                  <ArrowRight size={13} className="cmdk-item-chev" />
                </button>
              ))
            : searchHits.map((h) => {
                const Icon = h.kind === "note" ? FileText : h.kind === "task" ? ListTodo : Gamepad2;
                return (
                  <button key={h.id} type="button" className="cmdk-item" onClick={h.run}>
                    <Icon size={14} className="cmdk-item-icon" />
                    <div className="cmdk-item-text">
                      <strong>{h.label}</strong>
                      <span>{h.hint}</span>
                    </div>
                    <ChevronRight size={13} className="cmdk-item-chev" />
                  </button>
                );
              })
          }
        </div>

        <footer className="cmdk-footer">
          <CommandIcon size={11} strokeWidth={2.2} />
          <span>
            {tr(
              "↑↓ navigate · Enter run · Tab switch mode · > prefix for actions",
              "↑↓ gezin · Enter çalıştır · Tab modu değiştir · > eylem prefix'i",
            )}
          </span>
        </footer>
      </div>
    </div>
  );
}
