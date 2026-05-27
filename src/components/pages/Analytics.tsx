import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend,
} from "recharts";
import {
  Flame, TrendingUp, TrendingDown, Wallet as WalletIcon, RefreshCw,
  FileDown, ChevronDown, Loader2, FileText, FileSpreadsheet, Code2,
  BarChart3, Eye, Download, X,
} from "lucide-react";
import { useAppStore } from "../../store";
import { calculateAccumulatedAmount } from "../PieChartWidget";
import {
  fetchStoreData,
  exportFinancialCsv,
  exportFinancialJson,
  exportFinancialPdf,
  revealInFolder,
  type FinancialReportPayload,
  type FinancialExportRow,
} from "../../lib/storage";
import type { ExpenseItem } from "../../types";

const PALETTE = ["#4f8cff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#fb7185", "#facc15"];

// Semantic colors for common expense categories
const CATEGORY_COLOR_MAP: Record<string, string> = {
  marketing: "#f97316",     // orange
  pazarlama: "#f97316",
  art: "#4f8cff",           // blue
  asset: "#4f8cff",
  assets: "#4f8cff",
  çizim: "#4f8cff",
  cizim: "#4f8cff",
  license: "#a78bfa",       // purple
  licenses: "#a78bfa",
  lisans: "#a78bfa",
  sound: "#34d399",         // green
  ses: "#34d399",
  müzik: "#34d399",
  muzik: "#34d399",
  music: "#34d399",
  code: "#22d3ee",          // cyan
  kod: "#22d3ee",
  software: "#22d3ee",
  yazılım: "#22d3ee",
  yazilim: "#22d3ee",
  hardware: "#fb7185",      // rose
  donanım: "#fb7185",
  donanim: "#fb7185",
  office: "#facc15",        // yellow
  ofis: "#facc15",
  tax: "#f87171",           // red
  vergi: "#f87171",
};

function colorFor(category: string, fallbackIndex: number): string {
  const key = category.trim().toLowerCase();
  return CATEGORY_COLOR_MAP[key] ?? PALETTE[fallbackIndex % PALETTE.length];
}

function isWithinDays(dateStr: string, days: number) {
  const ts = Date.parse(dateStr);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= days * 24 * 60 * 60 * 1000;
}

function isThisMonth(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

type RangeKey = "this-month" | "last-3-months" | "all-time";
type ExportFormat = "pdf" | "csv" | "json";

export function Analytics() {
  const { games, globalExpenses, exchangeRates, language, showToast, showError, setWorkspaceTab } = useAppStore();
  const [earnings, setEarnings] = useState<{ total: number; currency: string | null }>({ total: 0, currency: null });
  const [loadingRoi, setLoadingRoi] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Financial report state ──────────────────────────────────────────
  const [rangeKey, setRangeKey] = useState<RangeKey>("this-month");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const rate = (c: string) => exchangeRates[c] ?? 1;

  // Aggregate all expenses (project + global) in USD
  const allExpenses = useMemo<ExpenseItem[]>(
    () => [
      ...games.flatMap((g) => g.expenses ?? []),
      ...globalExpenses,
    ],
    [games, globalExpenses]
  );

  const totalSpend = useMemo(
    () =>
      allExpenses.reduce(
        (s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")),
        0
      ),
    [allExpenses, exchangeRates]
  );

  const thisMonthSpend = useMemo(
    () =>
      allExpenses
        .filter((e) => isThisMonth(e.spentAt))
        .reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0),
    [allExpenses, exchangeRates]
  );

  // ── Last month spend (for delta comparison) ────────────────────────────────
  const lastMonthSpend = useMemo(() => {
    const now = new Date();
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lmYear = lm.getFullYear();
    const lmMonth = lm.getMonth();
    return allExpenses
      .filter((e) => {
        const d = new Date(e.spentAt);
        return d.getFullYear() === lmYear && d.getMonth() === lmMonth;
      })
      .reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0);
  }, [allExpenses, exchangeRates]);

  // Percentage delta vs last month — null when no baseline exists.
  const monthlyDelta = useMemo(() => {
    if (lastMonthSpend <= 0) return null;
    return ((thisMonthSpend - lastMonthSpend) / lastMonthSpend) * 100;
  }, [thisMonthSpend, lastMonthSpend]);

  // Whether any project has a budget set (drives the "Bütçe ayarla →" CTA)
  const hasAnyBudget = useMemo(
    () => games.some((g) => g.budget && g.budget > 0),
    [games]
  );

  // Burn rate = avg daily spend over last 30 days
  const burnRate = useMemo(() => {
    const last30 = allExpenses
      .filter((e) => isWithinDays(e.spentAt, 30))
      .reduce((s, e) => s + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")), 0);
    return last30 / 30;
  }, [allExpenses, exchangeRates]);

  // Remaining budget across all games with a budget set
  const remainingBudget = useMemo(() => {
    return games.reduce((s, g) => {
      if (!g.budget) return s;
      const spent = (g.expenses ?? []).reduce(
        (ss, e) => ss + calculateAccumulatedAmount(e, rate(e.currency ?? "USD")),
        0
      );
      return s + Math.max(0, g.budget - spent);
    }, 0);
  }, [games, exchangeRates]);

  // Category breakdown for donut (with semantic colors)
  const categoryData = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of allExpenses) {
      const cat = (e.category || tr("Uncategorized", "Kategorisiz")).trim() || tr("Uncategorized", "Kategorisiz");
      const amt = calculateAccumulatedAmount(e, rate(e.currency ?? "USD"));
      map.set(cat, (map.get(cat) ?? 0) + amt);
    }
    return Array.from(map.entries())
      .map(([name, value], i) => ({
        name,
        value: Number(value.toFixed(2)),
        color: colorFor(name, i),
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [allExpenses, exchangeRates, language]);

  // Fetch itch earnings for all mapped games (ROI signal)
  const refreshEarnings = async () => {
    setLoadingRoi(true);
    let total = 0;
    let currency: string | null = null;
    for (const g of games) {
      const itchId = g.storeMappings?.itch?.id;
      if (!itchId) continue;
      try {
        const data = await fetchStoreData("itch", itchId);
        if (data.earnings != null) {
          // Convert to USD if currency present and rate known
          const c = data.currency ?? "USD";
          const usd = data.earnings * (1 / (rate(c) || 1));
          total += usd;
          currency = currency ?? c;
        }
      } catch {
        // skip silently — toast not needed for aggregate
      }
    }
    setEarnings({ total, currency });
    setLoadingRoi(false);
  };

  useEffect(() => {
    // initial silent attempt only if itch mappings exist
    const hasItch = games.some((g) => g.storeMappings?.itch?.id);
    if (hasItch) void refreshEarnings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const usd = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`;

  const roiPositive = earnings.total >= totalSpend;
  const roiRatio = totalSpend > 0 ? Math.min(1.5, earnings.total / totalSpend) : 0;

  // ── Build financial report payload ───────────────────────────────────
  const filterByRange = (dateStr: string): boolean => {
    if (rangeKey === "all-time") return true;
    if (rangeKey === "this-month") return isThisMonth(dateStr);
    return isWithinDays(dateStr, 90);
  };

  const rangeLabel: Record<RangeKey, string> = {
    "this-month": tr("This Month", "Bu Ay"),
    "last-3-months": tr("Last 3 Months", "Son 3 Ay"),
    "all-time": tr("All Time", "Tüm Zamanlar"),
  };

  const buildReport = (): FinancialReportPayload => {
    const rows: FinancialExportRow[] = [];

    // Per-game expenses
    for (const g of games) {
      for (const e of g.expenses ?? []) {
        if (!filterByRange(e.spentAt)) continue;
        rows.push({
          date: e.spentAt,
          kind: "expense",
          category: e.category || tr("Uncategorized", "Kategorisiz"),
          project: g.title,
          description: e.title,
          amount: calculateAccumulatedAmount(e, rate(e.currency ?? "USD")),
          currency: "USD",
        });
      }
    }
    // Global expenses
    for (const e of globalExpenses) {
      if (!filterByRange(e.spentAt)) continue;
      rows.push({
        date: e.spentAt,
        kind: "expense",
        category: e.category || tr("Uncategorized", "Kategorisiz"),
        project: tr("General", "Genel"),
        description: e.title,
        amount: calculateAccumulatedAmount(e, rate(e.currency ?? "USD")),
        currency: "USD",
      });
    }

    // Income (from earnings if available)
    if (earnings.total > 0) {
      rows.push({
        date: new Date().toISOString().slice(0, 10),
        kind: "income",
        category: tr("Store Revenue", "Mağaza Geliri"),
        project: tr("All Stores", "Tüm Mağazalar"),
        description: tr("Itch.io aggregated earnings", "Itch.io toplu kazanç"),
        amount: earnings.total,
        currency: "USD",
      });
    }

    const totalExpense = rows
      .filter((r) => r.kind === "expense")
      .reduce((s, r) => s + r.amount, 0);
    const totalIncome = rows
      .filter((r) => r.kind === "income")
      .reduce((s, r) => s + r.amount, 0);
    const net = totalIncome - totalExpense;

    // Category breakdown (expenses only)
    const catMap = new Map<string, number>();
    for (const r of rows) {
      if (r.kind !== "expense") continue;
      catMap.set(r.category, (catMap.get(r.category) ?? 0) + r.amount);
    }
    const categoryBreakdown = Array.from(catMap.entries())
      .map(([category, amount], i) => ({
        category,
        amount: Number(amount.toFixed(2)),
        color: colorFor(category, i),
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      rangeLabel: rangeLabel[rangeKey],
      rangeFrom: null,
      rangeTo: null,
      totalIncome: Number(totalIncome.toFixed(2)),
      totalExpense: Number(totalExpense.toFixed(2)),
      net: Number(net.toFixed(2)),
      baseCurrency: "USD",
      categoryBreakdown,
      rows: rows.sort((a, b) => b.date.localeCompare(a.date)),
      generatedAt: new Date().toISOString(),
    };
  };

  const runExport = async (format: ExportFormat) => {
    setExporting(true);
    setMenuOpen(false);
    setExportFormat(format);
    try {
      const report = buildReport();
      let path: string;
      if (format === "pdf") path = await exportFinancialPdf(report);
      else if (format === "csv") path = await exportFinancialCsv(report);
      else path = await exportFinancialJson(report);

      // Custom toast: action button opens the containing folder
      showToast(
        tr(`Saved: ${path}`, `Kaydedildi: ${path}`),
        "success",
        () => {
          void revealInFolder(path);
        },
        tr("Open folder", "Klasörü aç")
      );
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showError(err);
    } finally {
      setExporting(false);
    }
  };

  const formatLabel: Record<ExportFormat, string> = {
    pdf: tr("Professional PDF Report", "Profesyonel PDF Raporu"),
    csv: tr("Excel Table (.csv)", "Excel Tablosu (.csv)"),
    json: tr("Raw Data (.json)", "Ham Veri (.json)"),
  };
  const formatIcon: Record<ExportFormat, typeof FileText> = {
    pdf: FileText,
    csv: FileSpreadsheet,
    json: Code2,
  };

  return (
    <motion.div
      className="page-fade analytics-page"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
    >
      {/* ── BURN RATE CARDS ─────────────────────────────────────────────── */}
      <motion.section
        className="analytics-burn-grid"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}
      >
        <BurnCard
          icon={WalletIcon}
          label={tr("This Month Spend", "Bu Ayki Gider")}
          value={usd(thisMonthSpend)}
          accent="#4f8cff"
          subtitle={
            monthlyDelta == null
              ? tr("first month tracked", "ilk takip ayı")
              : (monthlyDelta >= 0 ? "▲ " : "▼ ") +
                `${Math.abs(monthlyDelta).toFixed(0)}% ` +
                tr("vs last month", "geçen aya göre")
          }
          subtitleTone={
            monthlyDelta == null ? "neutral" : monthlyDelta >= 0 ? "danger" : "success"
          }
        />
        <BurnCard
          icon={Flame}
          label={tr("30-day Burn Rate", "30 Günlük Yakım Hızı")}
          value={`${usd(burnRate)}/${tr("day", "gün")}`}
          accent="#f87171"
          subtitle={
            burnRate > 0
              ? tr(
                  `At this rate ~ ${usd(burnRate * 30)}/mo`,
                  `Bu hızla ~${usd(burnRate * 30)}/ay`
                )
              : tr("nothing burned last 30d", "son 30g harcama yok")
          }
          subtitleTone="neutral"
        />
        <BurnCard
          icon={TrendingDown}
          label={tr("Total Spend", "Toplam Gider")}
          value={usd(totalSpend)}
          accent="#a78bfa"
          subtitle={tr("cumulative all-time", "kümülatif başlangıçtan beri")}
          subtitleTone="neutral"
        />
        <BurnCard
          icon={TrendingUp}
          label={tr("Remaining Budget", "Kalan Bütçe")}
          value={hasAnyBudget ? usd(remainingBudget) : "—"}
          accent="#34d399"
          subtitle={
            hasAnyBudget
              ? tr("across all projects", "tüm projelerde")
              : tr("Set a budget →", "Bütçe ayarla →")
          }
          subtitleTone={hasAnyBudget ? "neutral" : "link"}
          onSubtitleClick={hasAnyBudget ? undefined : () => setWorkspaceTab("library")}
        />
      </motion.section>

      {/* ── FINANCIAL REPORT PANEL ─────────────────────────────────────── */}
      <motion.section
        className="panel financial-report-panel"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.32 } } }}
      >
        <div className="financial-report-head">
          <div className="financial-report-head-icon">
            <FileDown size={20} strokeWidth={2.1} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow">{tr("EXPORT", "DIŞA AKTAR")}</p>
            <h3 style={{ margin: "2px 0 4px" }}>
              {tr("Prepare Financial Report", "Mali Rapor Hazırla")}
            </h3>
            <p className="section-copy" style={{ margin: 0, maxWidth: 540 }}>
              {tr(
                "Snapshot every expense (and earnings if available) into a PDF, Excel table or raw JSON.",
                "Tüm giderleri (ve varsa kazançları) PDF, Excel tablosu veya ham JSON olarak dışa aktar."
              )}
            </p>
          </div>
        </div>

        <div className="financial-report-controls">
          <div className="range-picker">
            <span className="range-picker-label">{tr("RANGE", "ARALIK")}</span>
            <div className="range-picker-chips">
              {(["this-month", "last-3-months", "all-time"] as RangeKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`filter-chip ${rangeKey === k ? "filter-chip-active" : ""}`}
                  onClick={() => setRangeKey(k)}
                  disabled={exporting}
                >
                  {rangeLabel[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="split-button-wrap" ref={menuRef}>
            <button
              type="button"
              className="split-button-primary"
              onClick={() => void runExport(exportFormat)}
              disabled={exporting}
            >
              {exporting ? (
                <>
                  <Loader2 size={14} className="spin" style={{ marginRight: 8 }} />
                  {tr("Generating…", "Hazırlanıyor…")}
                </>
              ) : (
                <>
                  {(() => {
                    const Icon = formatIcon[exportFormat];
                    return <Icon size={14} style={{ marginRight: 8 }} />;
                  })()}
                  {formatLabel[exportFormat]}
                </>
              )}
            </button>
            <button
              type="button"
              className="split-button-caret"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={exporting}
              title={tr("Choose format", "Format seç")}
            >
              <ChevronDown size={14} />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  className="split-button-menu"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  {(["pdf", "csv", "json"] as ExportFormat[]).map((f) => {
                    const Icon = formatIcon[f];
                    return (
                      <button
                        key={f}
                        type="button"
                        className={`split-menu-item ${exportFormat === f ? "is-current" : ""}`}
                        onClick={() => void runExport(f)}
                      >
                        <Icon size={14} style={{ marginRight: 8 }} />
                        <span>{formatLabel[f]}</span>
                        {f === "pdf" && (
                          <small className="split-menu-hint">
                            {tr("Publisher / investor", "Yayıncı / yatırımcı")}
                          </small>
                        )}
                        {f === "csv" && (
                          <small className="split-menu-hint">
                            {tr("Accounting", "Muhasebe")}
                          </small>
                        )}
                        {f === "json" && (
                          <small className="split-menu-hint">
                            {tr("Developer", "Geliştirici")}
                          </small>
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => setPreviewOpen(true)}
            disabled={exporting}
            title={tr("Preview range", "Aralığı önizle")}
          >
            <Eye size={13} style={{ marginRight: 6 }} />
            {tr("Preview", "Önizle")}
          </button>
        </div>
      </motion.section>

      {/* ── CATEGORY DONUT ──────────────────────────────────────────────── */}
      <motion.section
        className="panel"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, delay: 0.05 } } }}
      >
        <div className="panel-head">
          <div>
            <p className="eyebrow">{tr("CATEGORY SPLIT", "KATEGORİ DAĞILIMI")}</p>
            <h3>{tr("Where the money goes", "Para nereye gidiyor")}</h3>
          </div>
        </div>

        {categoryData.length === 0 ? (
          <div className="chart-empty-hint">
            {tr("No expenses logged yet.", "Henüz gider kaydedilmedi.")}
          </div>
        ) : (
          <div className="analytics-donut-row">
            <div className="analytics-donut">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    stroke="rgba(8,13,22,0.95)"
                    strokeWidth={2}
                  >
                    {categoryData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      color: "#f8fafc",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
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
          </div>
        )}
      </motion.section>

      {/* ── ROI SIGNAL ──────────────────────────────────────────────────── */}
      <motion.section
        className="panel"
        variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, delay: 0.1 } } }}
      >
        <div className="panel-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p className="eyebrow">{tr("RETURN ON INVESTMENT", "YATIRIM GERİ DÖNÜŞÜ")}</p>
            <h3>{tr("Total spend vs store revenue", "Toplam gider vs mağaza geliri")}</h3>
          </div>
          <button
            className="icon-button"
            onClick={() => void refreshEarnings()}
            disabled={loadingRoi}
            title={tr("Refresh", "Yenile")}
          >
            <RefreshCw size={14} className={loadingRoi ? "spin" : ""} />
          </button>
        </div>

        {earnings.total === 0 ? (
          <div className="roi-empty-state">
            <BarChart3 size={64} strokeWidth={1.4} className="roi-empty-icon" />
            <h3 className="roi-empty-title">
              {tr("No revenue captured yet", "Henüz kazanç verisi yok")}
            </h3>
            <p className="roi-empty-body">
              {tr(
                "Map an Itch.io game to start tracking studio profitability automatically.",
                "Stüdyo karlılığını otomatik izlemeye başlamak için bir Itch.io oyunu eşleştir."
              )}
            </p>
            <button
              type="button"
              className="roi-empty-cta"
              onClick={() => setWorkspaceTab("storehub")}
            >
              {tr("Go to Store Sync →", "Mağaza Sync'e Git →")}
            </button>
          </div>
        ) : (
          <>
            <div className="roi-row">
              <div className="roi-figure">
                <span className="eyebrow">{tr("SPENT", "GİDER")}</span>
                <strong style={{ color: "#f87171" }}>{usd(totalSpend)}</strong>
              </div>
              <div className="roi-figure">
                <span className="eyebrow">{tr("EARNED", "KAZANÇ")}</span>
                <strong style={{ color: "#34d399" }}>{usd(earnings.total)}</strong>
              </div>
              <div className="roi-figure">
                <span className="eyebrow">{tr("RATIO", "ORAN")}</span>
                <strong style={{ color: roiPositive ? "#34d399" : "#f87171" }}>
                  {totalSpend > 0 ? `${((earnings.total / totalSpend) * 100).toFixed(0)}%` : "—"}
                </strong>
              </div>
            </div>
            <div className="roi-bar-track">
              <motion.div
                className={`roi-bar-fill ${roiPositive ? "roi-bar-positive" : "roi-bar-negative"}`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, roiRatio * 100)}%` }}
                transition={{ duration: 0.6, ease: [0.25, 1, 0.5, 1] }}
              />
              <span className="roi-bar-midline" />
            </div>
            <p className="section-copy" style={{ marginTop: 8 }}>
              {roiPositive
                ? tr("In the black — you're earning more than you spend.", "Karlısın — harcadığından fazla kazanıyorsun.")
                : tr(
                    "Below break-even. Keep building.",
                    "Henüz başabaş noktasının altında. Üretmeye devam."
                  )}
            </p>
          </>
        )}
      </motion.section>

      <AnimatePresence>
        {previewOpen && (
          <ReportPreviewModal
            report={buildReport()}
            language={language}
            onClose={() => setPreviewOpen(false)}
            onDownload={() => {
              setPreviewOpen(false);
              void runExport(exportFormat);
            }}
            currentFormat={exportFormat}
            formatLabel={formatLabel}
          />
        )}
      </AnimatePresence>

    </motion.div>
  );
}

// ── Report Preview Modal ──────────────────────────────────────────────────────

function ReportPreviewModal({
  report, language, onClose, onDownload, currentFormat, formatLabel,
}: {
  report: FinancialReportPayload;
  language: string;
  onClose: () => void;
  onDownload: () => void;
  currentFormat: ExportFormat;
  formatLabel: Record<ExportFormat, string>;
}) {
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const rowsToShow = report.rows.slice(0, 20);
  return (
    <motion.div
      className="report-preview-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <motion.div
        className="report-preview-modal"
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="report-preview-head">
          <div>
            <p className="eyebrow">{tr("REPORT PREVIEW", "RAPOR ÖNİZLEME")}</p>
            <h3 style={{ margin: "2px 0 0" }}>
              {report.rangeLabel} · {report.rows.length} {tr("rows", "satır")}
            </h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title={tr("Close", "Kapat")}>
            <X size={16} />
          </button>
        </header>

        <div className="report-preview-summary">
          <div className="report-preview-cell">
            <span className="eyebrow">{tr("EXPENSE", "GİDER")}</span>
            <strong style={{ color: "#fca5a5" }}>${report.totalExpense.toFixed(2)}</strong>
          </div>
          <div className="report-preview-cell">
            <span className="eyebrow">{tr("INCOME", "GELİR")}</span>
            <strong style={{ color: "#6ee7b7" }}>${report.totalIncome.toFixed(2)}</strong>
          </div>
          <div className="report-preview-cell">
            <span className="eyebrow">{tr("NET", "NET")}</span>
            <strong style={{ color: report.net >= 0 ? "#34d399" : "#f87171" }}>
              ${report.net.toFixed(2)}
            </strong>
          </div>
        </div>

        <div className="report-preview-table-wrap">
          {report.rows.length === 0 ? (
            <p className="report-preview-empty">
              {tr("No rows in this range.", "Bu aralıkta satır yok.")}
            </p>
          ) : (
            <table className="report-preview-table">
              <thead>
                <tr>
                  <th>{tr("Date", "Tarih")}</th>
                  <th>{tr("Kind", "Tür")}</th>
                  <th>{tr("Category", "Kategori")}</th>
                  <th>{tr("Project", "Proje")}</th>
                  <th>{tr("Description", "Açıklama")}</th>
                  <th style={{ textAlign: "right" }}>{tr("Amount", "Tutar")}</th>
                </tr>
              </thead>
              <tbody>
                {rowsToShow.map((r, i) => (
                  <tr key={`${r.date}-${i}`} className={r.kind === "income" ? "is-income" : "is-expense"}>
                    <td>{r.date}</td>
                    <td>
                      <span className={`report-kind-pill report-kind-${r.kind}`}>
                        {r.kind === "income" ? tr("Income", "Gelir") : tr("Expense", "Gider")}
                      </span>
                    </td>
                    <td>{r.category}</td>
                    <td>{r.project}</td>
                    <td title={r.description}>{r.description}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      ${r.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report.rows.length > rowsToShow.length && (
            <p className="report-preview-more">
              + {report.rows.length - rowsToShow.length}{" "}
              {tr("more rows in the export", "satır daha dışa aktarımda")}
            </p>
          )}
        </div>

        <footer className="report-preview-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            {tr("Close", "Kapat")}
          </button>
          <button type="button" className="primary-button" onClick={onDownload}>
            <Download size={13} style={{ marginRight: 6 }} />
            {tr(`Download (${formatLabel[currentFormat]})`, `İndir (${formatLabel[currentFormat]})`)}
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );
}

function BurnCard({
  icon: Icon,
  label,
  value,
  accent,
  subtitle,
  subtitleTone,
  onSubtitleClick,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  accent: string;
  subtitle?: string;
  subtitleTone?: "neutral" | "success" | "danger" | "link";
  onSubtitleClick?: () => void;
}) {
  const SubtitleTag = onSubtitleClick ? "button" : "span";
  return (
    <motion.div
      className="hero-stat-card burn-card"
      style={{ "--hero-accent": accent } as React.CSSProperties}
      variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}
    >
      <div className="hero-stat-icon">
        <Icon size={22} strokeWidth={2} />
      </div>
      <div className="hero-stat-body">
        <span className="hero-stat-label">{label}</span>
        <strong className="hero-stat-value">{value}</strong>
        {subtitle && (
          <SubtitleTag
            className={`burn-card-subtitle burn-card-subtitle-${subtitleTone ?? "neutral"}`}
            onClick={onSubtitleClick}
            type={onSubtitleClick ? "button" : undefined}
          >
            {subtitle}
          </SubtitleTag>
        )}
      </div>
      <div className="hero-stat-bar" />
    </motion.div>
  );
}
