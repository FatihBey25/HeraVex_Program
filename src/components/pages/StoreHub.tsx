import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import {
  Store, Sparkles, Eye, Download, DollarSign, RefreshCw, AlertTriangle,
  Gamepad2, Joystick, Smartphone, Users, Star, Newspaper, Activity,
  MessageSquare, TrendingUp, TrendingDown, Link2, Check,
} from "lucide-react";
import { useAppStore } from "../../store";
import { fetchStoreData } from "../../lib/storage";
import type { StoreProvider } from "../../types";

type AggregateRow = {
  gameId: string;
  title: string;
  provider: StoreProvider;
  views: number;
  downloads: number;
  earnings: number;
  currency: string | null;
  currentPlayers: number;
  ratingAverage: number | null;
  ratingCount: number | null;
  lastNewsTitle: string | null;
  lastNewsUrl: string | null;
  lastNewsAt: string | null;
  activeInstalls: number | null;
  uninstalls: number | null;
  error?: string;
};

const PALETTE = ["#4f8cff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#fb7185"];

// Position-based color hierarchy for the leaderboard so distinct projects pop
// even when they share the same store provider.
const LEADERBOARD_TIER: Record<number, string> = {
  0: "#fbbf24", // gold
  1: "#e2e8f0", // silver
  2: "#fb923c", // bronze
};
function leaderboardColor(idx: number, providerColor: string): string {
  return LEADERBOARD_TIER[idx] ?? providerColor;
}

const PROVIDER_COLOR: Record<StoreProvider, string> = {
  steam: "#4f8cff",
  itch: "#f87171",
  play: "#34d399",
};

const PROVIDER_LABEL: Record<StoreProvider, string> = {
  steam: "Steam",
  itch: "Itch.io",
  play: "Google Play",
};

const PROVIDER_ICON: Record<StoreProvider, typeof Joystick> = {
  steam: Gamepad2,
  itch: Joystick,
  play: Smartphone,
};

function providerName(p: StoreProvider) {
  return PROVIDER_LABEL[p];
}

// v0.8.5 — Smart panel visibility.
//
// Before, every sub-panel rendered regardless of which stores the user
// had actually connected, leaving a tab full of "no data yet" cards
// and platform-specific widgets (Mobile Growth) on workspaces with no
// Google Play binding. The helper below collapses that to a single
// rule: each panel declares which stores can produce its data; if
// none of those stores is bound anywhere in the workspace, the panel
// is removed from the DOM (no empty container, no reserved space).
//
// `any` here means the panel works from any provider's data — it
// only needs SOMETHING connected. The empty-state branch above
// already handles "no provider at all".
export type StorePanelId =
  | "ccu"
  | "mobileGrowth"
  | "steamNews"
  | "communityFeedback"
  | "revenuePerStore"
  | "leaderboard"
  | "globalStats";

export function getPanelVisibility(
  panelId: StorePanelId,
  conn: { hasSteam: boolean; hasItch: boolean; hasPlay: boolean },
): boolean {
  const anyConnected = conn.hasSteam || conn.hasItch || conn.hasPlay;
  if (!anyConnected) return false;
  switch (panelId) {
    case "ccu":
    case "steamNews":
      return conn.hasSteam;
    case "mobileGrowth":
      return conn.hasPlay;
    case "communityFeedback":
    case "revenuePerStore":
    case "leaderboard":
    case "globalStats":
      return true;
  }
}

function shortError(err?: string) {
  if (!err) return "?";
  const text = err.replace(/^Error:?\s*/i, "");
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function relativeTime(iso: string, language: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const tr = language === "tr";
  if (minutes < 1) return tr ? "az önce" : "just now";
  if (minutes < 60) return tr ? `${minutes} dk önce` : `${minutes}m ago`;
  if (hours < 24) return tr ? `${hours} saat önce` : `${hours}h ago`;
  if (days < 30) return tr ? `${days} gün önce` : `${days}d ago`;
  const months = Math.floor(days / 30);
  return tr ? `${months} ay önce` : `${months}mo ago`;
}

export function StoreHub() {
  const { games, language, ui, setWorkspaceTab } = useAppStore();
  const t = ui as unknown as Record<string, string>;
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  // Workspace-wide connection flags drive `getPanelVisibility`. We
  // intentionally aggregate across ALL games — once even one game has
  // bound Steam, the Steam-only panels make sense to show because
  // their numbers can be non-empty.
  const connectionFlags = useMemo(() => {
    let hasSteam = false;
    let hasItch = false;
    let hasPlay = false;
    for (const g of games) {
      const m = g.storeMappings;
      if (m?.steam?.id) hasSteam = true;
      if (m?.itch?.id) hasItch = true;
      if (m?.play?.id) hasPlay = true;
    }
    return { hasSteam, hasItch, hasPlay };
  }, [games]);
  const visible = (id: Parameters<typeof getPanelVisibility>[0]) =>
    getPanelVisibility(id, connectionFlags);

  const mappedTargets = useMemo(() => {
    const out: { gameId: string; title: string; provider: StoreProvider; id: string }[] = [];
    for (const g of games) {
      const m = g.storeMappings ?? {};
      if (m.steam?.id) out.push({ gameId: g.id, title: g.title, provider: "steam", id: m.steam.id });
      if (m.itch?.id) out.push({ gameId: g.id, title: g.title, provider: "itch", id: m.itch.id });
      if (m.play?.id) out.push({ gameId: g.id, title: g.title, provider: "play", id: m.play.id });
    }
    return out;
  }, [games]);

  const [rows, setRows] = useState<AggregateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string>("");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [justSynced, setJustSynced] = useState(false);
  const [, setTick] = useState(0);

  // Re-render every 30s so "5m ago" relative timestamps stay accurate
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const fetchAll = async () => {
    if (mappedTargets.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    setErrorBanner("");

    const results = await Promise.all(
      mappedTargets.map(async (target): Promise<AggregateRow> => {
        try {
          const data = await fetchStoreData(target.provider, target.id);
          return {
            gameId: target.gameId,
            title: target.title,
            provider: target.provider,
            views: data.views ?? 0,
            downloads: data.downloads ?? 0,
            earnings: data.earnings ?? 0,
            currency: data.currency ?? null,
            currentPlayers: data.currentPlayers ?? 0,
            ratingAverage: data.ratingAverage ?? null,
            ratingCount: data.ratingCount ?? null,
            lastNewsTitle: data.lastNewsTitle ?? null,
            lastNewsUrl: data.lastNewsUrl ?? null,
            lastNewsAt: data.lastNewsAt ?? null,
            activeInstalls: data.activeInstalls ?? null,
            uninstalls: data.uninstalls ?? null,
          };
        } catch (err) {
          return {
            gameId: target.gameId,
            title: target.title,
            provider: target.provider,
            views: 0,
            downloads: 0,
            earnings: 0,
            currency: null,
            currentPlayers: 0,
            ratingAverage: null,
            ratingCount: null,
            lastNewsTitle: null,
            lastNewsUrl: null,
            lastNewsAt: null,
            activeInstalls: null,
            uninstalls: null,
            error: String(err),
          };
        }
      })
    );

    setRows(results);
    const failed = results.filter((r) => r.error);
    if (failed.length > 0) {
      const summary = failed
        .map((r) => `${providerName(r.provider)}: ${shortError(r.error)}`)
        .join(" · ");
      setErrorBanner(summary);
    }
    setLoading(false);
    setLastSyncAt(Date.now());
    setJustSynced(true);
    setTimeout(() => setJustSynced(false), 3000);
  };

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedTargets.length]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.views += r.views;
        acc.downloads += r.downloads;
        acc.earnings += r.earnings;
        acc.currentPlayers += r.currentPlayers;
        if (!acc.currency && r.currency) acc.currency = r.currency;
        return acc;
      },
      { views: 0, downloads: 0, earnings: 0, currentPlayers: 0, currency: null as string | null }
    );
  }, [rows]);

  const topRated = useMemo(() => {
    return (
      rows
        .filter((r) => r.ratingAverage != null && (r.ratingCount ?? 0) > 0)
        .sort((a, b) => (b.ratingAverage ?? 0) - (a.ratingAverage ?? 0))[0] ?? null
    );
  }, [rows]);

  const newsHighlight = useMemo(() => {
    return (
      rows
        .filter((r) => r.lastNewsTitle && r.lastNewsAt)
        .sort((a, b) => (b.lastNewsAt ?? "").localeCompare(a.lastNewsAt ?? ""))[0] ?? null
    );
  }, [rows]);

  const leaderboard = useMemo(
    () =>
      rows
        .map((r) => ({
          name: r.title.length > 16 ? `${r.title.slice(0, 15)}…` : r.title,
          provider: r.provider,
          views: r.views,
          downloads: r.downloads,
        }))
        .sort((a, b) => b.downloads - a.downloads || b.views - a.views),
    [rows]
  );

  const revenueByStore = useMemo(() => {
    const map = new Map<StoreProvider, number>();
    for (const r of rows) {
      if (r.earnings <= 0) continue;
      map.set(r.provider, (map.get(r.provider) ?? 0) + r.earnings);
    }
    return Array.from(map.entries()).map(([provider, value]) => ({
      provider,
      name: PROVIDER_LABEL[provider],
      value: Number(value.toFixed(2)),
    }));
  }, [rows]);

  // ── Community feedback aggregate (rating-weighted) ──────────────────────────
  const community = useMemo(() => {
    let weightedSum = 0;
    let totalCount = 0;
    const perProvider = new Map<StoreProvider, number>();
    for (const r of rows) {
      const count = r.ratingCount ?? 0;
      if (count <= 0) continue;
      if (r.ratingAverage != null) {
        weightedSum += r.ratingAverage * count;
      }
      totalCount += count;
      perProvider.set(r.provider, (perProvider.get(r.provider) ?? 0) + count);
    }
    const avg = totalCount > 0 ? weightedSum / totalCount : null;
    let topProvider: StoreProvider | null = null;
    let topProviderCount = 0;
    for (const [p, c] of perProvider) {
      if (c > topProviderCount) {
        topProvider = p;
        topProviderCount = c;
      }
    }
    return { avg, totalCount, topProvider, topProviderCount };
  }, [rows]);

  // ── Mobile installs vs uninstalls ───────────────────────────────────────────
  const mobileInsights = useMemo(() => {
    const playRows = rows.filter((r) => r.provider === "play");
    let installs = 0;
    let uninstalls = 0;
    for (const r of playRows) {
      installs += r.activeInstalls ?? 0;
      uninstalls += r.uninstalls ?? 0;
    }
    const total = installs + uninstalls;
    return {
      hasPlay: playRows.length > 0,
      installs,
      uninstalls,
      retentionPct: total > 0 ? Math.round((installs / total) * 100) : null,
    };
  }, [rows]);

  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  const money = (n: number, cur: string | null) =>
    cur ? `${n.toFixed(2)} ${cur}` : `$${n.toFixed(2)}`;

  // ── EMPTY STATE ────────────────────────────────────────────────────────────
  if (mappedTargets.length === 0 && !loading) {
    return (
      <motion.div
        className="page-fade storehub-wrapper"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="storehub-backdrop" aria-hidden="true">
          <div className="storehub-orb storehub-orb-1" />
          <div className="storehub-orb storehub-orb-2" />
        </div>
        <section className="panel storehub-empty">
          <div className="storehub-empty-icon">
            <Link2 size={32} strokeWidth={1.9} />
          </div>
          <p className="eyebrow">{tr("THE NEXUS", "MERKEZ")}</p>
          <h2 style={{ margin: "4px 0 8px" }}>
            {tr("Map a game to start collecting data", "Veri toplamak için bir oyun eşleştir")}
          </h2>
          <p className="section-copy" style={{ maxWidth: 460, textAlign: "center" }}>
            {tr(
              "Open any project, jump to its Store Sync tab, and connect it to Steam, Itch.io or Google Play. The Nexus aggregates everything in real time.",
              "Bir projeyi aç, Store Sync sekmesine git ve Steam, Itch.io veya Google Play'e bağla. Merkez verileri anlık olarak toplar."
            )}
          </p>
          {/* v0.8.5 — chips became actionable buttons that jump to
              the Identity tab where API keys live. The label was kept
              short because three buttons in a row already communicate
              what each one does. */}
          <div className="storehub-empty-providers">
            {(["steam", "itch", "play"] as StoreProvider[]).map((p) => {
              const Icon = PROVIDER_ICON[p];
              return (
                <button
                  key={p}
                  type="button"
                  className="storehub-empty-chip storehub-empty-chip-btn"
                  style={{ borderColor: PROVIDER_COLOR[p] }}
                  onClick={() => setWorkspaceTab("profile")}
                  title={tr(
                    `Open Identity to connect ${PROVIDER_LABEL[p]}`,
                    `${PROVIDER_LABEL[p]} bağlamak için Kimlik sekmesini aç`,
                  )}
                >
                  <Icon size={14} style={{ color: PROVIDER_COLOR[p] }} />
                  <span>
                    {tr(`Connect ${PROVIDER_LABEL[p]}`, `${PROVIDER_LABEL[p]} Bağla`)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="page-fade storehub-wrapper"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.05 } } }}
    >
      <div className="storehub-backdrop" aria-hidden="true">
        <div className="storehub-orb storehub-orb-1" />
        <div className="storehub-orb storehub-orb-2" />
      </div>

      <motion.section
        className="panel storehub-hero"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.32 } } }}
      >
        <div className="storehub-hero-icon">
          <Store size={26} strokeWidth={2} />
        </div>
        <div style={{ flex: 1 }}>
          <p className="eyebrow">{tr("THE NEXUS", "MERKEZ")}</p>
          <h2 style={{ margin: "2px 0 6px" }}>{t.storeHubTitle ?? "Global Store Analytics"}</h2>
          <p className="section-copy" style={{ maxWidth: 540 }}>
            {tr(
              "Live wishlists, downloads and revenue across every store you sync. Mapped projects feed this dashboard automatically.",
              "Senkronize ettiğin tüm mağazalardan wishlist, indirme ve gelir verisinin canlı görünümü. Eşleştirdiğin projeler bu dashboard'u otomatik besliyor."
            )}
          </p>
        </div>
        <button
          className={`secondary-button compact-button storehub-refresh-btn${justSynced ? " storehub-refresh-success" : ""}`}
          onClick={() => void fetchAll()}
          disabled={loading}
          title={tr("Refresh", "Yenile")}
        >
          {loading ? (
            <>
              <RefreshCw size={14} className="spin" style={{ marginRight: 6 }} />
              {tr("Syncing…", "Yenileniyor…")}
            </>
          ) : justSynced ? (
            <>
              <Check size={14} style={{ marginRight: 6, color: "#34d399" }} />
              {tr("Last sync: just now", "Son sync: az önce")}
            </>
          ) : (
            <>
              <RefreshCw size={14} style={{ marginRight: 6 }} />
              {tr("Refresh", "Yenile")}
            </>
          )}
        </button>
      </motion.section>

      {errorBanner && (
        <motion.div
          className="storehub-banner"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <AlertTriangle size={14} />
          <span>{errorBanner}</span>
        </motion.div>
      )}

      {/* ── TOP: 4 GLOBAL METRIC CARDS ──────────────────────────────────────── */}
      <motion.section
        className="storehub-grid storehub-grid-4"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.32 } } }}
      >
        {loading && rows.length === 0 ? (
          <>
            <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
          </>
        ) : (() => {
          const syncLabel = lastSyncAt
            ? relativeTime(new Date(lastSyncAt).toISOString(), language)
            : "";
          const emptyNote = tr("no data yet", "henüz veri yok");
          return (
            <>
              <GlobalStat
                icon={Eye} label={tr("Total Views", "Toplam Görüntülenme")}
                value={totals.views > 0 ? fmt(totals.views) : "—"}
                isEmpty={totals.views === 0} emptyNote={emptyNote}
                lastSync={syncLabel} accent="#4f8cff"
              />
              <GlobalStat
                icon={Download} label={tr("Total Downloads / Sales", "Toplam İndirme / Satış")}
                value={totals.downloads > 0 ? fmt(totals.downloads) : "—"}
                isEmpty={totals.downloads === 0} emptyNote={emptyNote}
                lastSync={syncLabel} accent="#34d399"
              />
              <GlobalStat
                icon={DollarSign} label={tr("Global Revenue", "Global Gelir")}
                value={totals.earnings > 0 ? money(totals.earnings, totals.currency) : "—"}
                isEmpty={totals.earnings === 0} emptyNote={emptyNote}
                lastSync={syncLabel} accent="#facc15"
              />
              {/* CCU only makes sense when at least one Steam mapping
                  exists — Itch and Play have no concurrent-player
                  concept. Drop the card from the row rather than
                  showing a permanent em-dash. */}
              {visible("ccu") && (
                <GlobalStat
                  icon={Users} label={tr("Live Players (CCU)", "Anlık Oyuncu (CCU)")}
                  value={totals.currentPlayers > 0 ? fmt(totals.currentPlayers) : "—"}
                  isEmpty={totals.currentPlayers === 0} emptyNote={emptyNote}
                  lastSync={syncLabel} accent="#f87171"
                />
              )}
            </>
          );
        })()}
      </motion.section>

      {/* ── MIDDLE ROW: LEADERBOARD | STUDIO PULSE ──────────────────────────── */}
      <motion.section
        className="storehub-row-2"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.32 } } }}
      >
        {/* Left: Leaderboard */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">{tr("LEADERBOARD", "LİDER TABLOSU")}</p>
              <h3>{tr("Which project carries the studio?", "Hangi proje stüdyoyu sırtlıyor?")}</h3>
            </div>
          </div>

          {loading && rows.length === 0 ? (
            <SkeletonChart />
          ) : leaderboard.length === 0 ? (
            <div className="chart-empty-hint">
              {tr("No engagement data yet.", "Henüz etkileşim verisi yok.")}
            </div>
          ) : (
            <div style={{ height: 280, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leaderboard} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.25)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <RechartsTooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    contentStyle={{ backgroundColor: "#1e293b", color: "#f8fafc", border: "none", borderRadius: 8, fontSize: 12 }}
                    itemStyle={{ color: "#cbd5e1" }}
                    labelStyle={{ color: "#f8fafc" }}
                  />
                  <Bar dataKey="downloads" name={tr("Downloads", "İndirme")} radius={[6, 6, 0, 0]} barSize={20}>
                    {leaderboard.map((row, i) => (
                      <Cell
                        key={`d-${i}`}
                        fill={leaderboardColor(i, PROVIDER_COLOR[row.provider] ?? PALETTE[i % PALETTE.length])}
                        fillOpacity={0.92}
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="views" name={tr("Views", "Görüntülenme")} radius={[6, 6, 0, 0]} barSize={20}>
                    {leaderboard.map((row, i) => (
                      <Cell
                        key={`v-${i}`}
                        fill={leaderboardColor(i, PROVIDER_COLOR[row.provider] ?? PALETTE[i % PALETTE.length])}
                        fillOpacity={0.45}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {leaderboard.length > 0 && (
            <div className="storehub-provider-row">
              {leaderboard.map((row, i) => {
                const Icon = PROVIDER_ICON[row.provider];
                return (
                  <div key={`legend-${i}`} className="storehub-provider-chip">
                    <Icon size={12} strokeWidth={2} style={{ color: PROVIDER_COLOR[row.provider] }} />
                    <span>{row.name}</span>
                    <span className="storehub-provider-meta">{PROVIDER_LABEL[row.provider]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Studio Pulse (CCU + Top Rated) */}
        <section className="panel storehub-side-pulse">
          <div className="panel-head">
            <div>
              <p className="eyebrow">{tr("STUDIO PULSE", "STÜDYO NABZI")}</p>
              <h3>{tr("Live signals", "Canlı sinyaller")}</h3>
            </div>
          </div>

          <div className="pulse-stack">
            {/* Live Players inside Studio Pulse — same Steam-only
                rationale as the GlobalStat above. Hide the card when
                no Steam mapping; Top Rated below still renders. */}
            {visible("ccu") && (
              <div className={`daily-pulse-card ${totals.currentPlayers > 0 ? "" : "pulse-dim"}`}>
                <div className="daily-pulse-icon">
                  <Activity size={20} strokeWidth={2.1} />
                </div>
                <div>
                  <p className="eyebrow">{tr("LIVE PLAYERS", "ANLIK OYUNCU")}</p>
                  <h3 style={{ margin: "2px 0 4px" }}>
                    {totals.currentPlayers > 0
                      ? tr(
                          `${totals.currentPlayers.toLocaleString()} playing right now`,
                          `Şu an ${totals.currentPlayers.toLocaleString()} kişi oynuyor`
                        )
                      : tr("No live Steam data yet", "Henüz Steam canlı verisi yok")}
                  </h3>
                  <p className="section-copy" style={{ margin: 0 }}>
                    {tr(
                      "Concurrent player count from Steam, summed across mapped projects.",
                      "Eşleşmiş projelerin Steam anlık oyuncu sayılarının toplamı."
                    )}
                  </p>
                </div>
              </div>
            )}

            <div className={`daily-pulse-card top-rated ${topRated ? "" : "pulse-dim"}`}>
              <div className="daily-pulse-icon">
                <Star size={20} strokeWidth={2.1} />
              </div>
              <div>
                <p className="eyebrow">{tr("TOP RATED", "EN YÜKSEK PUAN")}</p>
                {topRated ? (
                  <>
                    <h3 style={{ margin: "2px 0 4px" }}>
                      {topRated.title} · ★ {(topRated.ratingAverage ?? 0).toFixed(2)}
                    </h3>
                    <p className="section-copy" style={{ margin: 0 }}>
                      {`${PROVIDER_LABEL[topRated.provider]} · ${topRated.ratingCount ?? 0} ${tr("ratings", "oy")}`}
                    </p>
                  </>
                ) : (
                  <>
                    <h3 style={{ margin: "2px 0 4px" }}>
                      {tr("No ratings yet", "Henüz puan yok")}
                    </h3>
                    <p className="section-copy" style={{ margin: 0 }}>
                      {tr("Mappings with at least one rating will appear here.", "En az bir oy almış eşleşmeler burada görünecek.")}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </motion.section>

      {/* ── REVENUE PIE + COMMUNITY FEEDBACK ───────────────────────────────── */}
      <motion.section
        className="storehub-row-2"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.32 } } }}
      >
        {/* Revenue per store */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">{tr("REVENUE PER STORE", "MAĞAZA BAŞINA GELİR")}</p>
              <h3>{tr("Where the money comes from", "Para hangi mağazadan geliyor")}</h3>
            </div>
          </div>

          {revenueByStore.length === 0 ? (
            <div className="chart-empty-hint">
              {tr("No revenue captured yet.", "Henüz gelir yakalanmadı.")}
            </div>
          ) : (
            <div style={{ height: 260, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={revenueByStore}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    stroke="rgba(8,13,22,0.95)"
                    strokeWidth={2}
                  >
                    {revenueByStore.map((row, i) => (
                      <Cell key={i} fill={PROVIDER_COLOR[row.provider]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "#1e293b", color: "#f8fafc", border: "none", borderRadius: 8, fontSize: 12 }}
                    itemStyle={{ color: "#cbd5e1" }}
                    labelStyle={{ color: "#f8fafc" }}
                    formatter={(v: unknown) => `$${Number(v).toFixed(2)}`}
                  />
                  <Legend
                    layout="vertical"
                    verticalAlign="middle"
                    align="right"
                    iconType="circle"
                    formatter={(value: string) => (
                      <span style={{ color: "#dce7f6", fontSize: 12 }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Community feedback */}
        <CommunityFeedback
          avg={community.avg}
          total={community.totalCount}
          topProvider={community.topProvider}
          topProviderCount={community.topProviderCount}
          tr={tr}
        />
      </motion.section>

      {/* ── ACTIVITY FEED + MOBILE INSIGHTS ──────────────────────────────────
       *
       * v0.8.5: each card is platform-specific (Steam community feed
       * and Google Play installs/uninstalls). We hide the whole row
       * when neither is relevant so it doesn't leave a blank gap. */}
      {(visible("steamNews") || visible("mobileGrowth")) && (
        <motion.section
          className="storehub-row-2"
          variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.32 } } }}
        >
          {visible("steamNews") && (
            <ActivityFeed news={newsHighlight} language={language} tr={tr} onSync={() => void fetchAll()} loading={loading} />
          )}
          {visible("mobileGrowth") && (
            <MobileInsights insights={mobileInsights} tr={tr} />
          )}
        </motion.section>
      )}
    </motion.div>
  );
}

// ── Sub components ──────────────────────────────────────────────────────────

function GlobalStat({
  icon: Icon, label, value, accent, isEmpty, emptyNote, lastSync,
}: {
  icon: typeof Store;
  label: string;
  value: string;
  accent: string;
  isEmpty?: boolean;
  emptyNote?: string;
  lastSync?: string;
}) {
  return (
    <div className="hero-stat-card storehub-stat" style={{ "--hero-accent": accent } as React.CSSProperties}>
      <div className="hero-stat-icon">
        <Icon size={22} strokeWidth={2} />
      </div>
      <div className="hero-stat-body">
        <span className="hero-stat-label">{label}</span>
        <strong className="hero-stat-value">{value}</strong>
        {isEmpty && emptyNote && (
          <span className="hero-stat-empty-note">{emptyNote}</span>
        )}
      </div>
      {lastSync && (
        <span className="hero-stat-timestamp" title={lastSync}>
          {lastSync}
        </span>
      )}
      <div className="hero-stat-bar" />
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-icon" />
      <div className="skeleton-body">
        <div className="skeleton skeleton-line skeleton-line-sm" />
        <div className="skeleton skeleton-line skeleton-line-lg" />
      </div>
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="skeleton-chart">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton skeleton-bar" style={{ height: `${30 + (i * 17) % 70}%` }} />
      ))}
    </div>
  );
}

function CommunityFeedback({
  avg, total, topProvider, topProviderCount, tr,
}: {
  avg: number | null;
  total: number;
  topProvider: StoreProvider | null;
  topProviderCount: number;
  tr: (en: string, t: string) => string;
}) {
  const stars = avg ?? 0;
  const filled = Math.round(stars);
  return (
    <section className="panel community-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{tr("COMMUNITY FEEDBACK", "TOPLULUK GERİ BİLDİRİMİ")}</p>
          <h3>{tr("How players feel about the studio", "Oyuncular stüdyo hakkında ne hissediyor")}</h3>
        </div>
      </div>

      {total === 0 ? (
        <div className="chart-empty-hint">
          {tr(
            "No ratings yet across mapped stores.",
            "Eşleşmiş mağazalarda henüz puan yok."
          )}
        </div>
      ) : (
        <>
          <div className="community-score">
            <div className="community-stars-block">
              <strong className="community-score-value">{stars.toFixed(2)}</strong>
              <div className="community-stars" aria-label={`${stars.toFixed(2)} of 5`}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    size={18}
                    fill={i < filled ? "#facc15" : "transparent"}
                    stroke={i < filled ? "#facc15" : "#475569"}
                    strokeWidth={1.6}
                  />
                ))}
              </div>
              <span className="community-stars-label">{tr("Studio rating", "Stüdyo puanı")}</span>
            </div>

            <div className="community-meta">
              <div className="community-meta-row">
                <MessageSquare size={14} strokeWidth={2} style={{ color: "#7DC2FF" }} />
                <span>
                  <strong>{total.toLocaleString()}</strong>{" "}
                  {tr("total ratings", "toplam oy")}
                </span>
              </div>
              {topProvider && (
                <div className="community-top-provider" style={{ borderColor: PROVIDER_COLOR[topProvider] }}>
                  {(() => {
                    const Icon = PROVIDER_ICON[topProvider];
                    return <Icon size={14} style={{ color: PROVIDER_COLOR[topProvider] }} />;
                  })()}
                  <span>
                    {tr("Top reviewer platform", "En yorum yapan platform")}:{" "}
                    <strong>{PROVIDER_LABEL[topProvider]}</strong>
                  </span>
                  <span className="community-top-count">
                    {topProviderCount.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ActivityFeed({
  news, language, tr, onSync, loading,
}: {
  news: AggregateRow | null;
  language: string;
  tr: (en: string, t: string) => string;
  onSync: () => void;
  loading: boolean;
}) {
  const openUrl = (url: string) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <section className="panel activity-feed-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{tr("ACTIVITY FEED", "AKTİVİTE AKIŞI")}</p>
          <h3>{tr("Latest Updates", "Son Güncellemeler")}</h3>
        </div>
      </div>

      {!news?.lastNewsTitle ? (
        <div className="storehub-cta-empty">
          <Newspaper size={48} strokeWidth={1.4} className="storehub-cta-icon" />
          <p className="storehub-cta-msg">
            {tr(
              "No recent updates pulled from Steam yet.",
              "Steam'den henüz güncelleme çekilmedi."
            )}
          </p>
          <button
            type="button"
            className="storehub-cta-btn"
            onClick={onSync}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} style={{ marginRight: 6 }} />
            {tr("Sync Steam →", "Steam Senkronize Et →")}
          </button>
        </div>
      ) : (
        <div className="activity-feed-card">
          <div className="activity-feed-icon">
            <Newspaper size={20} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow">
              {tr("STEAM NEWS", "STEAM HABERİ")} · {news.title}
            </p>
            <button
              type="button"
              className="activity-feed-title-btn"
              onClick={() => news.lastNewsUrl && openUrl(news.lastNewsUrl)}
              disabled={!news.lastNewsUrl}
              title={news.lastNewsUrl ?? ""}
            >
              {news.lastNewsTitle}
            </button>
            {news.lastNewsAt && (
              <p className="activity-feed-time">
                {tr(`Last update: ${relativeTime(news.lastNewsAt, language)}`,
                    `Son güncelleme: ${relativeTime(news.lastNewsAt, language)}`)}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MobileInsights({
  insights, tr,
}: {
  insights: {
    hasPlay: boolean;
    installs: number;
    uninstalls: number;
    retentionPct: number | null;
  };
  tr: (en: string, t: string) => string;
}) {
  const setWorkspaceTab = useAppStore((s) => s.setWorkspaceTab);
  const installs = insights.installs;
  const uninstalls = insights.uninstalls;
  const max = Math.max(installs, uninstalls, 1);
  const installPct = (installs / max) * 100;
  const uninstallPct = (uninstalls / max) * 100;

  return (
    <section className="panel mobile-insights-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{tr("MOBILE GROWTH", "MOBİL BÜYÜME")}</p>
          <h3>{tr("Installs vs Uninstalls", "Yüklemeler vs Kaldırmalar")}</h3>
        </div>
        <Smartphone size={20} strokeWidth={2} style={{ color: "#34d399" }} />
      </div>

      {!insights.hasPlay ? (
        <div className="storehub-cta-empty">
          <Smartphone size={48} strokeWidth={1.4} className="storehub-cta-icon" />
          <p className="storehub-cta-msg">
            {tr(
              "Map a Google Play game to see install health here.",
              "Yükleme/kaldırma sağlığını görmek için bir Google Play oyunu eşleştir."
            )}
          </p>
          <button
            type="button"
            className="storehub-cta-btn"
            onClick={() => setWorkspaceTab("library")}
          >
            {tr("Map Google Play →", "Google Play'i Eşleştir →")}
          </button>
        </div>
      ) : installs === 0 && uninstalls === 0 ? (
        <div className="chart-empty-hint">
          {tr(
            "Reporting API didn't return install metrics. Check service account permissions.",
            "Reporting API yükleme metriği döndürmedi. Service account izinlerini kontrol et."
          )}
        </div>
      ) : (
        <div className="mobile-insights-body">
          <div className="mobile-row mobile-row-installs">
            <div className="mobile-row-label">
              <TrendingUp size={14} />
              <span>{tr("Active Installs", "Aktif Yüklemeler")}</span>
              <strong>{installs.toLocaleString()}</strong>
            </div>
            <div className="mobile-bar-track">
              <motion.div
                className="mobile-bar-fill mobile-bar-installs"
                initial={{ width: 0 }}
                animate={{ width: `${installPct}%` }}
                transition={{ duration: 0.6, ease: [0.25, 1, 0.5, 1] }}
              />
            </div>
          </div>

          <div className="mobile-row mobile-row-uninstalls">
            <div className="mobile-row-label">
              <TrendingDown size={14} />
              <span>{tr("Uninstalls (30d)", "Kaldırma (30g)")}</span>
              <strong>{uninstalls.toLocaleString()}</strong>
            </div>
            <div className="mobile-bar-track">
              <motion.div
                className="mobile-bar-fill mobile-bar-uninstalls"
                initial={{ width: 0 }}
                animate={{ width: `${uninstallPct}%` }}
                transition={{ duration: 0.6, ease: [0.25, 1, 0.5, 1], delay: 0.08 }}
              />
            </div>
          </div>

          {insights.retentionPct != null && (
            <p className="section-copy mobile-retention">
              <Sparkles size={12} style={{ marginRight: 6, color: "#facc15" }} />
              {tr(
                `Retention strength: ${insights.retentionPct}%`,
                `Kalıcılık oranı: %${insights.retentionPct}`
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
