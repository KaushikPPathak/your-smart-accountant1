// Lazy-loaded chart so recharts (~400 KB) is not part of the initial bundle.
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

interface MonthRow {
  month: string;
  sales: number;
  purchase: number;
}

export default function SalesPurchaseChart({ monthly }: { monthly: MonthRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} debounce={50}>
      <BarChart data={monthly}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
        <XAxis dataKey="month" fontSize={11} />
        <YAxis
          fontSize={11}
          tickFormatter={(v) =>
            v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${(v / 1000).toFixed(0)}k`
          }
        />
        <Tooltip formatter={(v) => `₹ ${Number(v).toLocaleString("en-IN")}`} />
        <Legend />
        <Bar dataKey="sales" name="Sales" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="purchase" name="Purchase" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
