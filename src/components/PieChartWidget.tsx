import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ExpenseItem } from "../types";

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
  if (expenses.length === 0) {
    return <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Henüz bir gider kaydedilmedi.</p>;
  }

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
             formatter={(value: any) => [`${value.toFixed(2)} USD`, 'Toplam Maliyet']}
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
