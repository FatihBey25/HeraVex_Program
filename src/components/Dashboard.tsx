// HeraVex Dashboard (v0.9.7 rewrite).
//
// Three first-class content panels that the user expressly asked for:
//   1. recentGames  — last-updated games with progress
//   2. tasksAtRisk  — overdue, due-soon, and oldest pending
//   3. spendTrend   — last-7-day spend area chart (mirrors Wallet's style)
//
// Plus two carry-over panels (`overview`, `quickActions`) so power users
// don't lose the at-a-glance pie chart and the contextual suggestion
// strip. All five are toggleable AND drag-reorderable from Settings →
// Layout → Dashboard panels. The grid uses CSS `auto-fit` so hidden
// panels reflow space to the remaining cards — the dashboard never
// looks empty.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Gamepad2, ListTodo, CheckCircle2, AlertTriangle, CalendarClock,
  Hourglass, TrendingUp, Wallet as WalletIcon,
  Rocket, Clock, CalendarDays,
  Play, Pause, Plus, Target, Pin, ChevronRight,
} from "lucide-react";
import {
  PieChart, Pie, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { mountPluginWidgets, unmountPluginWidgets } from "../lib/plugins";
import { totalSharedSpendForGame } from "../lib/expenseAllocation";
import { useAppStore, selectAllTasks } from "../store";
import { calculateAccumulatedAmount } from "./PieChartWidget";
import { statusLabel, statusToneClass, priorityLabel, type AppLanguage } from "../lib/i18n";
import { imgSrc } from "../lib/images";
import { requestCreate } from "../lib/createIntents";
import { isGeneralGame } from "../lib/general-game";
import type { DashboardPanelId, DashboardPanelEntry, DashboardHeroCard } from "../lib/appearance";
import { usePomodoro, togglePomodoro, formatPomodoroTime } from "../lib/pomodoro";
import { loadPomodoroPrefs } from "../lib/preferences";
import { CustomWidgetPanel } from "./CustomWidgets";

const BAR_PALETTE = ["#4f8cff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#fb7185"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function usd(
  games: ReturnType<typeof useAppStore.getState>["games"],
  globalExpenses: ReturnType<typeof useAppStore.getState>["globalExpenses"],
  rates: Record<string, number>,
) {
  const rate = (currency: string) => rates[currency] ?? 1;
  const gameTotal = games.reduce(
    (s, g) => s + g.expenses.reduce((ss, e) => ss + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0),
    0,
  );
  const genTotal = globalExpenses.reduce(
    (s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")),
    0,
  );
  return { gameTotal, genTotal, total: gameTotal + genTotal };
}

function isThisMonth(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function progressColor(pct: number): string {
  if (pct <= 30) return "linear-gradient(90deg, #f87171, #fb923c)";
  if (pct <= 70) return "linear-gradient(90deg, #f59e0b, #fbbf24)";
  return "linear-gradient(90deg, #34d399, #10b981)";
}

/** Compact relative-time formatter — picks the largest unit and rounds
 *  down. "Today" reads better than "0d" / "now" for project rows. */
function relativeTime(iso: string, language: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const pick = (en: string, tr: string, fr: string, es: string) =>
    language === "tr" ? tr : language === "fr" ? fr : language === "es" ? es : en;
  if (days >= 30) {
    const m = Math.floor(days / 30);
    return pick(`${m}mo ago`, `${m} ay önce`, `il y a ${m} mois`, `hace ${m} mes${m > 1 ? "es" : ""}`);
  }
  if (days >= 1) return pick(`${days}d ago`, `${days} gün önce`, `il y a ${days}j`, `hace ${days}d`);
  if (hours >= 1) return pick(`${hours}h ago`, `${hours} saat önce`, `il y a ${hours}h`, `hace ${hours}h`);
  if (mins >= 1) return pick(`${mins}m ago`, `${mins} dk önce`, `il y a ${mins} min`, `hace ${mins} min`);
  return pick("just now", "az önce", "à l'instant", "ahora mismo");
}

// ── Dashboard root ───────────────────────────────────────────────────────────

export function Dashboard(_props: { onCreateGame: () => void }) {
  const {
    games: allGames, globalExpenses, exchangeRates, language,
    setWorkspaceTab, setActiveTaskId, setSelectedId, ui, layout, profile, experimental,
  } = useAppStore();

  // Strip the synthetic "General" marker from every visible list but
  // keep its tasks in `allTasks` so they still surface in the at-risk
  // panel — that's where general-bucket reminders are most useful.
  const games = useMemo(() => allGames.filter((g) => !isGeneralGame(g)), [allGames]);
  const allTasks = useMemo(() => selectAllTasks(allGames), [allGames]);

  // Hero stats
  const totalTaskCount = allTasks.length;
  const doneTaskCount = allTasks.filter((t) => t.done).length;
  const completedThisWeekCount = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return allTasks.reduce((n, t) => {
      if (!t.done || !t.completedAt) return n;
      const ts = Date.parse(t.completedAt);
      return Number.isFinite(ts) && ts >= cutoff ? n + 1 : n;
    }, 0);
  }, [allTasks]);

  // Hero greeting
  const hour = new Date().getHours();
  const timeOfDay = hour < 5  ? (language === "tr" ? "İyi geceler" : "Working late")
                  : hour < 12 ? (language === "tr" ? "Günaydın"   : "Good morning")
                  : hour < 18 ? (language === "tr" ? "İyi günler" : "Good afternoon")
                              : (language === "tr" ? "İyi akşamlar" : "Good evening");
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueTaskCount = allTasks.filter((t) => !t.done && t.dueDate && t.dueDate < todayIso).length;
  const urgentTaskCount = allTasks.filter((t) => !t.done && t.priority === 3).length;

  const headline = (() => {
    const pick = (en: string, tr: string, fr: string, es: string) =>
      language === "tr" ? tr : language === "fr" ? fr : language === "es" ? es : en;
    if (overdueTaskCount > 0) {
      const n = overdueTaskCount; const s = n > 1 ? "s" : "";
      return pick(
        `${n} overdue task${s} waiting on you`,
        `${n} gecikmiş görev seni bekliyor`,
        `${n} tâche${s} en retard vous attend${s ? "ent" : ""}`,
        `${n} tarea${s} atrasada${s} te espera${s ? "n" : ""}`,
      );
    }
    if (urgentTaskCount > 0) {
      const n = urgentTaskCount; const enTail = n > 1 ? "s are" : " is";
      return pick(
        `${n} urgent task${enTail} up next`,
        `${n} acil görev sırada`,
        `${n} tâche${n > 1 ? "s" : ""} urgente${n > 1 ? "s" : ""} en file`,
        `${n} tarea${n > 1 ? "s" : ""} urgente${n > 1 ? "s" : ""} en cola`,
      );
    }
    if (completedThisWeekCount > 0) {
      const n = completedThisWeekCount; const s = n > 1 ? "s" : "";
      return pick(
        `${n} task${s} closed this week — keep rolling`,
        `Bu hafta ${n} görev kapandı — iyi gidiyor`,
        `${n} tâche${s} bouclée${s} cette semaine — continue`,
        `${n} tarea${s} cerrada${s} esta semana — sigue así`,
      );
    }
    return pick(
      "All clear — go chase the next spark",
      "Önün açık — bir sonraki kıvılcımı yakala",
      "Tout est clair — file chasser la prochaine étincelle",
      "Todo despejado — ve a por la próxima chispa",
    );
  })();

  // Panel ordering & enabled state come from the persisted Layout slice.
  // We render Reorder.Group isn't used here (read-only on the dashboard
  // surface) — the order list is the source of truth, mutated only
  // through Settings.
  const panelOrder: DashboardPanelEntry[] = layout.dashboardWidgets.panels;

  // ── Hero detail bits (v0.9.7 fill-the-empty-space pass) ───────────
  //
  // Greeting with the user's first name, a date pill, a "currently
  // working on" card pointing at the most-active game this week, and
  // a 7-day completion sparkline. Every piece is computed cheaply
  // from data already in the store — no extra fetches.
  const firstName = (() => {
    const dn = (profile.displayName || "").trim();
    if (!dn) return "";
    return dn.split(/\s+/)[0] || "";
  })();
  const greeting = firstName ? `${timeOfDay}, ${firstName}` : timeOfDay;

  const localeForDate = language === "tr" ? "tr-TR"
                      : language === "fr" ? "fr-FR"
                      : language === "es" ? "es-ES" : "en-US";
  const datePill = (() => {
    const d = new Date();
    const weekday = d.toLocaleDateString(localeForDate, { weekday: "short" });
    const day = d.getDate();
    const month = d.toLocaleDateString(localeForDate, { month: "short" });
    return `${weekday} · ${day} ${month}`;
  })();

  const pickLang = (en: string, tr: string, fr: string, es: string) =>
    language === "tr" ? tr : language === "fr" ? fr : language === "es" ? es : en;

  // Studio report card metrics (v0.9.7).
  //
  // Compact "who am I in this workspace?" summary. Pulls from data
  // the user already maintains so the card never asks for new input:
  //   • Studio name + tagline from Studio Identity
  //   • Total games (after the General marker is stripped)
  //   • Shipped count (status "Yayinda" / "Yayina Hazir")
  //   • Focus hours = sum of task timeSpentSeconds, formatted h/m
  //   • Days active in this workspace = max signal we have
  const studioCard = useMemo(() => {
    const studioInfo = useAppStore.getState().studioIdentity;
    const teamSizeLabel = (() => {
      switch (studioInfo.teamSize) {
        case "solo": return pickLang("Solo dev", "Solo dev", "Dev solo", "Dev en solitario");
        case "2-5":  return pickLang("2-5 devs", "2-5 kişi", "2-5 devs", "2-5 devs");
        case "6-10": return pickLang("6-10 devs", "6-10 kişi", "6-10 devs", "6-10 devs");
        case "10+":  return pickLang("10+ devs", "10+ kişi", "10+ devs", "10+ devs");
      }
    })();

    const shippedCount = games.filter((g) => g.status === "Yayinda" || g.status === "Yayina Hazir").length;
    const focusSeconds = allTasks.reduce((s, t) => s + (t.timeSpentSeconds ?? 0), 0);
    const focusHours = Math.floor(focusSeconds / 3600);
    const focusMins = Math.floor((focusSeconds % 3600) / 60);
    const focusLabel = focusHours > 0 ? `${focusHours}h ${focusMins}m` : `${focusMins}m`;

    // Days active = max of studio "founded" date, earliest game touch, and
    // installation marker (localStorage). The MAX gives the most generous
    // signal; we don't want to under-count someone who set up their
    // studio in 2020 but only added their first game this week.
    const candidates: number[] = [];
    if (studioInfo.founded) {
      const t = Date.parse(studioInfo.founded);
      if (Number.isFinite(t)) candidates.push(t);
    }
    if (games.length > 0) {
      const earliest = games.reduce((acc, g) => {
        const t = Date.parse(g.updatedAt);
        return Number.isFinite(t) && (acc === 0 || t < acc) ? t : acc;
      }, 0);
      if (earliest > 0) candidates.push(earliest);
    }
    try {
      const raw = localStorage.getItem("heravex_first_seen_at");
      if (raw) {
        const t = Number(raw);
        if (Number.isFinite(t) && t > 0) candidates.push(t);
      } else {
        // First time we ever render this card → stamp now so we can
        // count from this day forward. The MAX rule above means the
        // stamp only "wins" when there's no game / no founding date.
        localStorage.setItem("heravex_first_seen_at", String(Date.now()));
      }
    } catch { /* localStorage unavailable */ }

    const oldestMs = candidates.length > 0 ? Math.min(...candidates) : Date.now();
    const days = Math.max(1, Math.floor((Date.now() - oldestMs) / (24 * 60 * 60 * 1000)));

    return {
      studioName: studioInfo.studioName.trim() || pickLang("Untitled Studio", "İsimsiz Stüdyo", "Studio sans nom", "Estudio sin nombre"),
      tagline: teamSizeLabel,
      logoPath: studioInfo.logoPath || "",
      gameCount: games.length,
      shippedCount,
      focusLabel,
      days,
    };
  }, [games, allTasks, language]);

  // ── Data for the other 7 hero card variants ───────────────────────
  //
  // Computed up-front (cheap, all derived from `allTasks` / `games`)
  // so the variant switch below is a pure render decision. The
  // Pomodoro hook is also called unconditionally because React forbids
  // conditional hooks; its tick rate (1Hz) is fine for an always-on
  // surface even when the chosen variant isn't pomodoro.
  const pomo = usePomodoro();

  const nextUpTask = useMemo(() => {
    const open = allTasks.filter((t) => !t.done);
    if (open.length === 0) return null;
    const t = new Date().toISOString().slice(0, 10);
    const overdue = open
      .filter((x) => x.dueDate && x.dueDate < t)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    if (overdue.length > 0) return { task: overdue[0], kind: "overdue" as const };
    const urg = open
      .filter((x) => x.priority === 3)
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
    if (urg.length > 0) return { task: urg[0], kind: "urgent" as const };
    const soon = open
      .filter((x) => x.dueDate)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    if (soon.length > 0) return { task: soon[0], kind: "soon" as const };
    return null;
  }, [allTasks]);

  // Closest release-like milestones — mirrors Calendar's keyword
  // detection. Returns the 3 next upcoming, oldest first.
  const releaseSoon = useMemo(() => {
    const RELEASE_KEYWORDS = [
      "build", "release", "launch", "yayın", "yayin", "surum", "sürüm", "version", "sortie",
    ];
    const today = new Date().toISOString().slice(0, 10);
    const isMilestone = (text: string) =>
      RELEASE_KEYWORDS.some((k) => text.toLowerCase().includes(k));
    return allTasks
      .filter((t) => !t.done && t.dueDate && t.dueDate >= today && isMilestone(`${t.title} ${t.description ?? ""}`))
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .slice(0, 3);
  }, [allTasks]);

  // Today's micro-stats: tasks closed today + focus seconds today.
  // Focus minutes are an approximation: sum the `timeSpentSeconds`
  // of tasks whose `completedAt` falls today (those got their final
  // timer flush) plus today's pomodoro completedFocusSessions × the
  // user's focus-minutes preference for any active timer state.
  const todayStats = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const closedToday = allTasks.filter(
      (t) => t.done && t.completedAt && (t.completedAt || "").slice(0, 10) === todayIso,
    );
    const focusSeconds = closedToday.reduce((s, t) => s + (t.timeSpentSeconds ?? 0), 0);
    const focusH = Math.floor(focusSeconds / 3600);
    const focusM = Math.floor((focusSeconds % 3600) / 60);
    const focusLabel = focusH > 0 ? `${focusH}h ${focusM}m` : `${focusM}m`;
    const dueToday = allTasks.filter(
      (t) => !t.done && (t.dueDate ?? "") === todayIso,
    ).length;
    return { closedCount: closedToday.length, focusLabel, dueToday };
  }, [allTasks]);

  // Recently-active games — auto-pinned shortcuts. Top 3 by updatedAt
  // descending, excluding the synthetic "General" marker (already
  // stripped in `games`). Click → opens the game in Library.
  const pinnedShortcuts = useMemo(
    () => [...games].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3),
    [games],
  );

  // Today's goal — persistent free-form text the user edits inline.
  // Keyed by date so a new day shows a blank slate (which the user
  // can leave blank or pre-fill).
  const todayKey = `heravex_today_goal_${new Date().toISOString().slice(0, 10)}`;
  const [todayGoal, setTodayGoal] = useState<string>(() => {
    try { return localStorage.getItem(todayKey) || ""; } catch { return ""; }
  });
  const commitTodayGoal = useCallback((value: string) => {
    setTodayGoal(value);
    try { localStorage.setItem(todayKey, value); } catch { /* quota */ }
  }, [todayKey]);

  // Quick capture state — small inline input that fires the existing
  // create-note / create-task events the rest of the app already
  // listens for. The chip toggle picks the kind.
  const [captureKind, setCaptureKind] = useState<"task" | "note">("task");
  const [captureText, setCaptureText] = useState("");
  const submitCapture = useCallback(() => {
    const text = captureText.trim();
    if (!text) return;
    // Pre-stamp the title on a custom event the destination page picks
    // up to prefill its creator. Matches how App.tsx already wires
    // `heravex:new-task` / `heravex:new-note`.
    setWorkspaceTab(captureKind === "task" ? "tasks" : "notes");
    requestCreate(captureKind, { title: text });
    setCaptureText("");
  }, [captureText, captureKind, setWorkspaceTab]);

  // Seven-day completion histogram. Bucketed by local-calendar day, ending
  // today. Heights are normalised against the day with the most closes
  // so even a 1-task day reads as a visible bar.
  const activity7 = useMemo(() => {
    const buckets: { iso: string; label: string; count: number }[] = [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(start);
      d.setDate(start.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      buckets.push({
        iso,
        label: d.toLocaleDateString(localeForDate, { weekday: "narrow" }),
        count: 0,
      });
    }
    for (const t of allTasks) {
      if (!t.done || !t.completedAt) continue;
      const iso = (new Date(t.completedAt).toISOString() || "").slice(0, 10);
      const b = buckets.find((x) => x.iso === iso);
      if (b) b.count++;
    }
    const max = Math.max(1, ...buckets.map((b) => b.count));
    const total = buckets.reduce((s, b) => s + b.count, 0);
    return { buckets, max, total };
  }, [allTasks, localeForDate]);

  return (
    <div key="dashboard" className="dashboard-wrapper page-fade">

      {/* Version-safe plugin slot at the top of the dashboard. Use
          hv.dom.mountToSlot("dashboard-top", el). */}
      <div data-hv-slot="dashboard-top" className="hv-slot hv-slot-block" />

      {/* Hero — always on. v0.9.7 compact rewrite: greeting, headline,
          a "next up" task card that points at the single most important
          thing to do right now, a date pill, and a tight 7-day
          completion sparkline. The whole surface is half the height of
          the previous version because the user asked for "küçültüp
          işimizi görelim" — same signal, less vertical real estate. */}
      <div className="dashboard-hero is-compact">
        <div className="dashboard-hero-left">
          <div className="dashboard-hero-text">
            <p className="dashboard-hero-eyebrow">
              <span>{greeting}</span>
              <span className="dashboard-hero-date-inline" title={new Date().toLocaleDateString(localeForDate, { dateStyle: "full" })}>
                · {datePill}
              </span>
            </p>
            <h1 className="dashboard-hero-title">{headline}</h1>
          </div>
          {/* Hero card router — user picks from Settings → Layout →
              Dashboard hero card. The chosen variant is rendered
              inline; choosing "none" hides the slot entirely (CSS
              also adjusts the hero grid in that case). */}
          {renderHeroCard(layout.dashboardHeroCard ?? "studioCard", {
            studioCard, nextUpTask, releaseSoon, todayStats,
            pinnedShortcuts, pomo, todayGoal,
            captureKind, captureText, setCaptureKind, setCaptureText,
            submitCapture, commitTodayGoal,
            language, pickLang,
            setWorkspaceTab, setActiveTaskId, setSelectedId,
          })}
        </div>

        <div className="dashboard-hero-right">
          <div className="dashboard-hero-activity">
            <div className="dashboard-hero-activity-head">
              <span className="dashboard-hero-activity-label">
                {pickLang("LAST 7 DAYS", "SON 7 GÜN", "7 DERNIERS JOURS", "ÚLTIMOS 7 DÍAS")}
              </span>
              <strong className="dashboard-hero-activity-total">{activity7.total}</strong>
            </div>
            <div className="dashboard-hero-activity-bars" role="img" aria-label={`${activity7.total} tasks closed in the last 7 days`}>
              {activity7.buckets.map((b, i) => {
                const h = Math.max(10, Math.round((b.count / activity7.max) * 100));
                return (
                  <div key={i} className="dashboard-hero-activity-col" title={`${b.iso}: ${b.count}`}>
                    <span
                      className={`dashboard-hero-activity-bar ${b.count > 0 ? "is-on" : "is-empty"}`}
                      style={{ height: `${h}%` }}
                    />
                    <span className="dashboard-hero-activity-tick">{b.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Hero stats — always on. */}
      <motion.section
        className="dashboard-hero-stats"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.07 } } }}
      >
        <HeroStat icon={Gamepad2}    label={ui.games}             value={games.length}                accent="#4f8cff" />
        <HeroStat icon={ListTodo}    label={ui.openTasks}         value={totalTaskCount - doneTaskCount} accent="#a78bfa" />
        <HeroStat icon={CheckCircle2} label={ui.completedThisWeek} value={completedThisWeekCount}     accent="#34d399"
                  subtext={completedThisWeekCount === 0 ? ui.noTasksCompletedThisWeek : undefined} />
      </motion.section>

      {/* Customizable panel grid — order + visibility driven by store. */}
      <div className="dashboard-grid">
        {/* Beta: the user's own widgets (Settings → Experimental). */}
        {experimental.betaEnabled && experimental.betaCustomWidgets &&
          experimental.customWidgets.map((w) => <CustomWidgetPanel key={w.id} widget={w} language={language} />)}
        {panelOrder.filter((p) => p.enabled).map((p) => (
          <PanelHost
            key={p.id}
            id={p.id}
            games={games}
            allTasks={allTasks}
            globalExpenses={globalExpenses}
            exchangeRates={exchangeRates}
            language={language}
            ui={ui}
            onGoToWallet={() => setWorkspaceTab("wallet")}
            onJumpToGame={(gameId) => { setSelectedId(gameId); setWorkspaceTab("library"); }}
            onJumpToTask={(taskId) => { setActiveTaskId(taskId); setWorkspaceTab("tasks"); }}
          />
        ))}
      </div>

      {/* Plugin slot — appended after the customizable grid so third-party
          widgets never get swallowed by an empty layout. */}
      <PluginSlot slot="dashboard" allGames={allGames} />
    </div>
  );
}

// ── Hero card router + 8 variants ─────────────────────────────────────────
//
// Each variant is a small inline render — they share enough structure
// to live next to each other but differ enough in interaction that a
// generic component would obscure intent. The router is a pure switch.

type HeroCardArgs = {
  studioCard: {
    studioName: string; tagline: string; logoPath: string;
    gameCount: number; shippedCount: number; focusLabel: string; days: number;
  };
  nextUpTask: { task: ReturnType<typeof selectAllTasks>[number]; kind: "overdue" | "urgent" | "soon" } | null;
  releaseSoon: ReturnType<typeof selectAllTasks>;
  todayStats: { closedCount: number; focusLabel: string; dueToday: number };
  pinnedShortcuts: ReturnType<typeof useAppStore.getState>["games"];
  pomo: ReturnType<typeof usePomodoro>;
  todayGoal: string;
  captureKind: "task" | "note";
  captureText: string;
  setCaptureKind: (k: "task" | "note") => void;
  setCaptureText: (s: string) => void;
  submitCapture: () => void;
  commitTodayGoal: (s: string) => void;
  language: string;
  pickLang: (en: string, tr: string, fr: string, es: string) => string;
  setWorkspaceTab: (t: import("../store").WorkspaceTab) => void;
  setActiveTaskId: (id: string) => void;
  setSelectedId: (id: string) => void;
};

function renderHeroCard(variant: DashboardHeroCard, a: HeroCardArgs): React.ReactNode {
  switch (variant) {
    case "none": return null;
    case "studioCard": return <StudioHeroCard {...a} />;
    case "sirada":     return <NextUpHeroCard {...a} />;
    case "pomodoro":   return <PomodoroHeroCard {...a} />;
    case "quickCapture":      return <QuickCaptureHeroCard {...a} />;
    case "releaseCountdown":  return <ReleaseCountdownHeroCard {...a} />;
    case "todayMicro":        return <TodayMicroHeroCard {...a} />;
    case "todayGoal":         return <TodayGoalHeroCard {...a} />;
    case "pinnedShortcuts":   return <PinnedShortcutsHeroCard {...a} />;
  }
}

function StudioHeroCard({ studioCard, pickLang, setWorkspaceTab }: HeroCardArgs) {
  return (
    <button
      type="button"
      className="dashboard-hero-studio"
      onClick={() => setWorkspaceTab("profile")}
      title={pickLang("Open Studio settings", "Stüdyo ayarlarını aç", "Ouvrir les paramètres du studio", "Abrir ajustes del estudio")}
    >
      {studioCard.logoPath ? (
        <img src={imgSrc(studioCard.logoPath)} alt="" className="dashboard-hero-studio-logo" />
      ) : (
        <span className="dashboard-hero-studio-logo dashboard-hero-studio-logo-placeholder">
          {studioCard.studioName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="dashboard-hero-studio-body">
        <div className="dashboard-hero-studio-head">
          <strong className="dashboard-hero-studio-name">{studioCard.studioName}</strong>
          <span className="dashboard-hero-studio-tag">{studioCard.tagline}</span>
        </div>
        <div className="dashboard-hero-studio-stats">
          <div className="dashboard-hero-studio-stat">
            <Gamepad2 size={11} /><strong>{studioCard.gameCount}</strong>
            <span>{pickLang("games", "oyun", "jeux", "juegos")}</span>
          </div>
          <div className="dashboard-hero-studio-stat">
            <Rocket size={11} /><strong>{studioCard.shippedCount}</strong>
            <span>{pickLang("shipped", "yayında", "publié", "publicado")}</span>
          </div>
          <div className="dashboard-hero-studio-stat">
            <Clock size={11} /><strong>{studioCard.focusLabel}</strong>
            <span>{pickLang("focus", "odak", "focus", "foco")}</span>
          </div>
          <div className="dashboard-hero-studio-stat">
            <CalendarDays size={11} /><strong>{studioCard.days}</strong>
            <span>{pickLang(studioCard.days === 1 ? "day" : "days", "gün", "jours", "días")}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function NextUpHeroCard({ nextUpTask, pickLang, setWorkspaceTab, setActiveTaskId }: HeroCardArgs) {
  if (!nextUpTask) {
    return (
      <div className="dashboard-hero-pill dashboard-hero-pill-success">
        <CheckCircle2 size={14} />
        <span>{pickLang("Inbox zero — nothing pending.", "Sıra boş — bekleyen yok.", "Boîte vide — rien d'urgent.", "Bandeja vacía — nada pendiente.")}</span>
      </div>
    );
  }
  const t = nextUpTask.task;
  return (
    <button
      type="button"
      className={`dashboard-hero-nextup tone-${nextUpTask.kind}`}
      onClick={() => { setActiveTaskId(t.id); setWorkspaceTab("tasks"); }}
      title={t.title}
    >
      <span className={`dashboard-hero-nextup-dot dot-${nextUpTask.kind}`} aria-hidden="true" />
      <div className="dashboard-hero-nextup-body">
        <span className="dashboard-hero-nextup-label">
          {nextUpTask.kind === "overdue" ? pickLang("NEXT UP · OVERDUE", "SIRADA · GECİKMİŞ", "PRIORITÉ · EN RETARD", "SIGUIENTE · ATRASADA")
            : nextUpTask.kind === "urgent" ? pickLang("NEXT UP · URGENT", "SIRADA · ACİL", "PRIORITÉ · URGENT", "SIGUIENTE · URGENTE")
            : pickLang("NEXT UP", "SIRADA", "PROCHAINE", "SIGUIENTE")}
        </span>
        <strong>{t.title}</strong>
        <span className="dashboard-hero-nextup-meta">
          {t.gameTitle}{t.dueDate ? ` · ${t.dueDate}` : ""}
        </span>
      </div>
      <ChevronRight size={14} className="dashboard-hero-nextup-chev" />
    </button>
  );
}

function PomodoroHeroCard({ pomo, pickLang }: HeroCardArgs) {
  const prefs = loadPomodoroPrefs();
  const phaseLabel = pomo.phase === "focus"
    ? pickLang("FOCUS", "ODAK", "FOCUS", "FOCO")
    : pomo.phase === "shortBreak"
    ? pickLang("SHORT BREAK", "KISA MOLA", "PETITE PAUSE", "PAUSA CORTA")
    : pickLang("LONG BREAK", "UZUN MOLA", "GRANDE PAUSE", "PAUSA LARGA");
  return (
    <button
      type="button"
      className={`dashboard-hero-pomo phase-${pomo.phase} ${pomo.running ? "is-running" : "is-paused"}`}
      onClick={() => togglePomodoro()}
      title={pickLang("Toggle session (Ctrl+Space)", "Oturumu başlat/durdur (Ctrl+Space)", "Démarrer/arrêter (Ctrl+Space)", "Iniciar/pausar (Ctrl+Space)")}
    >
      <span className="dashboard-hero-pomo-icon">
        {pomo.running ? <Pause size={18} /> : <Play size={18} />}
      </span>
      <div className="dashboard-hero-pomo-body">
        <span className="dashboard-hero-pomo-label">{phaseLabel}</span>
        <strong className="dashboard-hero-pomo-time">{formatPomodoroTime(pomo.remainingSeconds)}</strong>
        <span className="dashboard-hero-pomo-sub">
          {pickLang(
            `${pomo.completedFocusSessions} of ${prefs.longBreakCadence} sessions to long break`,
            `Uzun molaya ${prefs.longBreakCadence - pomo.completedFocusSessions} odak kaldı`,
            `${prefs.longBreakCadence - pomo.completedFocusSessions} sessions avant la grande pause`,
            `${prefs.longBreakCadence - pomo.completedFocusSessions} sesiones para pausa larga`,
          )}
        </span>
      </div>
    </button>
  );
}

function QuickCaptureHeroCard({
  captureKind, captureText, setCaptureKind, setCaptureText, submitCapture, pickLang,
}: HeroCardArgs) {
  return (
    <div className="dashboard-hero-capture">
      <div className="dashboard-hero-capture-kind">
        <button
          type="button"
          className={`dashboard-hero-capture-kind-btn ${captureKind === "task" ? "is-active" : ""}`}
          onClick={() => setCaptureKind("task")}
        >
          <ListTodo size={11} />{pickLang("Task", "Görev", "Tâche", "Tarea")}
        </button>
        <button
          type="button"
          className={`dashboard-hero-capture-kind-btn ${captureKind === "note" ? "is-active" : ""}`}
          onClick={() => setCaptureKind("note")}
        >
          <Pin size={11} />{pickLang("Note", "Not", "Note", "Nota")}
        </button>
      </div>
      <input
        type="text"
        className="dashboard-hero-capture-input"
        placeholder={pickLang("What's on your mind?", "Aklındaki ne?", "Quoi de neuf ?", "¿Qué tienes en mente?")}
        value={captureText}
        onChange={(e) => setCaptureText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submitCapture(); }}
      />
      <button
        type="button"
        className="dashboard-hero-capture-submit"
        onClick={submitCapture}
        disabled={!captureText.trim()}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function ReleaseCountdownHeroCard({ releaseSoon, pickLang, setActiveTaskId, setWorkspaceTab }: HeroCardArgs) {
  if (releaseSoon.length === 0) {
    return (
      <div className="dashboard-hero-pill">
        <Rocket size={12} />
        <span>{pickLang("No release-tagged milestones planned.", "Planlı yayın görevi yok.", "Aucune sortie planifiée.", "Sin lanzamientos planificados.")}</span>
      </div>
    );
  }
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  return (
    <div className="dashboard-hero-release">
      <span className="dashboard-hero-release-label">
        <Rocket size={11} />{pickLang("UPCOMING RELEASES", "YAKLAŞAN YAYINLAR", "PROCHAINES SORTIES", "PRÓXIMOS LANZAMIENTOS")}
      </span>
      <div className="dashboard-hero-release-list">
        {releaseSoon.map((t) => {
          const due = Date.parse(t.dueDate ?? "");
          const days = Number.isFinite(due) ? Math.max(0, Math.round((due - today) / 86_400_000)) : 0;
          return (
            <button
              key={t.id}
              type="button"
              className="dashboard-hero-release-row"
              onClick={() => { setActiveTaskId(t.id); setWorkspaceTab("tasks"); }}
              title={t.title}
            >
              <span className="dashboard-hero-release-days"><strong>{days}</strong>{pickLang("d", "g", "j", "d")}</span>
              <span className="dashboard-hero-release-title">{t.title}</span>
              <span className="dashboard-hero-release-game">{t.gameTitle}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TodayMicroHeroCard({ todayStats, pickLang }: HeroCardArgs) {
  return (
    <div className="dashboard-hero-micro">
      <span className="dashboard-hero-micro-label">
        {pickLang("TODAY", "BUGÜN", "AUJOURD'HUI", "HOY")}
      </span>
      <div className="dashboard-hero-micro-stats">
        <div className="dashboard-hero-micro-stat">
          <CheckCircle2 size={14} />
          <strong>{todayStats.closedCount}</strong>
          <span>{pickLang("closed", "kapandı", "fermées", "cerradas")}</span>
        </div>
        <div className="dashboard-hero-micro-stat">
          <Clock size={14} />
          <strong>{todayStats.focusLabel}</strong>
          <span>{pickLang("focus", "odak", "focus", "foco")}</span>
        </div>
        <div className="dashboard-hero-micro-stat">
          <CalendarClock size={14} />
          <strong>{todayStats.dueToday}</strong>
          <span>{pickLang("due", "bugün due", "à faire", "vencen")}</span>
        </div>
      </div>
    </div>
  );
}

function TodayGoalHeroCard({ todayGoal, commitTodayGoal, pickLang }: HeroCardArgs) {
  const [local, setLocal] = useState(todayGoal);
  useEffect(() => setLocal(todayGoal), [todayGoal]);
  return (
    <div className="dashboard-hero-goal">
      <span className="dashboard-hero-goal-label">
        <Target size={11} />{pickLang("TODAY I WANT TO", "BUGÜN", "AUJOURD'HUI JE VEUX", "HOY QUIERO")}
      </span>
      <input
        type="text"
        className="dashboard-hero-goal-input"
        placeholder={pickLang(
          "ship the boss fight, fix bugs, …",
          "boss kavgasını yayınlamak, bug fix, …",
          "publier le boss, corriger des bugs, …",
          "publicar el jefe, arreglar bugs, …",
        )}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => commitTodayGoal(local)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </div>
  );
}

function PinnedShortcutsHeroCard({ pinnedShortcuts, pickLang, setSelectedId, setWorkspaceTab }: HeroCardArgs) {
  if (pinnedShortcuts.length === 0) {
    return (
      <div className="dashboard-hero-pill">
        <Pin size={12} />
        <span>{pickLang("No games yet.", "Henüz oyun yok.", "Aucun jeu pour l'instant.", "Aún no hay juegos.")}</span>
      </div>
    );
  }
  return (
    <div className="dashboard-hero-pins">
      <span className="dashboard-hero-pins-label">
        <Pin size={11} />{pickLang("RECENT GAMES", "SON OYUNLAR", "JEUX RÉCENTS", "JUEGOS RECIENTES")}
      </span>
      <div className="dashboard-hero-pins-list">
        {pinnedShortcuts.map((g) => (
          <button
            key={g.id}
            type="button"
            className="dashboard-hero-pin"
            onClick={() => { setSelectedId(g.id); setWorkspaceTab("library"); }}
            title={g.title}
          >
            {g.coverDataUrl
              ? <img src={imgSrc(g.coverDataUrl)} alt="" className="dashboard-hero-pin-thumb" />
              : <span className="dashboard-hero-pin-thumb dashboard-hero-pin-placeholder">{g.title.slice(0, 1)}</span>}
            <span className="dashboard-hero-pin-name">{g.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Panel router ─────────────────────────────────────────────────────────────

type PanelHostProps = {
  id: DashboardPanelId;
  games: ReturnType<typeof useAppStore.getState>["games"];
  allTasks: ReturnType<typeof selectAllTasks>;
  globalExpenses: ReturnType<typeof useAppStore.getState>["globalExpenses"];
  exchangeRates: Record<string, number>;
  language: string;
  ui: ReturnType<typeof useAppStore.getState>["ui"];
  onGoToWallet: () => void;
  onJumpToGame: (id: string) => void;
  onJumpToTask: (id: string) => void;
};

function PanelHost(p: PanelHostProps) {
  switch (p.id) {
    case "recentGames":  return <RecentGamesPanel {...p} />;
    case "tasksAtRisk":  return <TasksAtRiskPanel {...p} />;
    case "spendTrend":   return <SpendTrendPanel {...p} />;
    case "overview":     return <OverviewPanel {...p} />;
  }
}

// ── Panel: Recent games ──────────────────────────────────────────────────────

function RecentGamesPanel(p: PanelHostProps) {
  const recent = useMemo(
    () => [...p.games].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    [p.games],
  );
  const pick = (en: string, tr: string, fr: string, es: string) =>
    p.language === "tr" ? tr : p.language === "fr" ? fr : p.language === "es" ? es : en;
  return (
    <motion.section
      className="panel dashboard-panel panel-recent-games"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="dashboard-panel-head">
        <div className="dashboard-panel-head-icon" style={{ "--ph-accent": "#4f8cff" } as React.CSSProperties}>
          <Gamepad2 size={16} />
        </div>
        <div>
          <p className="eyebrow">{pick("RECENTLY UPDATED", "SON GÜNCELLENEN", "RÉCEMMENT MIS À JOUR", "RECIENTEMENTE ACTUALIZADOS")}</p>
          <h3>{pick("Games", "Oyunlar", "Jeux", "Juegos")}</h3>
        </div>
      </div>
      <div className="dashboard-panel-body stack-list">
        {recent.map((g) => {
          const total = g.tasks.length;
          const done = g.tasks.filter((t) => t.done).length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <button
              key={g.id}
              className="dashboard-game-row"
              onClick={() => p.onJumpToGame(g.id)}
              title={g.title}
            >
              <div className="dashboard-game-row-left">
                {g.coverDataUrl ? (
                  <img src={imgSrc(g.coverDataUrl)} alt={g.title} className="dashboard-thumb" />
                ) : (
                  <div className="cover-placeholder mini">{g.title.slice(0, 1)}</div>
                )}
                <div className="game-row-body">
                  <div className="game-row-top">
                    <strong className="game-row-title">{g.title}</strong>
                    <span className={`status-tag compact-tag ${statusToneClass(g.status)}`}>
                      {statusLabel(p.language as AppLanguage, g.status)}
                    </span>
                  </div>
                  <p className="game-row-meta">
                    <span className="game-row-time">{relativeTime(g.updatedAt, p.language)}</span>
                    {total > 0 && (
                      <span className="game-row-task-count">
                        · {done}/{total} {pick("tasks", "görev", "tâches", "tareas")}
                      </span>
                    )}
                  </p>
                  {total > 0 && (
                    <div className="dash-progress-wrap">
                      <div className="dash-progress-track">
                        <div className="dash-progress-fill" style={{ width: `${pct}%`, background: progressColor(pct) }} />
                      </div>
                      <span className="dash-progress-pct">{pct}%</span>
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {recent.length === 0 && (
          <div className="empty-inline-state">
            {pick("No games yet.", "Henüz oyun yok.", "Aucun jeu pour l'instant.", "Aún no hay juegos.")}
          </div>
        )}
      </div>
    </motion.section>
  );
}

// ── Panel: Tasks at risk ─────────────────────────────────────────────────────

function TasksAtRiskPanel(p: PanelHostProps) {
  const pick = (en: string, tr: string, fr: string, es: string) =>
    p.language === "tr" ? tr : p.language === "fr" ? fr : p.language === "es" ? es : en;
  const todayIso = new Date().toISOString().slice(0, 10);
  const in7Iso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { overdue, soon, oldest } = useMemo(() => {
    const open = p.allTasks.filter((t) => !t.done);
    const overdue = open
      .filter((t) => t.dueDate && t.dueDate < todayIso)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .slice(0, 6);
    const soon = open
      .filter((t) => t.dueDate && t.dueDate >= todayIso && t.dueDate <= in7Iso)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .slice(0, 6);
    // "Oldest pending" — tasks without a due date, the kind that
    // languish at the bottom of inboxes. Schema has no createdAt
    // field on TaskItem, so we order by priority desc (highest first)
    // as the next-best signal that surfaces the ones the user
    // actually intended to land soon.
    const oldest = open
      .filter((t) => !t.dueDate)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .slice(0, 4);
    return { overdue, soon, oldest };
  }, [p.allTasks, todayIso, in7Iso]);

  const dueChip = (iso: string): { label: string; tone: "overdue" | "soon" | "later" } => {
    const d = Math.floor((Date.parse(iso) - Date.parse(todayIso)) / 86_400_000);
    if (d < 0) {
      const n = Math.abs(d);
      return {
        label: pick(`${n}d late`, `${n} gün geç`, `${n}j de retard`, `${n}d tarde`),
        tone: "overdue",
      };
    }
    if (d === 0) return { label: pick("today", "bugün", "aujourd'hui", "hoy"), tone: "soon" };
    if (d <= 3)  return { label: pick(`in ${d}d`, `${d} gün`, `dans ${d}j`, `en ${d}d`), tone: "soon" };
    return { label: pick(`in ${d}d`, `${d} gün`, `dans ${d}j`, `en ${d}d`), tone: "later" };
  };

  const empty = overdue.length === 0 && soon.length === 0 && oldest.length === 0;

  return (
    <motion.section
      className="panel dashboard-panel panel-tasks-at-risk"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.04 }}
    >
      <div className="dashboard-panel-head">
        <div className="dashboard-panel-head-icon" style={{ "--ph-accent": "#f87171" } as React.CSSProperties}>
          <AlertTriangle size={16} />
        </div>
        <div>
          <p className="eyebrow">{pick("AT RISK", "RİSKLİ", "À RISQUE", "EN RIESGO")}</p>
          <h3>{pick("Tasks to clear", "Temizlenecek görevler", "Tâches à boucler", "Tareas a cerrar")}</h3>
        </div>
      </div>
      <div className="dashboard-panel-body">
        {empty && (
          <div className="empty-inline-state">
            {pick("Inbox zero — nice.", "Sıfır kuyruk — temiz.", "Boîte vide — bravo.", "Bandeja vacía — bien.")}
          </div>
        )}
        {overdue.length > 0 && (
          <RiskGroup
            title={pick("Overdue", "Gecikmiş", "En retard", "Atrasadas")}
            icon={<AlertTriangle size={11} />}
            tone="overdue"
            tasks={overdue.map((t) => ({ task: t, chip: t.dueDate ? dueChip(t.dueDate) : undefined }))}
            language={p.language}
            onJumpToTask={p.onJumpToTask}
          />
        )}
        {soon.length > 0 && (
          <RiskGroup
            title={pick("Due soon", "Yakında", "Bientôt", "Pronto")}
            icon={<CalendarClock size={11} />}
            tone="soon"
            tasks={soon.map((t) => ({ task: t, chip: t.dueDate ? dueChip(t.dueDate) : undefined }))}
            language={p.language}
            onJumpToTask={p.onJumpToTask}
          />
        )}
        {oldest.length > 0 && (
          <RiskGroup
            title={pick("Oldest pending", "En eski bekleyenler", "Plus anciennes", "Más antiguas pendientes")}
            icon={<Hourglass size={11} />}
            tone="later"
            tasks={oldest.map((t) => ({ task: t }))}
            language={p.language}
            onJumpToTask={p.onJumpToTask}
          />
        )}
      </div>
    </motion.section>
  );
}

type RiskTone = "overdue" | "soon" | "later";

function RiskGroup({
  title, icon, tone, tasks, language, onJumpToTask,
}: {
  title: string;
  icon: React.ReactNode;
  tone: RiskTone;
  tasks: { task: ReturnType<typeof selectAllTasks>[number]; chip?: { label: string; tone: RiskTone } }[];
  language: string;
  onJumpToTask: (id: string) => void;
}) {
  return (
    <div className={`risk-group risk-group-${tone}`}>
      <p className="risk-group-head">
        <span className="risk-group-icon">{icon}</span>
        {title}
        <span className="risk-group-count">{tasks.length}</span>
      </p>
      <div className="risk-task-list">
        {tasks.map(({ task: t, chip }) => (
          <button
            key={t.id}
            className="risk-task-row"
            onClick={() => onJumpToTask(t.id)}
            title={t.title}
          >
            <span className={`risk-dot risk-dot-priority-${t.priority}`} aria-hidden="true" />
            <span className="risk-task-body">
              <span className="risk-task-title">{t.title}</span>
              <span className="risk-task-meta">
                <span className="risk-task-game">{t.gameTitle}</span>
                <span className="risk-task-priority">{priorityLabel(t.priority, language as AppLanguage)}</span>
              </span>
            </span>
            {chip && (
              <span className={`risk-task-chip risk-task-chip-${chip.tone}`}>{chip.label}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Panel: 7-day spend trend ────────────────────────────────────────────────

function SpendTrendPanel(p: PanelHostProps) {
  const pick = (en: string, tr: string, fr: string, es: string) =>
    p.language === "tr" ? tr : p.language === "fr" ? fr : p.language === "es" ? es : en;
  const monthShort = (() => {
    return p.language === "tr"
      ? ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"]
      : p.language === "fr"
      ? ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."]
      : p.language === "es"
      ? ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]
      : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  })();
  const rate = (c: string) => p.exchangeRates[c] ?? 1;

  // Build seven daily buckets ending today. Each bucket holds the USD
  // sum of expenses dated to that day (calendar-day in local time).
  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const buckets: { iso: string; label: string; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(start);
      d.setDate(start.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      buckets.push({ iso, label: `${d.getDate()} ${monthShort[d.getMonth()]}`, amount: 0 });
    }
    const addExpense = (e: { spentAt: string; amount: number; currency?: string; isRecurring?: boolean }) => {
      const iso = (e.spentAt || "").slice(0, 10);
      const b = buckets.find((x) => x.iso === iso);
      if (b) b.amount += calculateAccumulatedAmount(e as Parameters<typeof calculateAccumulatedAmount>[0], rate(e.currency ?? "USD"));
    };
    p.globalExpenses.forEach(addExpense);
    p.games.forEach((g) => (g.expenses ?? []).forEach(addExpense));
    return buckets.map((b) => ({ ...b, amount: Number(b.amount.toFixed(2)) }));
  }, [p.games, p.globalExpenses, p.exchangeRates, monthShort]);

  const total7 = days.reduce((s, d) => s + d.amount, 0);
  // Compare against the prior 7-day window to give the user a directional cue.
  const prior7 = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 13);
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const allExp = [...p.globalExpenses, ...p.games.flatMap((g) => g.expenses ?? [])];
      for (const e of allExp) {
        if ((e.spentAt || "").slice(0, 10) === iso) {
          total += calculateAccumulatedAmount(e, rate(e.currency ?? "USD"));
        }
      }
    }
    return total;
  }, [p.games, p.globalExpenses, p.exchangeRates]);
  const delta = prior7 === 0 ? null : ((total7 - prior7) / prior7) * 100;
  const deltaLabel = delta == null
    ? "—"
    : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} ${Math.abs(delta).toFixed(1)}%`;
  const deltaColor = delta == null ? "#94a3b8" : delta > 0 ? "#f87171" : delta < 0 ? "#34d399" : "#94a3b8";

  return (
    <motion.section
      className="panel dashboard-panel panel-spend-trend"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.06 }}
    >
      <div className="dashboard-panel-head">
        <div className="dashboard-panel-head-icon" style={{ "--ph-accent": "#34d399" } as React.CSSProperties}>
          <TrendingUp size={16} />
        </div>
        <div>
          <p className="eyebrow">{pick("LAST 7 DAYS", "SON 7 GÜN", "7 DERNIERS JOURS", "ÚLTIMOS 7 DÍAS")}</p>
          <h3>{pick("Spending", "Harcama", "Dépenses", "Gastos")}</h3>
        </div>
        <div className="spend-trend-totals">
          <strong className="spend-trend-total">${total7.toFixed(2)}</strong>
          <small className="spend-trend-delta" style={{ color: deltaColor }}>
            {deltaLabel} <span>{pick("vs prior 7d", "önceki 7 güne göre", "vs 7j précédents", "vs 7d previos")}</span>
          </small>
        </div>
      </div>
      <div className="dashboard-panel-body spend-trend-chart-wrap">
        {total7 === 0 && prior7 === 0 ? (
          <div className="empty-inline-state">
            {pick("No spend this week.", "Bu hafta harcama yok.", "Aucune dépense cette semaine.", "Sin gastos esta semana.")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={days} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="spend7-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#34d399" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} stroke="rgba(255,255,255,0.08)" interval={0} />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                stroke="rgba(255,255,255,0.08)"
                tickFormatter={(v) => `$${Math.round(Number(v)).toLocaleString()}`}
                width={56}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(15, 22, 36, 0.96)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 10,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                formatter={(v) => {
                  const n = typeof v === "number" ? v : Number(v ?? 0);
                  return [`$${(Number.isFinite(n) ? n : 0).toFixed(2)}`, pick("Spend", "Harcama", "Dépenses", "Gasto")];
                }}
              />
              <Area type="monotone" dataKey="amount" stroke="#34d399" strokeWidth={2} fill="url(#spend7-grad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </motion.section>
  );
}

// ── Panel: Overview (legacy metrics + spend-by-project pie) ─────────────────

function OverviewPanel(p: PanelHostProps) {
  const pick = (en: string, tr: string, fr: string, es: string) =>
    p.language === "tr" ? tr : p.language === "fr" ? fr : p.language === "es" ? es : en;
  const { total: totalSpend } = useMemo(
    () => usd(p.games, p.globalExpenses, p.exchangeRates),
    [p.games, p.globalExpenses, p.exchangeRates],
  );
  const thisMonthSpend = useMemo(() => {
    const rate = (c: string) => p.exchangeRates[c] ?? 1;
    const g = p.games.reduce(
      (s, game) =>
        s + game.expenses.filter((e) => isThisMonth(e.spentAt))
          .reduce((ss, e) => ss + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0),
      0,
    );
    const gen = p.globalExpenses.filter((e) => isThisMonth(e.spentAt))
      .reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0);
    return g + gen;
  }, [p.games, p.globalExpenses, p.exchangeRates]);
  const totalTaskCount = p.allTasks.length;
  const doneTaskCount = p.allTasks.filter((t) => t.done).length;
  const completionPct = totalTaskCount > 0 ? Math.round((doneTaskCount / totalTaskCount) * 100) : null;
  const activeGameCount = p.games.filter((g) =>
    ["Fikir", "Prototip", "Demo", "Alpha", "Beta"].includes(g.status),
  ).length;

  const barData = useMemo(() => {
    const rate = (c: string) => p.exchangeRates[c] ?? 1;
    return [
      ...p.games.map((g) => ({
        name: g.title.length > 14 ? g.title.slice(0, 13) + "…" : g.title,
        fullName: g.title,
        amount:
          g.expenses.reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0)
          + totalSharedSpendForGame(p.globalExpenses, g.id, rate),
      })),
      {
        name: pick("General", "Genel", "Général", "General"),
        fullName: pick("General Expenses", "Genel Giderler", "Dépenses générales", "Gastos generales"),
        amount: p.globalExpenses.reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0),
      },
    ].filter((d) => d.amount > 0).sort((a, b) => b.amount - a.amount);
  }, [p.games, p.globalExpenses, p.exchangeRates, p.language]);
  const barTotal = useMemo(() => barData.reduce((s, d) => s + d.amount, 0), [barData]);
  const fmt = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`);

  return (
    <motion.section
      className="panel dashboard-panel panel-overview"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.08 }}
    >
      <div className="dashboard-panel-head">
        <div className="dashboard-panel-head-icon" style={{ "--ph-accent": "#a78bfa" } as React.CSSProperties}>
          <WalletIcon size={16} />
        </div>
        <div>
          <p className="eyebrow">{pick("OVERVIEW", "GENEL BAKIŞ", "VUE D'ENSEMBLE", "RESUMEN")}</p>
          <h3>{pick("Numbers & split", "Sayılar ve dağılım", "Chiffres & répartition", "Cifras y reparto")}</h3>
        </div>
      </div>
      <div className="dashboard-panel-body">
        <div className="dashboard-stats">
          <MetricCard label={pick("Total Spend", "Toplam Harcama", "Dépense totale", "Gasto total")} value={fmt(totalSpend)} accent="#4f8cff" />
          <MetricCard label={pick("This Month", "Bu Ay", "Ce mois", "Este mes")} value={fmt(thisMonthSpend)} accent="#a78bfa" />
          <MetricCard label={pick("Done Rate", "Tamamlanma", "Avancement", "Completado")} value={completionPct !== null ? `${completionPct}%` : "—"} accent="#34d399" />
          <MetricCard label={pick("Active Games", "Aktif Oyun", "Jeux actifs", "Juegos activos")} value={String(activeGameCount)} accent="#f59e0b" />
        </div>
        <div className="chart-section">
          <p className="chart-label eyebrow">{pick("SPEND BY PROJECT", "PROJE BAZLI HARCAMA", "DÉPENSE PAR PROJET", "GASTO POR PROYECTO")}</p>
          {barData.length > 0 ? (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={barData} dataKey="amount" nameKey="fullName" cx="50%" cy="50%" innerRadius={48} outerRadius={82} paddingAngle={2} stroke="rgba(15, 22, 36, 0.6)" strokeWidth={2}>
                    {barData.map((_, i) => (
                      <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]} fillOpacity={0.92} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "#1e293b", color: "#f8fafc", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", fontSize: "12px", padding: "8px 12px" }}
                    itemStyle={{ color: "#cbd5e1" }}
                    labelStyle={{ color: "#f8fafc", fontWeight: 700, marginBottom: 4 }}
                    formatter={(val, _name, item) => {
                      const amount = Number(val);
                      const pctTip = barTotal > 0 ? ((amount / barTotal) * 100).toFixed(1) : "0.0";
                      const label = (item?.payload as { fullName?: string } | undefined)?.fullName ?? String(_name ?? "");
                      return [`$${amount.toFixed(2)}  (${pctTip}%)`, label];
                    }}
                  />
                  <Legend verticalAlign="bottom" align="center" iconType="circle" formatter={(value) => (
                    <span style={{ color: "#cbd5e1", fontSize: 11 }}>{value}</span>
                  )} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="chart-empty-state">
              <p className="chart-empty-hint">
                {pick("No expenses yet. Add your first in Wallet →", "Henüz harcama yok. Cüzdan'dan ilk gideri ekle →", "Aucune dépense. Ajoutez la première dans Wallet →", "Aún no hay gastos. Añade el primero en Wallet →")}
              </p>
              <button className="chart-empty-btn" onClick={p.onGoToWallet}>
                {pick("Go to Wallet", "Cüzdan'a Git", "Aller à Wallet", "Ir a Wallet")}
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}

// ── Shared: hero stat + metric card + plugin slot ───────────────────────────

function HeroStat({
  icon: Icon, label, value, accent, subtext,
}: {
  icon: typeof Gamepad2;
  label: string;
  value: number;
  accent: string;
  subtext?: string;
}) {
  return (
    <motion.div
      className="hero-stat-card"
      variants={{
        hidden: { opacity: 0, y: 14 },
        show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 1, 0.5, 1] } },
      }}
      style={{ "--hero-accent": accent } as React.CSSProperties}
    >
      <div className="hero-stat-icon"><Icon size={22} strokeWidth={2} /></div>
      <div className="hero-stat-body">
        <span className="hero-stat-label">{label}</span>
        <strong className="hero-stat-value">{value}</strong>
        {subtext && <span className="hero-stat-subtext">{subtext}</span>}
      </div>
      <div className="hero-stat-bar" />
    </motion.div>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="metric-card" style={{ "--metric-accent": accent } as React.CSSProperties}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <div className="metric-bar" />
    </div>
  );
}

function PluginSlot({ slot, allGames }: { slot: "dashboard"; allGames: ReturnType<typeof useAppStore.getState>["games"] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { showToast } = useAppStore.getState();
  useEffect(() => {
    let active = true;
    const ctx = {
      apiVersion: 1 as const,
      games: allGames.map((g) => ({ id: g.id, title: g.title, status: g.status })),
      toast: (m: string, k?: "info" | "success" | "error") => showToast(m, k ?? "info"),
      emit: (n: string, d?: unknown) => window.dispatchEvent(new CustomEvent(n, { detail: d })),
    };
    const mount = async () => {
      if (!containerRef.current || !active) return;
      await mountPluginWidgets(slot, containerRef.current, ctx);
    };
    void mount();
    const onChange = () => void mount();
    window.addEventListener("heravex:plugins-changed", onChange);
    return () => {
      active = false;
      window.removeEventListener("heravex:plugins-changed", onChange);
      void unmountPluginWidgets(slot);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);
  return <div ref={containerRef} className="heravex-plugin-slot" data-slot={slot} />;
}

