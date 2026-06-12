import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ExpenseItem } from "../types";
import { useAppStore } from "../store";

// Yardımcı fonksiyon: Yinelenen giderlerin toplam maliyetini anlık olarak bulur
export function calculateAccumulatedAmount(exp: ExpenseItem, exchangeRateToPrimary: number = 1): number {
  let finalAmount = exp.amount;

  if (exp.isRecurring) {
    const start = new Date(exp.spentAt);
    const now = new Date();
    // Aylar farkını bul
    let monthsDiff = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (monthsDiff < 1) monthsDiff = 1; // Başlangıç ayı için en az 1 ay ekle
    finalAmount = exp.amount * monthsDiff;
  }

  return finalAmount * exchangeRateToPrimary;
}

export function PieChartWidget({ expenses, getExchangeRate }: { expenses: ExpenseItem[], getExchangeRate: (currency: string) => number }) {
  const language = useAppStore((s) => s.language);
  const ui = useAppStore((s) => s.ui);
  const emptyLabel = (() => {
    // Prefer the language pack's wExpensesEmpty / distEmptyLabel where
    // available, fall back to a per-locale literal so we never ship a
    // hardcoded Turkish string to a FR/ES user.
    const fromUi = (ui as Record<string, unknown>).wNoExpenses
      ?? (ui as Record<string, unknown>).distEmptyLabel
      ?? (ui as Record<string, unknown>).wExpensesEmpty;
    if (typeof fromUi === "string" && fromUi.length > 0) return fromUi;
    switch (language) {
      case "tr": return "Henüz bir gider kaydedilmedi.";
      case "fr": return "Aucune dépense enregistrée.";
      case "es": return "Aún no hay gastos registrados.";
      default:   return "No expenses recorded yet.";
    }
  })();
  if (expenses.length === 0) {
    return <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{emptyLabel}</p>;
  }
  const totalLabel = (() => {
    switch (language) {
      case "tr": return "Toplam Maliyet";
      case "fr": return "Coût total";
      case "es": return "Coste total";
      default:   return "Total cost";
    }
  })();

  const dataMap = expenses.reduce((acc, exp) => {
    const rate = exp.currency ? getExchangeRate(exp.currency) : 1;
    const accumulated = calculateAccumulatedAmount(exp, rate);
    acc[exp.category] = (acc[exp.category] || 0) + accumulated;
    return acc;
  }, {} as Record<string, number>);

  const data = Object.entries(dataMap).map(([name, value]) => ({ name, value }));

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#ffc658', '#FF6B6B', '#4ECDC4'];

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
             contentStyle={{ backgroundColor: "#1e293b", color: "#f8fafc", border: "none", borderRadius: "8px" }}
             itemStyle={{ color: "#cbd5e1" }}
             labelStyle={{ color: "#f8fafc" }}
             formatter={(value) => {
               // Recharts widens to ValueType which can be string | number | undefined.
               // Coercing through Number() handles every case and never throws.
               const n = typeof value === "number" ? value : Number(value ?? 0);
               return [`${(Number.isFinite(n) ? n : 0).toFixed(2)} USD`, totalLabel];
             }}
          />
          <Legend
            formatter={(value: string) => (
              <span style={{ color: "#dce7f6", fontSize: 12 }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
