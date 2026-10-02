import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { motion, MotionConfig } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import {
  RefreshCw, AlertTriangle, Gamepad2, Joystick, Smartphone, Star, Store,
  Link2, ArrowUpRight, ArrowDownRight, ChevronRight, Download, DollarSign,
  Eye, Heart, Users, BarChart3, TrendingUp, Plus,
} from "lucide-react";
import { useAppStore } from "../../store";
import {
  REPORTS, cachedRows, mappedStoreTargets, syncTargets,
  type AggregateRow, type MetricKey,
} from "../../lib/storeSync";
import { imgSrc } from "../../lib/images";
import { dayKey, loadHistory, previousSnapshot, type StoreSnapshot } from "../../lib/storeHubHistory";
import type { StoreProvider } from "../../types";

// Store Center (v0.9.9, final).
//
// Built from the same parts as Dashboard / Analytics (panel + panel-head
// with icon tile and eyebrow, hero-stat-card) so it reads as part of the
// app. Reading order:
//   1. Hero        store logo, what's connected, refresh
//   2. Stat cards  up to 3 totals + rating, with change since last day
//   3. Compare     games (or stores) side by side on one metric, with
//                  each one's share of the total   |   Games: per-game
//                  details, click to open. Both panels are the same
//                  height; a long games list scrolls inside its panel.
//   4. Trend       daily chart once 2+ days of readings exist
// Store-only figures (wishlists, players, installs) appear only where the
// store actually reports them; nothing is padded with "n/a".

type CompareKey = MetricKey | "rating";

const PROVIDER_COLOR: Record<StoreProvider, string> = {
  steam: "#5b8def",
  itch: "#ef6f6c",
  play: "#3fbf8f",
};

const METRIC_ORDER: MetricKey[] = ["views", "downloads", "purchases", "earnings", "wishlist", "currentPlayers"];
const SUMMARY_PRIORITY: MetricKey[] = ["downloads", "earnings", "views", "wishlist", "currentPlayers"];
const TREND_METRICS: MetricKey[] = ["downloads", "earnings", "views", "wishlist"];
const COMPARE_METRICS: CompareKey[] = ["downloads", "earnings", "views", "wishlist", "currentPlayers", "rating"];

/** Same accent family the other pages use for these stats. */
const METRIC_ACCENT: Record<MetricKey, string> = {
  downloads: "#34d399",
  earnings: "#facc15",
  views: "#4f8cff",
  wishlist: "#a78bfa",
  currentPlayers: "#f87171",
  purchases: "#fb923c",
};
const METRIC_ICON: Record<MetricKey, typeof Download> = {
  downloads: Download,
  earnings: DollarSign,
  views: Eye,
  wishlist: Heart,
  currentPlayers: Users,
  purchases: DollarSign,
};

const n0 = (v: number | null | undefined) => v ?? 0;

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

const PROVIDER_ORDER: StoreProvider[] = ["itch", "steam", "play"];

export type StorePanelId =
  | "ccu"
  | "mobileGrowth"
  | "steamNews"
  | "communityFeedback"
  | "revenuePerStore"
  | "leaderboard"
  | "globalStats";

/** Which panels have a possible data source, given the connected stores. */
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
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function relativeTime(iso: string | number, language: string): string {
  const ts = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const minutes = Math.floor((Date.now() - ts) / 60000);
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

function localeOf(language: string): string {
  switch (language) {
    case "tr": return "tr-TR";
    case "fr": return "fr-FR";
    case "es": return "es-ES";
    default: return "en-US";
  }
}

/** The user-chosen accent (Settings → Appearance), read once per mount. */
function useAccentColor(): string {
  const [accent, setAccent] = useState("#a78bfa");
  useEffect(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    if (v) setAccent(v);
  }, []);
  return accent;
}

// Each section animates on its own mount (sections that appear after the
// first sync would otherwise miss a parent-driven stagger).
const reveal = (order: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, delay: order * 0.05, ease: [0.25, 1, 0.5, 1] as const },
});

interface GameSummary {
  gameId: string;
  title: string;
  cover: string | null;
  providers: StoreProvider[];
  totals: Record<MetricKey, number | null>;
  /** downloads / views over the stores that report BOTH (Itch.io). */
  downloadRate: number | null;
  rating: number | null;
  ratingCount: number;
  currency: string | null;
  errors: { provider: StoreProvider; message: string }[];
}

interface CompareItem {
  id: string;
  name: string;
  providers: StoreProvider[];
  value: number;
  gameId?: string;
}

export function StoreHub() {
  const { games, language, ui, setWorkspaceTab, setSelectedId } = useAppStore();
  const t = ui as unknown as Record<string, string>;
  const tr = (en: string, trText: string) => (language === "tr" ? trText : en);
  const accent = useAccentColor();

  const locale = localeOf(language);
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    [locale],
  );
  const pctFmt = useMemo(
    () => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
    [locale],
  );
  // Full numbers below a million: the Turkish compact "59,7 B" (bin)
  // reads as "billion" to many people.
  const fmtNum = (n: number) => (Math.abs(n) >= 1_000_000 ? compact.format(n) : nf.format(n));
  const fmtMoney = (n: number, cur: string | null, whole = false) => {
    try {
      const noCents = whole || n === 0 || Math.abs(n) >= 100000;
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: cur || "USD",
        minimumFractionDigits: noCents ? 0 : undefined,
        maximumFractionDigits: noCents ? 0 : 2,
      }).format(n);
    } catch {
      return `${n.toFixed(2)} ${cur ?? "USD"}`;
    }
  };
  const fmtDec = (n: number, digits: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

  const metricLabel: Record<CompareKey, string> = {
    views: tr("Page views", "Sayfa görüntülenme"),
    downloads: tr("Downloads", "İndirme"),
    purchases: tr("Purchases", "Satış"),
    earnings: tr("Revenue", "Gelir"),
    wishlist: tr("Wishlists", "İstek listesi"),
    currentPlayers: tr("Playing now", "Şu an oynayan"),
    rating: tr("Rating", "Puan"),
  };

  const mappedTargets = useMemo(() => mappedStoreTargets(games), [games]);

  // Numbers already fetched this session (by an earlier visit or the
  // background sync) show immediately; a refresh follows.
  const [rows, setRows] = useState<AggregateRow[]>(() => cachedRows(mappedTargets)?.rows ?? []);
  const [loading, setLoading] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => cachedRows(mappedTargets)?.at ?? null);
  const [history, setHistory] = useState<StoreSnapshot[]>(() => loadHistory());
  const [trendMetric, setTrendMetric] = useState<MetricKey>("downloads");
  const [compareMode, setCompareMode] = useState<"games" | "stores">("games");
  const [compareMetric, setCompareMetric] = useState<CompareKey>("downloads");
  const [, setTick] = useState(0);

  // Keep "5 min ago" labels honest.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const fetchAll = async () => {
    if (mappedTargets.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    const results = await syncTargets(mappedTargets);
    setRows(results);
    setHistory(loadHistory());
    setLoading(false);
    setLastSyncAt(Date.now());
  };

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedTargets.length]);

  // Background sync (Settings → API keys → Sync interval) landed.
  useEffect(() => {
    const onSync = () => {
      if (loading) return;
      const hit = cachedRows(mappedTargets);
      if (!hit) return;
      setRows(hit.rows);
      setLastSyncAt(hit.at);
      setHistory(loadHistory());
    };
    window.addEventListener("heravex:store-sync", onSync);
    return () => window.removeEventListener("heravex:store-sync", onSync);
  }, [mappedTargets, loading]);

  // ── Derived data ──────────────────────────────────────────────────────
  const okRows = useMemo(() => rows.filter((r) => !r.error), [rows]);
  const failedRows = useMemo(() => rows.filter((r) => r.error), [rows]);

  const totals = useMemo(() => {
    const acc: Record<MetricKey, number> = { views: 0, downloads: 0, purchases: 0, earnings: 0, wishlist: 0, currentPlayers: 0 };
    const reported = new Set<MetricKey>();
    const currencies = new Set<string>();
    let ratingWeighted = 0;
    let ratingCount = 0;
    for (const r of okRows) {
      for (const k of METRIC_ORDER) {
        const v = r[k];
        if (v == null) continue;
        reported.add(k);
        acc[k] += v;
      }
      if (r.currency && n0(r.earnings) > 0) currencies.add(r.currency);
      const c = r.ratingCount ?? 0;
      if (c > 0 && r.ratingAverage != null) {
        ratingWeighted += r.ratingAverage * c;
        ratingCount += c;
      }
    }
    // Before the first sync, availability comes from which stores are mapped.
    if (okRows.length === 0) {
      for (const m of mappedTargets) REPORTS[m.provider].forEach((k) => reported.add(k));
    }
    return {
      ...acc,
      reported,
      currency: currencies.size > 0 ? Array.from(currencies)[0] : null,
      mixedCurrency: currencies.size > 1,
      rating: ratingCount > 0 ? ratingWeighted / ratingCount : null,
      ratingCount,
    };
  }, [okRows, mappedTargets]);

  const prev = useMemo(() => previousSnapshot(history), [history]);
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return dayKey(d);
  }, []);

  const formatMetric = (k: CompareKey, n: number, whole = false) =>
    k === "earnings" ? fmtMoney(n, totals.currency, whole) : k === "rating" ? fmtDec(n, 1) : fmtNum(n);

  const summaryMetrics = SUMMARY_PRIORITY.filter((k) => totals.reported.has(k)).slice(0, 3);
  const trendOptions = TREND_METRICS.filter((k) => totals.reported.has(k));
  useEffect(() => {
    if (trendOptions.length > 0 && !trendOptions.includes(trendMetric)) setTrendMetric(trendOptions[0]);
  }, [trendOptions, trendMetric]);

  const gameSummaries = useMemo<GameSummary[]>(() => {
    const byGame = new Map<string, GameSummary & { _rw: number; _views: number; _dl: number }>();
    for (const r of rows) {
      let g = byGame.get(r.gameId);
      if (!g) {
        g = {
          gameId: r.gameId,
          title: r.title,
          cover: r.cover,
          providers: [],
          totals: { views: null, downloads: null, purchases: null, earnings: null, wishlist: null, currentPlayers: null },
          downloadRate: null,
          rating: null,
          ratingCount: 0,
          currency: null,
          errors: [],
          _rw: 0,
          _views: 0,
          _dl: 0,
        };
        byGame.set(r.gameId, g);
      }
      g.providers.push(r.provider);
      if (r.error) {
        g.errors.push({ provider: r.provider, message: shortError(r.error) });
        continue;
      }
      for (const k of METRIC_ORDER) {
        const v = r[k];
        if (v != null) g.totals[k] = n0(g.totals[k]) + v;
      }
      if (r.views != null && r.views > 0 && r.downloads != null) {
        g._views += r.views;
        g._dl += r.downloads;
      }
      const c = r.ratingCount ?? 0;
      if (c > 0 && r.ratingAverage != null) {
        g._rw += r.ratingAverage * c;
        g.ratingCount += c;
      }
      if (!g.currency && r.currency && n0(r.earnings) > 0) g.currency = r.currency;
    }
    const list = Array.from(byGame.values()).map(({ _rw, _views, _dl, ...g }) => ({
      ...g,
      providers: PROVIDER_ORDER.filter((p) => g.providers.includes(p)),
      downloadRate: _views > 0 ? _dl / _views : null,
      rating: g.ratingCount > 0 ? _rw / g.ratingCount : null,
    }));
    const score = (g: GameSummary) =>
      n0(g.totals.downloads) * 1e6 + n0(g.totals.wishlist) * 1e3 + n0(g.totals.views);
    return list.sort((a, b) => score(b) - score(a));
  }, [rows]);

  const storeSummaries = useMemo(() => {
    return PROVIDER_ORDER.flatMap((provider) => {
      const own = rows.filter((r) => r.provider === provider);
      if (own.length === 0) return [];
      const ok = own.filter((r) => !r.error);
      const sum = (k: MetricKey) => ok.reduce((a, r) => a + n0(r[k]), 0);
      let rw = 0;
      let rc = 0;
      for (const r of ok) {
        const c = r.ratingCount ?? 0;
        if (c > 0 && r.ratingAverage != null) {
          rw += r.ratingAverage * c;
          rc += c;
        }
      }
      const news = ok
        .filter((r) => r.lastNewsTitle && r.lastNewsAt)
        .sort((a, b) => (b.lastNewsAt ?? "").localeCompare(a.lastNewsAt ?? ""))[0] ?? null;
      return [{
        provider,
        games: own.length,
        failed: own.length - ok.length,
        totals: Object.fromEntries(
          METRIC_ORDER.map((k) => [k, REPORTS[provider].has(k) && ok.length > 0 ? sum(k) : null]),
        ) as Record<MetricKey, number | null>,
        rating: rc > 0 ? rw / rc : null,
        news,
        installs: ok.reduce((a, r) => a + n0(r.activeInstalls), 0),
        uninstalls: ok.reduce((a, r) => a + n0(r.uninstalls), 0),
      }];
    });
  }, [rows]);

  // ── Comparison ────────────────────────────────────────────────────────
  const compareSource = compareMode === "stores" && storeSummaries.length > 1 ? "stores" : "games";
  const compareOptions = COMPARE_METRICS.filter((k) => (k === "rating" ? totals.rating != null : totals.reported.has(k)));
  useEffect(() => {
    if (compareOptions.length > 0 && !compareOptions.includes(compareMetric)) setCompareMetric(compareOptions[0]);
  }, [compareOptions, compareMetric]);

  const compareRaw: (Omit<CompareItem, "value"> & { value: number | null })[] =
    compareSource === "games"
      ? gameSummaries.map((g) => ({
          id: g.gameId,
          name: g.title,
          providers: g.providers,
          gameId: g.gameId,
          value: compareMetric === "rating" ? g.rating : g.totals[compareMetric],
        }))
      : storeSummaries.map((s) => ({
          id: s.provider,
          name: PROVIDER_LABEL[s.provider],
          providers: [s.provider],
          gameId: undefined,
          value: compareMetric === "rating" ? s.rating : s.totals[compareMetric],
        }));
  const compareItems = compareRaw
    .filter((i): i is CompareItem => i.value != null)
    .sort((a, b) => b.value - a.value);
  const compareTotal = compareItems.reduce((a, i) => a + i.value, 0);
  const compareMax = compareMetric === "rating" ? 5 : compareItems[0]?.value ?? 0;
  const additive = compareMetric !== "rating";

  const openGame = (gameId: string) => {
    setSelectedId(gameId);
    setWorkspaceTab("library");
  };

  const connected = PROVIDER_ORDER.filter((p) => mappedTargets.some((m) => m.provider === p));
  const notConnected = PROVIDER_ORDER.filter((p) => !connected.includes(p));

  // ── EMPTY STATE: nothing mapped yet ──────────────────────────────────
  if (mappedTargets.length === 0 && !loading) {
    return (
      <motion.div className="page-fade sh-page" {...reveal(0)}>
        <section className="panel storehub-hero sh-hero">
          <div className="storehub-hero-icon"><Store size={26} strokeWidth={2} /></div>
          <div className="sh-hero-text">
            <p className="eyebrow">{tr("STORE CENTER", "MAĞAZA MERKEZİ")}</p>
            <h2>{tr("Connect a game to a store", "Bir oyunu mağazaya bağla")}</h2>
            <ol className="sh-empty-steps">
              <li>{tr("Add your store API keys in Settings.", "Mağaza API anahtarlarını Ayarlar'a ekle.")}</li>
              <li>{tr("Open a game in the Library and link its store page.", "Kütüphane'de bir oyunu aç ve mağaza sayfasını bağla.")}</li>
              <li>{tr("Views, downloads and revenue appear here.", "Görüntülenme, indirme ve gelir burada görünür.")}</li>
            </ol>
            <div className="sh-empty-actions">
              <button type="button" className="primary-button compact-button" onClick={() => setWorkspaceTab("profile")}>
                <Link2 size={14} /> {tr("Add API keys", "API anahtarı ekle")}
              </button>
              <button type="button" className="secondary-button compact-button" onClick={() => setWorkspaceTab("library")}>
                {tr("Open library", "Kütüphaneyi aç")}
              </button>
            </div>
          </div>
        </section>
      </motion.div>
    );
  }

  const firstLoad = loading && rows.length === 0;
  const showTrend = history.length >= 2 && trendOptions.length > 0;
  const chartData = history.map((s) => ({
    label: `${s.day.slice(8, 10)}.${s.day.slice(5, 7)}`,
    value: s[trendMetric] ?? 0,
  }));
  const statCount = summaryMetrics.length + (totals.rating != null ? 1 : 0);

  const changeOf = (k: MetricKey): { tone: "neutral" | "success" | "danger"; text: string; up?: boolean } => {
    if (!prev) return { tone: "neutral", text: tr("Change shows tomorrow", "Değişim yarın görünür") };
    const diff = totals[k] - prev[k];
    const since = prev.day === yesterday
      ? tr("since yesterday", "dünden beri")
      : tr(`since ${prev.day.slice(8, 10)}.${prev.day.slice(5, 7)}`, `${prev.day.slice(8, 10)}.${prev.day.slice(5, 7)} tarihinden beri`);
    if (diff === 0) return { tone: "neutral", text: tr(`No change ${since}`, `${since.charAt(0).toLocaleUpperCase("tr")}${since.slice(1)} değişmedi`) };
    return {
      tone: diff > 0 ? "success" : "danger",
      up: diff > 0,
      text: `${diff > 0 ? "+" : "-"}${formatMetric(k, Math.abs(diff))} ${since}`,
    };
  };

  const panelHead = (Icon: typeof Store, eyebrow: string, title: string, right?: ReactNode) => (
    <div className="panel-head sh-panel-head">
      <div className="sh-head-title">
        <div className="financial-report-head-icon"><Icon size={18} strokeWidth={2.1} /></div>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
      </div>
      {right}
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="page-fade sh-page">
        {/* ── 1. Hero ─────────────────────────────────────────────── */}
        <motion.section className="panel storehub-hero sh-hero" {...reveal(0)}>
          <div className="storehub-hero-icon"><Store size={26} strokeWidth={2} /></div>
          <div className="sh-hero-text">
            <p className="eyebrow">{tr("STORE CENTER", "MAĞAZA MERKEZİ")}</p>
            <h2>{t.storeHubTitle ?? tr("Store analytics", "Mağaza analitikleri")}</h2>
            <div className="sh-hero-stores">
              {connected.map((p) => {
                const Icon = PROVIDER_ICON[p];
                const n = new Set(mappedTargets.filter((m) => m.provider === p).map((m) => m.gameId)).size;
                return (
                  <span key={p} className="sh-store-tag">
                    <Icon size={12} style={{ color: PROVIDER_COLOR[p] }} />
                    {PROVIDER_LABEL[p]}
                    <small>{tr(`${n} ${n === 1 ? "game" : "games"}`, `${n} oyun`)}</small>
                  </span>
                );
              })}
              {notConnected.map((p) => (
                <button key={p} type="button" className="sh-store-tag is-add" onClick={() => setWorkspaceTab("profile")}>
                  <Plus size={12} />
                  {tr(`Connect ${PROVIDER_LABEL[p]}`, `${PROVIDER_LABEL[p]} bağla`)}
                </button>
              ))}
            </div>
          </div>
          <div className="sh-hero-actions">
            <span className="sh-sync-meta">
              {loading
                ? tr("Fetching from your stores", "Mağazalardan alınıyor")
                : lastSyncAt
                  ? tr(`Updated ${relativeTime(lastSyncAt, language)}`, `Güncellendi: ${relativeTime(lastSyncAt, language)}`)
                  : ""}
            </span>
            <button
              type="button"
              className="secondary-button compact-button sh-refresh"
              onClick={() => void fetchAll()}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? "spin" : ""} />
              {loading ? tr("Updating", "Güncelleniyor") : tr("Refresh", "Yenile")}
            </button>
          </div>
        </motion.section>

        {failedRows.length > 0 && (
          <motion.div className="sh-banner" role="alert" {...reveal(1)}>
            <AlertTriangle size={15} />
            <span>
              {tr(
                `Could not read ${failedRows.length} store ${failedRows.length === 1 ? "link" : "links"}. Totals leave ${failedRows.length === 1 ? "it" : "them"} out; the game list below shows why.`,
                `${failedRows.length} mağaza bağlantısı okunamadı. Toplamlara dahil edilmedi, sebebi aşağıdaki oyun listesinde yazıyor.`,
              )}
            </span>
          </motion.div>
        )}

        {/* ── 2. Stat cards ───────────────────────────────────────── */}
        <motion.section
          className="sh-stats"
          style={{ "--sh-cols": String(Math.max(1, firstLoad ? 3 : statCount)) } as CSSProperties}
          aria-label={tr("Summary", "Özet")}
          {...reveal(2)}
        >
          {firstLoad
            ? [0, 1, 2].map((i) => (
                <div key={i} className="skeleton-card">
                  <div className="skeleton skeleton-icon" />
                  <div className="skeleton-body">
                    <div className="skeleton skeleton-line skeleton-line-sm" />
                    <div className="skeleton skeleton-line skeleton-line-lg" />
                  </div>
                </div>
              ))
            : (
              <>
                {summaryMetrics.map((k) => {
                  const Icon = METRIC_ICON[k];
                  const ch = changeOf(k);
                  return (
                    <div key={k} className="hero-stat-card sh-stat" style={{ "--hero-accent": METRIC_ACCENT[k] } as CSSProperties}>
                      <div className="hero-stat-icon"><Icon size={22} strokeWidth={2} /></div>
                      <div className="hero-stat-body">
                        <span className="hero-stat-label">{metricLabel[k]}</span>
                        <strong className="hero-stat-value" title={nf.format(totals[k])}>
                          {formatMetric(k, totals[k], totals[k] >= 1000)}
                        </strong>
                        <span className={`burn-card-subtitle burn-card-subtitle-${ch.tone} sh-change`}>
                          {ch.up === true && <ArrowUpRight size={12} />}
                          {ch.up === false && <ArrowDownRight size={12} />}
                          {ch.text}
                        </span>
                      </div>
                      <div className="hero-stat-bar" />
                    </div>
                  );
                })}
                {totals.rating != null && (
                  <div className="hero-stat-card sh-stat" style={{ "--hero-accent": "#fbbf24" } as CSSProperties}>
                    <div className="hero-stat-icon"><Star size={22} strokeWidth={2} /></div>
                    <div className="hero-stat-body">
                      <span className="hero-stat-label">{tr("Player rating", "Oyuncu puanı")}</span>
                      <strong className="hero-stat-value">
                        {fmtDec(totals.rating, 1)}<span className="sh-stat-suffix"> / 5</span>
                      </strong>
                      <span className="burn-card-subtitle burn-card-subtitle-neutral">
                        {tr(`from ${nf.format(totals.ratingCount)} ratings`, `${nf.format(totals.ratingCount)} oydan`)}
                      </span>
                    </div>
                    <div className="hero-stat-bar" />
                  </div>
                )}
              </>
            )}
        </motion.section>
        {totals.mixedCurrency && (
          <p className="sh-note">
            {tr(
              "Your stores pay in different currencies. Revenue is added up as-is and shown in the first currency.",
              "Mağazaların farklı para birimleriyle ödüyor. Gelir olduğu gibi toplanıp ilk para biriminde gösteriliyor.",
            )}
          </p>
        )}

        {/* ── 3. Compare | Games (equal height) ───────────────────── */}
        <div className={"sh-duo" + (firstLoad ? " is-loading" : "")}>
          {!firstLoad && (
            <motion.section className="panel sh-compare" {...reveal(3)}>
              {panelHead(
                BarChart3,
                tr("COMPARE", "KARŞILAŞTIRMA"),
                compareSource === "games" ? tr("Games side by side", "Oyunlar yan yana") : tr("Stores side by side", "Mağazalar yan yana"),
                storeSummaries.length > 1 && (
                  <div className="sh-segment" role="tablist" aria-label={tr("Compare", "Karşılaştır")}>
                    {(["games", "stores"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={compareSource === m}
                        className={compareSource === m ? "is-active" : undefined}
                        onClick={() => setCompareMode(m)}
                      >
                        {m === "games" ? tr("Games", "Oyunlar") : tr("Stores", "Mağazalar")}
                      </button>
                    ))}
                  </div>
                ),
              )}
              {compareOptions.length > 1 && (
                <div className="sh-chips" role="tablist" aria-label={tr("Metric", "Metrik")}>
                  {compareOptions.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={compareMetric === k}
                      className={"filter-chip" + (compareMetric === k ? " filter-chip-active" : "")}
                      onClick={() => setCompareMetric(k)}
                    >
                      {metricLabel[k]}
                    </button>
                  ))}
                </div>
              )}
              {compareItems.length === 0 ? (
                <div className="chart-empty-hint">
                  {tr("No numbers for this metric yet.", "Bu metrik için henüz rakam yok.")}
                </div>
              ) : (
                <ol className="sh-bars">
                  {compareItems.map((item, i) => {
                    const pct = compareMax > 0 ? (item.value / compareMax) * 100 : 0;
                    const gameId = item.gameId;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="sh-bar-row"
                          onClick={gameId ? () => openGame(gameId) : undefined}
                          disabled={!gameId}
                        >
                          <span className={"sh-rank" + (i === 0 && compareItems.length > 1 ? " is-first" : "")}>{i + 1}</span>
                          <span className="sh-bar-main">
                            <span className="sh-bar-top">
                              <span className="sh-bar-name">
                                {item.name}
                                <span className="sh-bar-stores">
                                  {item.providers.map((p) => {
                                    const Icon = PROVIDER_ICON[p];
                                    return <Icon key={p} size={11} style={{ color: PROVIDER_COLOR[p] }} />;
                                  })}
                                </span>
                              </span>
                              <span className="sh-bar-value">
                                {formatMetric(compareMetric, item.value)}
                                {additive && compareTotal > 0 && compareItems.length > 1 && (
                                  <small>{pctFmt.format(item.value / compareTotal)}</small>
                                )}
                              </span>
                            </span>
                            <span className="sh-bar-track">
                              <motion.span
                                style={{ background: i === 0 ? accent : `color-mix(in srgb, ${accent} 45%, transparent)` }}
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.max(item.value > 0 ? 2 : 0, pct)}%` }}
                                transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1], delay: i * 0.04 }}
                              />
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {compareItems.length > 1 && additive && (
                <div className="sh-compare-total">
                  <span>
                    {tr(
                      `Total across ${compareItems.length} ${compareSource === "games" ? "games" : "stores"}`,
                      `${compareItems.length} ${compareSource === "games" ? "oyunun" : "mağazanın"} toplamı`,
                    )}
                  </span>
                  <strong>{formatMetric(compareMetric, compareTotal)}</strong>
                </div>
              )}
              {compareItems.length === 1 && compareSource === "games" && (
                <p className="sh-note sh-note-inset">
                  {tr("Link more games to stores to compare them here.", "Burada karşılaştırmak için daha fazla oyunu mağazaya bağla.")}
                </p>
              )}
            </motion.section>
          )}
          <div className="sh-games-slot">
            <motion.section className="panel sh-games-panel" {...reveal(4)}>
              {panelHead(Gamepad2, tr("GAMES", "OYUNLAR"), tr("Details per game", "Oyun bazında ayrıntılar"))}
              <ul className="sh-game-list">
                {firstLoad
                  ? Array.from(new Set(mappedTargets.map((m) => m.gameId))).map((id) => (
                      <li key={id} className="sh-game is-loading">
                        <div className="skeleton sh-game-cover" />
                        <div className="sh-game-body">
                          <div className="skeleton skeleton-line skeleton-line-sm" />
                          <div className="skeleton skeleton-line skeleton-line-lg" />
                        </div>
                      </li>
                    ))
                  : gameSummaries.map((g) => {
                      const src = imgSrc(g.cover);
                      const stats: { key: string; value: string; label: string }[] = [];
                      for (const k of ["downloads", "earnings", "views", "wishlist", "currentPlayers"] as MetricKey[]) {
                        const v = g.totals[k];
                        if (v == null) continue;
                        stats.push({
                          key: k,
                          value: k === "earnings" ? fmtMoney(v, g.currency ?? totals.currency) : fmtNum(v),
                          label: metricLabel[k],
                        });
                      }
                      if (g.downloadRate != null) {
                        // Only Itch.io reports page views, so the rate is Itch-only;
                        // say so when the card also sums other stores' downloads.
                        stats.push({
                          key: "rate",
                          value: pctFmt.format(g.downloadRate),
                          label: g.providers.length > 1 ? tr("Itch.io download rate", "Itch.io indirme oranı") : tr("Download rate", "İndirme oranı"),
                        });
                      }
                      return (
                        <li key={g.gameId}>
                          <button type="button" className="sh-game" onClick={() => openGame(g.gameId)}>
                            <span className="sh-game-cover">
                              {src ? <img src={src} alt="" /> : <span>{g.title.slice(0, 1).toUpperCase()}</span>}
                            </span>
                            <span className="sh-game-body">
                              <span className="sh-game-head">
                                <span className="sh-game-title">{g.title}</span>
                                <span className="sh-game-stores">
                                  {g.providers.map((p) => {
                                    const Icon = PROVIDER_ICON[p];
                                    return (
                                      <span key={p} className="sh-store-tag">
                                        <Icon size={11} style={{ color: PROVIDER_COLOR[p] }} />
                                        {PROVIDER_LABEL[p]}
                                      </span>
                                    );
                                  })}
                                </span>
                              </span>
                              {stats.length > 0 && (
                                <span className="sh-game-stats">
                                  {stats.map((s) => (
                                    <span key={s.key} className="sh-game-stat">
                                      <strong>{s.value}</strong>
                                      <small>{s.label}</small>
                                    </span>
                                  ))}
                                  {g.rating != null && (
                                    <span className="sh-game-stat">
                                      <strong className="sh-rating"><Star size={12} fill="currentColor" />{fmtDec(g.rating, 1)}</strong>
                                      <small>{tr("Rating", "Puan")}</small>
                                    </span>
                                  )}
                                </span>
                              )}
                              {g.errors.map((e) => (
                                <span key={e.provider} className="sh-game-error">
                                  <AlertTriangle size={12} />
                                  {tr(`${PROVIDER_LABEL[e.provider]} could not be read: `, `${PROVIDER_LABEL[e.provider]} okunamadı: `)}
                                  {e.message}
                                </span>
                              ))}
                            </span>
                            <ChevronRight size={16} className="sh-game-chevron" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
              </ul>
              {!showTrend && !firstLoad && (
                <p className="sh-note sh-note-inset">
                  {tr(
                    "A day-by-day chart appears once HeraVex has numbers from two different days. They stay on this computer.",
                    "HeraVex iki farklı günün rakamlarını topladığında günlük gidişat grafiği belirir. Rakamlar bu bilgisayarda kalır.",
                  )}
                </p>
              )}
            </motion.section>
          </div>
        </div>

        {/* ── 4. Trend (only with real history) ───────────────────── */}
        {showTrend && !firstLoad && (
          <motion.section className="panel sh-trend" {...reveal(5)}>
            {panelHead(
              TrendingUp,
              tr("TREND", "GİDİŞAT"),
              tr("Day by day", "Günlük gidişat"),
              trendOptions.length > 1 && (
                <div className="sh-segment" role="tablist" aria-label={tr("Chart metric", "Grafik metriği")}>
                  {trendOptions.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={trendMetric === k}
                      className={trendMetric === k ? "is-active" : undefined}
                      onClick={() => setTrendMetric(k)}
                    >
                      {metricLabel[k]}
                    </button>
                  ))}
                </div>
              ),
            )}
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="sh-trend-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={METRIC_ACCENT[trendMetric]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={METRIC_ACCENT[trendMetric]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} stroke="rgba(255,255,255,0.08)" tickLine={false} minTickGap={18} />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  stroke="transparent"
                  width={56}
                  tickFormatter={(v) => formatMetric(trendMetric, Number(v), true)}
                />
                <RechartsTooltip
                  cursor={{ stroke: "rgba(255,255,255,0.12)" }}
                  contentStyle={{
                    background: "rgba(15, 22, 36, 0.96)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "#94a3b8", fontSize: 10 }}
                  formatter={(v) => [formatMetric(trendMetric, Number(v ?? 0)), metricLabel[trendMetric]]}
                />
                <Area type="monotone" dataKey="value" stroke={METRIC_ACCENT[trendMetric]} strokeWidth={2} fill="url(#sh-trend-grad)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </motion.section>
        )}

      </div>
    </MotionConfig>
  );
}
