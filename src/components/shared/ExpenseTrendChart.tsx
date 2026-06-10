// Monthly expense trend chart for the Wallet page.
//
// Aggregates all global + per-game expenses into 12 monthly buckets
// running back from today, with USD conversion applied via the
// caller-provided exchange-rate map. We deliberately don't try to
// surface a "revenue" line yet — HeraVex only persists expenses, not
// per-store income. When store integrations begin populating revenue
// the chart will grow a second series; the data shape is already
// USD-normalised here so that pivot is a one-line change.

import { useMemo } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { calculateAccumulatedAmount } from "../PieChartWidget";
import { useAppStore } from "../../store";
import type { ExpenseItem, GameRecord } from "../../types";

interface Props {
  games: GameRecord[];
  globalExpenses: ExpenseItem[];
  exchangeRates: Record<string, number>;
}

export function ExpenseTrendChart({ games, globalExpenses, exchangeRates }: Props) {
  const { language } = useAppStore();
  const months = useMemo(() => buildSeries(games, globalExpenses, exchangeRates, language), [games, globalExpenses, exchangeRates, language]);

  // Latest two months — show delta as a short caption above the chart.
  const last = months[months.length - 1]?.amount ?? 0;
  const prev = months[months.length - 2]?.amount ?? 0;
  const delta = prev === 0 ? null : ((last - prev) / prev) * 100;
  const deltaLabel = delta == null
    ? "—"
    : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} ${Math.abs(delta).toFixed(1)}%`;
  const deltaColor = delta == null
    ? "#94a3b8"
    : delta > 0 ? "#f87171" : delta < 0 ? "#34d399" : "#94a3b8";

  return (
    <div className="expense-trend-card">
      <header className="expense-trend-head">
        <div>
          <p className="eyebrow">{language === "tr" ? "AYLIK GİDER TRENDİ" : "MONTHLY EXPENSE TREND"}</p>
          <h3>{language === "tr" ? "Son 12 ay" : "Last 12 months"}</h3>
        </div>
        <div className="expense-trend-delta" style={{ color: deltaColor }}>
          {deltaLabel}
          <small>{language === "tr" ? "geçen aya göre" : "vs prior month"}</small>
        </div>
      </header>
      <div className="expense-trend-chart-wrap">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
            <defs>
              <linearGradient id="expense-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--accent)" stopOpacity={0.55} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="label"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              stroke="rgba(255,255,255,0.08)"
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              stroke="rgba(255,255,255,0.08)"
              tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
              width={70}
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
                const n = typeof v === "number" ? v : 0;
                return [`$${n.toFixed(2)}`, language === "tr" ? "Gider" : "Expenses"];
              }}
            />
            <Area
              type="monotone"
              dataKey="amount"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#expense-grad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function buildSeries(
  games: GameRecord[],
  globalExpenses: ExpenseItem[],
  rates: Record<string, number>,
  language: string,
): { label: string; amount: number }[] {
  // Build 12 month-keyed buckets going back from this month.
  const now = new Date();
  const buckets: { key: string; date: Date; amount: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      date: d,
      amount: 0,
    });
  }
  const rate = (cur: string) => {
    const r = rates[cur];
    return cur === "USD" || !r || r <= 0 ? 1 : r;
  };
  const addExpense = (e: ExpenseItem) => {
    const key = (e.spentAt || "").slice(0, 7); // YYYY-MM
    const b = buckets.find((x) => x.key === key);
    if (b) b.amount += calculateAccumulatedAmount(e, rate(e.currency ?? "USD"));
  };
  globalExpenses.forEach(addExpense);
  games.forEach((g) => (g.expenses ?? []).forEach(addExpense));

  const monthNames = language === "tr"
    ? ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"]
    : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return buckets.map((b) => ({
    label: monthNames[b.date.getMonth()],
    amount: Number(b.amount.toFixed(2)),
  }));
}
