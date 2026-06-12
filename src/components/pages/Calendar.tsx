import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Flame, Rocket, CalendarDays, Gamepad2, CheckCircle2, ChevronDown, Check } from "lucide-react";
import { useAppStore, selectAllTasks } from "../../store";
import { localeForLanguage, priorityLabel } from "../../lib/i18n";
import { isGeneralGame } from "../../lib/general-game";
import type { FlatTask } from "../../types";

type Cell = {
  date: Date;
  inMonth: boolean;
  iso: string;
  isToday: boolean;
};

function buildMonthCells(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1);
  // Monday-first week
  const startWeekday = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startWeekday);
  const cells: Cell[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    cells.push({
      date: d,
      inMonth: d.getMonth() === month,
      iso,
      isToday: d.getTime() === today.getTime(),
    });
  }
  return cells;
}

const RELEASE_KEYWORDS = [
  "build", "release", "launch", "yayın", "yayin", "surum", "sürüm", "version", "sortie",
];

function isMilestone(task: FlatTask): boolean {
  const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
  return RELEASE_KEYWORDS.some((k) => text.includes(k));
}

export function Calendar() {
  const { games, language, setActiveTaskId, setWorkspaceTab } = useAppStore();
  const allTasks = useMemo(() => selectAllTasks(games), [games]);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [filter, setFilter] = useState<"all" | "urgent" | "milestone">("all");
  // Multi-select per-game filter. Empty Set = show every game (the
  // default). Selecting any game id narrows to those games only.
  const [gameFilter, setGameFilter] = useState<Set<string>>(new Set());
  // Optional toggle: include completed tasks. Default off — the
  // calendar reads as "what's coming up" when done items are hidden.
  const [showDone, setShowDone] = useState(false);

  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const filtered = useMemo(() => {
    return allTasks.filter((t) => {
      if (!t.dueDate) return false;
      if (!showDone && t.done) return false;
      if (filter === "urgent") {
        if (t.priority !== 3) return false;
      } else if (filter === "milestone") {
        if (!isMilestone(t)) return false;
      }
      // Per-game filter — only applies when the user picked specific
      // games. Empty set means "all".
      if (gameFilter.size > 0 && !gameFilter.has(t.gameId)) return false;
      return true;
    });
  }, [allTasks, filter, gameFilter, showDone]);

  // Real games for the picker (hide the internal "General" marker).
  const filterableGames = useMemo(
    () => games.filter((g) => !isGeneralGame(g)),
    [games],
  );

  const toggleGame = (id: string) => {
    setGameFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Dropdown state for the game filter (replaces the old chip row).
  //
  // The popover lives in a portal at <body> so it escapes the calendar
  // header's `overflow: hidden` (the `.panel` rule). Without the portal
  // the menu was being clipped at the header bottom edge and hidden by
  // the grid panel below it. Position is computed from the trigger's
  // bounding rect on open and re-applied on scroll / resize so the
  // anchor never drifts.
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const placeMenu = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({
      top: Math.round(r.bottom + 6),
      right: Math.round(window.innerWidth - r.right),
    });
  };
  // Position before paint so the menu never flashes in the wrong spot.
  useLayoutEffect(() => {
    if (gameMenuOpen) placeMenu();
  }, [gameMenuOpen]);

  useEffect(() => {
    if (!gameMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setGameMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGameMenuOpen(false);
    };
    const onReflow = () => placeMenu();
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [gameMenuOpen]);

  const gameFilterLabel = (() => {
    if (gameFilter.size === 0) return tr("All games", "Tüm oyunlar");
    if (gameFilter.size === 1) {
      const id = Array.from(gameFilter)[0];
      const g = filterableGames.find((g) => g.id === id);
      if (!g) return tr("1 game", "1 oyun");
      return g.title.length > 14 ? g.title.slice(0, 13) + "…" : g.title;
    }
    return tr(`${gameFilter.size} games`, `${gameFilter.size} oyun`);
  })();

  const byIso = useMemo(() => {
    const map = new Map<string, FlatTask[]>();
    for (const t of filtered) {
      if (!t.dueDate) continue;
      const arr = map.get(t.dueDate) ?? [];
      arr.push(t);
      map.set(t.dueDate, arr);
    }
    return map;
  }, [filtered]);

  const cells = useMemo(() => buildMonthCells(cursor.year, cursor.month), [cursor]);

  const monthLabel = new Intl.DateTimeFormat(localeForLanguage(language), {
    month: "long",
    year: "numeric",
  }).format(new Date(cursor.year, cursor.month, 1));

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(localeForLanguage(language), { weekday: "short" });
    // Monday start: 5,6,0,1,2,3,4 → use a reference Monday
    const ref = new Date(2024, 0, 1); // Jan 1 2024 is a Monday
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(ref);
      d.setDate(ref.getDate() + i);
      return fmt.format(d);
    });
  }, [language]);

  const goPrev = () =>
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  const goNext = () =>
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));
  const goToday = () => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
  };

  return (
    <motion.div
      className="page-fade calendar-page"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.05 } } }}
    >
      <motion.section
        className="panel calendar-header"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}
      >
        <div className="calendar-header-left">
          <div className="calendar-header-icon">
            <CalendarDays size={22} strokeWidth={2} />
          </div>
          <div>
            <p className="eyebrow">{tr("PLANNING", "PLANLAMA")}</p>
            <h2 style={{ margin: "2px 0 0", textTransform: "capitalize" }}>{monthLabel}</h2>
          </div>
        </div>
        <div className="calendar-header-actions">
          <div className="calendar-nav">
            <button className="icon-button" onClick={goPrev} title={tr("Previous month", "Önceki ay")}>
              <ChevronLeft size={16} />
            </button>
            <button className="secondary-button compact-button" onClick={goToday}>
              {tr("Today", "Bugün")}
            </button>
            <button className="icon-button" onClick={goNext} title={tr("Next month", "Sonraki ay")}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="calendar-filter-chips">
            <button
              className={`filter-chip ${filter === "all" ? "filter-chip-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              {tr("All", "Hepsi")}
            </button>
            <button
              className={`filter-chip filter-chip-urgent ${filter === "urgent" ? "filter-chip-active" : ""}`}
              onClick={() => setFilter("urgent")}
            >
              <span className="filter-dot filter-dot-urgent" aria-hidden="true" />
              <Flame size={12} style={{ marginRight: 5, verticalAlign: -1, color: "#f87171" }} />
              {tr("Urgent", "Acil")}
            </button>
            <button
              className={`filter-chip filter-chip-milestone ${filter === "milestone" ? "filter-chip-active" : ""}`}
              onClick={() => setFilter("milestone")}
            >
              <Rocket size={12} style={{ marginRight: 5, verticalAlign: -1, color: "#c4b5fd" }} />
              {tr("Milestones", "Kilometre Taşı")}
            </button>
            <button
              className={`filter-chip ${showDone ? "filter-chip-active" : ""}`}
              onClick={() => setShowDone((v) => !v)}
              title={tr("Toggle done tasks", "Tamamlananları aç/kapat")}
            >
              <CheckCircle2 size={12} style={{ marginRight: 5, verticalAlign: -1, color: "#34d399" }} />
              {tr("Done", "Tamamlananlar")}
            </button>

            {/* Per-game multi-select dropdown. Trigger lives in the
                chip row; popover renders through a portal at <body> so
                it escapes the calendar header panel's `overflow:hidden`
                clipping (otherwise the menu got hidden behind the grid
                panel below). */}
            {filterableGames.length > 0 && (
              <>
                <button
                  ref={triggerRef}
                  type="button"
                  className={`filter-chip calendar-game-menu-trigger ${gameFilter.size > 0 ? "filter-chip-active" : ""}`}
                  onClick={() => setGameMenuOpen((o) => !o)}
                  title={tr("Filter by game", "Oyuna göre filtrele")}
                  aria-haspopup="listbox"
                  aria-expanded={gameMenuOpen}
                >
                  <Gamepad2 size={12} style={{ marginRight: 5, verticalAlign: -1, color: "#a5b4fc" }} />
                  {gameFilterLabel}
                  <ChevronDown
                    size={12}
                    style={{
                      marginLeft: 6,
                      verticalAlign: -1,
                      transform: gameMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.16s ease",
                    }}
                  />
                </button>
                {gameMenuOpen && menuPos && createPortal(
                  <div
                    ref={popoverRef}
                    className="calendar-game-menu-pop"
                    role="listbox"
                    style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
                  >
                    <button
                      type="button"
                      className={`calendar-game-menu-item ${gameFilter.size === 0 ? "calendar-game-menu-item-active" : ""}`}
                      onClick={() => { setGameFilter(new Set()); setGameMenuOpen(false); }}
                    >
                      <span className="calendar-game-menu-check">
                        {gameFilter.size === 0 && <Check size={12} />}
                      </span>
                      <span className="calendar-game-menu-label">{tr("All games", "Tüm oyunlar")}</span>
                    </button>
                    <div className="calendar-game-menu-divider" />
                    {filterableGames.map((g) => {
                      const on = gameFilter.has(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          className={`calendar-game-menu-item ${on ? "calendar-game-menu-item-active" : ""}`}
                          onClick={() => toggleGame(g.id)}
                          title={g.title}
                        >
                          <span className="calendar-game-menu-check">
                            {on && <Check size={12} />}
                          </span>
                          <span className="calendar-game-menu-label">{g.title}</span>
                        </button>
                      );
                    })}
                  </div>,
                  document.body,
                )}
              </>
            )}
          </div>
        </div>
      </motion.section>

      <motion.section
        className="panel calendar-grid-wrapper"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, delay: 0.05 } } }}
      >
        <div className="calendar-weekdays">
          {weekdayLabels.map((d, i) => (
            <div key={i} className="calendar-weekday">{d}</div>
          ))}
        </div>
        <div className="calendar-month-grid">
          {Array.from({ length: 6 }).map((_, weekIdx) => {
            const weekCells = cells.slice(weekIdx * 7, weekIdx * 7 + 7);
            const weekHasTasks = weekCells.some(
              (c) => (byIso.get(c.iso) ?? []).length > 0
            );
            return (
              <div
                key={`week-${weekIdx}`}
                className={`calendar-week-row${!weekHasTasks ? " calendar-week-empty" : ""}`}
              >
                {weekCells.map((cell) => {
                  const tasks = byIso.get(cell.iso) ?? [];
                  const milestone = tasks.some(isMilestone);
                  const urgent = tasks.some((t) => t.priority === 3);
                  return (
                    <div
                      key={cell.iso}
                      className={[
                        "calendar-cell",
                        cell.inMonth ? "" : "calendar-cell-out",
                        cell.isToday ? "calendar-cell-today" : "",
                        milestone ? "calendar-cell-milestone" : "",
                        urgent && !milestone ? "calendar-cell-urgent" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      <div className="calendar-cell-head">
                        <span className="calendar-cell-num">{cell.date.getDate()}</span>
                        {milestone && <Rocket size={12} className="calendar-cell-icon" />}
                      </div>
                      <div className="calendar-cell-list">
                        {tasks.slice(0, 3).map((t) => (
                          <button
                            key={t.id}
                            className={`calendar-task priority-${t.priority}`}
                            onClick={() => { setActiveTaskId(t.id); setWorkspaceTab("tasks"); }}
                            title={`${t.title} · ${t.gameTitle} · ${priorityLabel(t.priority, language)}`}
                          >
                            <span className="calendar-task-dot" />
                            <span className="calendar-task-title">{t.title}</span>
                          </button>
                        ))}
                        {tasks.length > 3 && (
                          <span className="calendar-task-overflow">+{tasks.length - 3}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!weekHasTasks && (
                  <span className="calendar-week-empty-hint">
                    {tr("No tasks planned this week", "Bu hafta planlı görev yok")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </motion.section>
    </motion.div>
  );
}
