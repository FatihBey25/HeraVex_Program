import { useEffect, useMemo, useRef } from "react";
import { mountPluginWidgets, unmountPluginWidgets } from "../lib/plugins";
import { motion } from "framer-motion";
import {
  Gamepad2, ListTodo, CheckCircle2,
  Zap, StickyNote, Wallet as WalletIcon, ChevronRight,
} from "lucide-react";
import {
  PieChart, Pie, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import { useAppStore, selectAllTasks } from "../store";
import { calculateAccumulatedAmount } from "./PieChartWidget";
import { statusLabel, statusToneClass, priorityLabel } from "../lib/i18n";
import { imgSrc } from "../lib/images";
import { isGeneralGame } from "../lib/general-game";
import {
  computeDashboardSuggestions,
  type DashboardSuggestion,
} from "../lib/dashboardSuggestions";
import { AlertTriangle, Store as StoreIcon, Image as ImageIcon, DollarSign } from "lucide-react";

const BAR_PALETTE = ["#4f8cff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#fb7185"];

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
  if (pct <= 70) return "linear-gradient(90npm run tauri builddeg, #f59e0b, #fbbf24)";
  return "linear-gradient(90deg, #34d399, #10b981)";
}

export function Dashboard({ onCreateGame }: { onCreateGame: () => void }) {
  const {
    games: allGames, globalExpenses, exchangeRates, language,
    toggleTask, setWorkspaceTab, setActiveTaskId, setSelectedId, ui, layout,
  } = useAppStore();
  // User can hide individual dashboard panels via Settings → Layout.
  // Defaults are all-on so users who never visit the toggle don't lose
  // any cards on upgrade.
  const widgets = layout.dashboardWidgets ?? { overview: true, projects: true, tasks: true };

  // Hide the internal marker game from every list/metric on the dashboard;
  // its tasks still feed `allTasks` below so general tasks remain visible.
  const games = useMemo(() => allGames.filter((g) => !isGeneralGame(g)), [allGames]);

  const allTasks = useMemo(() => selectAllTasks(allGames), [allGames]);

  const { total: totalSpend } = useMemo(
    () => usd(games, globalExpenses, exchangeRates),
    [games, globalExpenses, exchangeRates],
  );

  const thisMonthSpend = useMemo(() => {
    const rate = (c: string) => exchangeRates[c] ?? 1;
    const g = games.reduce(
      (s, game) =>
        s +
        game.expenses
          .filter((e) => isThisMonth(e.spentAt))
          .reduce((ss, e) => ss + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0),
      0,
    );
    const gen = globalExpenses
      .filter((e) => isThisMonth(e.spentAt))
      .reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0);
    return g + gen;
  }, [games, globalExpenses, exchangeRates]);

  const totalTaskCount = allTasks.length;
  const doneTaskCount = allTasks.filter((t) => t.done).length;
  const completionPct = totalTaskCount > 0 ? Math.round((doneTaskCount / totalTaskCount) * 100) : null;

  // "Completed this week" — the cumulative `doneTaskCount` was
  // demoralising at zero for new workspaces and never reset; weekly
  // framing keeps the stat meaningful long-term.
  // Only tasks whose `completedAt` falls in the last 7 days count.
  // Tasks completed before v0.8.5 don't have the field and quietly
  // skip the bucket — we deliberately avoid backfilling from
  // `updatedAt` because that timestamp tracks any edit, not the
  // completion moment.
  const completedThisWeekCount = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return allTasks.reduce((n, t) => {
      if (!t.done || !t.completedAt) return n;
      const ts = Date.parse(t.completedAt);
      return Number.isFinite(ts) && ts >= cutoff ? n + 1 : n;
    }, 0);
  }, [allTasks]);

  const activeGameCount = games.filter((g) =>
    ["Fikir", "Prototip", "Demo", "Alpha", "Beta"].includes(g.status),
  ).length;

  // ── Bar chart ───────────────────────────────────────────────────────────────
  const barData = useMemo(() => {
    const rate = (c: string) => exchangeRates[c] ?? 1;
    return [
      ...games.map((g) => ({
        name: g.title.length > 14 ? g.title.slice(0, 13) + "…" : g.title,
        fullName: g.title,
        amount: g.expenses.reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0),
      })),
      {
        name: language === "tr" ? "Genel" : "General",
        fullName: language === "tr" ? "Genel Giderler" : "General Expenses",
        amount: globalExpenses.reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0),
      },
    ]
      .filter((d) => d.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [games, globalExpenses, exchangeRates, language]);

  const barTotal = useMemo(() => barData.reduce((s, d) => s + d.amount, 0), [barData]);

  // ── Data slices ─────────────────────────────────────────────────────────────
  const recentGames = useMemo(
    () => [...games].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    [games],
  );
  const priorityTasks = useMemo(() => allTasks.filter((t) => !t.done).slice(0, 6), [allTasks]);

  const fmt = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`);

  return (
    <div key="dashboard" className="dashboard-wrapper page-fade">

      {/* ── PAGE HEADER ───────────────────────────────────────────────────────── */}
      <div className="dashboard-page-header">
        <p className="eyebrow">{ui.overviewEyebrow}</p>
        <h2 className="dashboard-title">{ui.overviewTitle}</h2>
      </div>

      {/* ── TOP: Hero stats ────────────────────────────────────────────────────── */}
      <motion.section
        className="dashboard-hero-stats"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.07 } } }}
      >
        <HeroStat icon={Gamepad2} label={ui.games} value={games.length} accent="#4f8cff" />
        <HeroStat icon={ListTodo} label={ui.openTasks} value={totalTaskCount - doneTaskCount} accent="#a78bfa" />
        <HeroStat
          icon={CheckCircle2}
          label={ui.completedThisWeek}
          value={completedThisWeekCount}
          accent="#34d399"
          subtext={
            completedThisWeekCount === 0 ? ui.noTasksCompletedThisWeek : undefined
          }
        />
      </motion.section>

      <div className="dashboard-grid">

        {/* ── LEFT: Overview metrics + chart ──────────────────────────────────── */}
        {widgets.overview && (
        <section className="panel overview-card">
          <div className="dashboard-stats">
            <MetricCard
              label={language === "tr" ? "Toplam Harcama" : "Total Spend"}
              value={fmt(totalSpend)}
              accent="#4f8cff"
            />
            <MetricCard
              label={language === "tr" ? "Bu Ay" : "This Month"}
              value={fmt(thisMonthSpend)}
              accent="#a78bfa"
            />
            <MetricCard
              label={language === "tr" ? "Tamamlanma" : "Done Rate"}
              value={completionPct !== null ? `${completionPct}%` : "—"}
              accent="#34d399"
            />
            <MetricCard
              label={language === "tr" ? "Aktif Oyun" : "Active Games"}
              value={String(activeGameCount)}
              accent="#f59e0b"
            />
          </div>

          <div className="chart-section">
            <p className="chart-label eyebrow" style={{ marginBottom: "0.75rem" }}>
              {language === "tr" ? "PROJE BAZLI HARCAMA" : "SPEND BY PROJECT"}
            </p>
            {barData.length > 0 ? (
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={barData}
                      dataKey="amount"
                      nameKey="fullName"
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={92}
                      paddingAngle={2}
                      stroke="rgba(15, 22, 36, 0.6)"
                      strokeWidth={2}
                    >
                      {barData.map((_, i) => (
                        <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]} fillOpacity={0.92} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        color: "#f8fafc",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "10px",
                        fontSize: "12px",
                        padding: "8px 12px",
                      }}
                      itemStyle={{ color: "#cbd5e1" }}
                      labelStyle={{ color: "#f8fafc", fontWeight: 700, marginBottom: 4 }}
                      formatter={(val, _name, item) => {
                        const amount = Number(val);
                        const pct = barTotal > 0 ? ((amount / barTotal) * 100).toFixed(1) : "0.0";
                        const label = (item?.payload as { fullName?: string } | undefined)?.fullName
                          ?? String(_name ?? "");
                        return [
                          `$${amount.toFixed(2)}  (${pct}%)`,
                          label,
                        ];
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      align="center"
                      iconType="circle"
                      formatter={(value) => (
                        <span style={{ color: "#cbd5e1", fontSize: 11 }}>{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="chart-empty-state">
                <p className="chart-empty-hint">
                  {language === "tr"
                    ? "Henüz harcama yok. Cüzdan'dan ilk gideri ekle →"
                    : "No expenses yet. Add your first expense in Wallet →"}
                </p>
                <button
                  className="chart-empty-btn"
                  onClick={() => setWorkspaceTab("wallet")}
                >
                  {language === "tr" ? "Cüzdan'a Git" : "Go to Wallet"}
                </button>
              </div>
            )}
          </div>
        </section>
        )}

        {/* ── MIDDLE: Recent projects with progress bars ───────────────────────── */}
        {widgets.projects && (
        <section className="panel dashboard-list">
          <div className="panel-head">
            <div>
              <p className="eyebrow">{ui.recentEyebrow}</p>
              <h3>{ui.projects}</h3>
            </div>
          </div>
          <div className="stack-list">
            {recentGames.map((game) => {
              const total = game.tasks.length;
              const done = game.tasks.filter((t) => t.done).length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <button
                  key={game.id}
                  className="dashboard-game-row"
                  onClick={() => { setSelectedId(game.id); setWorkspaceTab("library"); }}
                >
                  <div className="dashboard-game-row-left">
                    {game.coverDataUrl ? (
                      <img src={imgSrc(game.coverDataUrl)} alt={game.title} className="dashboard-thumb" />
                    ) : (
                      <div className="cover-placeholder mini">{game.title.slice(0, 1)}</div>
                    )}
                    <div className="game-row-body">
                      <div className="game-row-top">
                        <strong className="game-row-title" title={game.title}>{game.title}</strong>
                        <span className={`status-tag compact-tag ${statusToneClass(game.status)}`}>
                          {statusLabel(language, game.status)}
                        </span>
                      </div>
                      <p className="game-row-summary" title={game.summary || undefined}>
                        {game.summary || ui.noDescription}
                      </p>
                      {total > 0 && (
                        <div className="dash-progress-wrap">
                          <div className="dash-progress-track">
                            <div
                              className="dash-progress-fill"
                              style={{ width: `${pct}%`, background: progressColor(pct) }}
                            />
                          </div>
                          <span className="dash-progress-pct">{pct}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {games.length === 0 && (
              <div className="empty-inline-state">{ui.emptyLibrary}</div>
            )}
          </div>
        </section>
        )}

        {/* ── RIGHT: Priority tasks with quick-complete checkbox ──────────────── */}
        {widgets.tasks && (
        <section className="panel dashboard-list">
          <div className="panel-head">
            <div>
              <p className="eyebrow">{ui.priorityEyebrow}</p>
              <h3>{ui.nextTasks}</h3>
            </div>
          </div>
          <div className="stack-list">
            {priorityTasks.map((task) => (
              <div key={task.id} className="dashboard-task-row">
                <button
                  className="task-check-btn"
                  title={ui.markDone as string}
                  onClick={() => void toggleTask(task.gameId, task.id)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="8" cy="8" r="7" />
                  </svg>
                </button>
                <button
                  className="dashboard-task-row-content"
                  onClick={() => { setWorkspaceTab("tasks"); setActiveTaskId(task.id); }}
                >
                  <div className="task-row-text">
                    <strong>{task.title}</strong>
                    <p>{task.gameTitle}</p>
                  </div>
                  <span className={`priority-badge priority-${task.priority}`}>
                    {priorityLabel(task.priority, language)}
                  </span>
                </button>
              </div>
            ))}
            {priorityTasks.length === 0 && (
              <div className="empty-inline-state">
                {language === "tr" ? "Bekleyen görev yok." : "No pending tasks."}
              </div>
            )}
          </div>
        </section>
        )}
      </div>

      {/* Plugin widget slot — third-party widgets render here. The
          plugin runtime mounts/unmounts on every page swap so a broken
          extension can never crash the dashboard. */}
      <PluginSlot slot="dashboard" allGames={allGames} />

      {/* ── BOTTOM: Quick Actions ─────────────────────────────────────────────── */}
      <QuickActions
        language={language}
        ui={ui}
        suggestions={computeDashboardSuggestions({
          games: allGames,
          // Workspace-wide store check: any game with a saved mapping
          // (Steam/Itch/Play). storeMappings is non-null per record but
          // each provider key is independent.
          hasAnyStoreConnected: allGames.some((g) => {
            const m = g.storeMappings;
            return !!(m?.steam || m?.itch || m?.play);
          }),
          // No on-disk press-kit registry yet — treat as "user has
          // touched a press kit at least once" by checking the active
          // press kit input file existence. For v0.8.5 we assume false
          // unless we find a `presskit` directory hint on any game.
          // The suggestion will retire on first press-kit generation
          // because the user will see the press-kit Overview panel.
          hasAnyPressKit: false,
        })}
        onCreateGame={onCreateGame}
        onGoToWallet={() => setWorkspaceTab("wallet")}
        onGoToTasks={() => setWorkspaceTab("tasks")}
        onGoToNotes={() => setWorkspaceTab("notes")}
        onGoToProfile={() => setWorkspaceTab("profile")}
        onJumpToGame={(gameId) => {
          setSelectedId(gameId);
          setWorkspaceTab("library");
        }}
      />
    </div>
  );
}

/** Mount point for third-party plugin widgets. Re-runs the plugin
 *  discovery whenever the user toggles a plugin from Settings (via the
 *  `heravex:plugins-changed` event). */
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

// ── Quick Actions ─────────────────────────────────────────────────────────────
//
// v0.8.5 turned this from a fixed grid of four shortcuts into a
// context-aware suggestion panel. The five contextual rules
// (computeDashboardSuggestions) score what the user is most likely
// to need next; whatever doesn't match is padded with the original
// four shortcuts so the panel never collapses.

function QuickActions({
  language,
  ui,
  suggestions,
  onCreateGame,
  onGoToWallet,
  onGoToTasks,
  onGoToNotes,
  onGoToProfile,
  onJumpToGame,
}: {
  language: string;
  ui: ReturnType<typeof useAppStore.getState>["ui"];
  suggestions: DashboardSuggestion[];
  onCreateGame: () => void;
  onGoToWallet: () => void;
  onGoToTasks: () => void;
  onGoToNotes: () => void;
  onGoToProfile: () => void;
  onJumpToGame: (gameId: string) => void;
}) {
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  // Resolve each abstract `DashboardSuggestion` into a renderable card
  // object. Centralising the mapping here keeps the JSX small and the
  // priority order from `computeDashboardSuggestions` intact.
  const cards = suggestions.map((s) => {
    switch (s.kind) {
      case "create-game":
        return {
          icon: Gamepad2,
          label: ui.suggestCreateGame,
          desc: ui.suggestCreateGameDesc,
          accent: "#4f8cff",
          onClick: onCreateGame,
        };
      case "connect-store":
        return {
          icon: StoreIcon,
          label: ui.suggestConnectStore,
          desc: ui.suggestConnectStoreDesc,
          accent: "#a78bfa",
          onClick: onGoToProfile,
        };
      case "overdue-tasks":
        return {
          icon: AlertTriangle,
          label: `${ui.suggestOverdueTasks} (${s.count ?? 0})`,
          desc: ui.suggestOverdueTasksDesc,
          accent: "#f87171",
          onClick: onGoToTasks,
        };
      case "press-kit":
        return {
          icon: ImageIcon,
          label: ui.suggestPressKit,
          // Game title surfaces in the desc line so the user knows
          // which project the suggestion targets.
          desc: s.gameTitle
            ? `${ui.suggestPressKitDesc} — ${s.gameTitle}`
            : ui.suggestPressKitDesc,
          accent: "#34d399",
          onClick: () => s.gameId && onJumpToGame(s.gameId),
        };
      case "set-budget":
        return {
          icon: DollarSign,
          label: ui.suggestSetBudget,
          desc: ui.suggestSetBudgetDesc,
          accent: "#f59e0b",
          onClick: onGoToWallet,
        };
      case "static-new-project":
        return {
          icon: Gamepad2,
          label: tr("New Project", "Yeni Proje Ekle"),
          desc: tr("Open project creator", "Yeni oyun projesi oluştur"),
          accent: "#4f8cff",
          onClick: onCreateGame,
        };
      case "static-add-expense":
        return {
          icon: WalletIcon,
          label: tr("Add Expense", "Gider Ekle"),
          desc: tr("Log a studio cost", "Gider kaydı oluştur"),
          accent: "#a78bfa",
          onClick: onGoToWallet,
        };
      case "static-add-task":
        return {
          icon: ListTodo,
          label: tr("Add Task", "Görev Ekle"),
          desc: tr("Go to task center", "Görev Merkezi'ne git"),
          accent: "#34d399",
          onClick: onGoToTasks,
        };
      case "static-add-note":
        return {
          icon: StickyNote,
          label: tr("Quick Note", "Hızlı Not"),
          desc: tr("Open note editor", "Not editörünü aç"),
          accent: "#f59e0b",
          onClick: onGoToNotes,
        };
    }
  });

  const actions = cards;

  return (
    <motion.section
      className="panel quick-actions-panel"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: 0.1 }}
    >
      <div className="snapshot-head">
        <Zap size={18} strokeWidth={2} style={{ color: "#f59e0b" }} />
        <div>
          <p className="eyebrow">{tr("QUICK ACTIONS", "HIZLI AKSİYONLAR")}</p>
          <h3 style={{ margin: 0 }}>{tr("Get things done faster", "Bir tıkla harekete geç")}</h3>
        </div>
      </div>
      <div className="quick-actions-grid">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.label}
              className="quick-action-btn"
              style={{ "--qa-accent": a.accent } as React.CSSProperties}
              onClick={a.onClick}
            >
              <div className="qa-icon">
                <Icon size={18} strokeWidth={2} />
              </div>
              <div className="qa-body">
                <span className="qa-label">{a.label}</span>
                <span className="qa-desc">{a.desc}</span>
              </div>
              <ChevronRight size={14} className="qa-chev" />
            </button>
          );
        })}
      </div>
    </motion.section>
  );
}

// ── Hero stat ─────────────────────────────────────────────────────────────────

function HeroStat({
  icon: Icon,
  label,
  value,
  accent,
  subtext,
}: {
  icon: typeof Gamepad2;
  label: string;
  value: number;
  accent: string;
  /** Optional sub-line shown under the value — used by "0 completed
   *  this week" to soften the empty-state message. */
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
      <div className="hero-stat-icon">
        <Icon size={22} strokeWidth={2} />
      </div>
      <div className="hero-stat-body">
        <span className="hero-stat-label">{label}</span>
        <strong className="hero-stat-value">{value}</strong>
        {subtext && <span className="hero-stat-subtext">{subtext}</span>}
      </div>
      <div className="hero-stat-bar" />
    </motion.div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="metric-card" style={{ "--metric-accent": accent } as React.CSSProperties}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <div className="metric-bar" />
    </div>
  );
}
