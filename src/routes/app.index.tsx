import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  IndianRupee,
  Package,
  ReceiptText,
  TrendingUp,
  Users,
  ShoppingCart,
  ShoppingBag,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/lib/company-context";
import { supabase } from "@/integrations/supabase/client";
import { formatINR } from "@/lib/money";
import { fetchLedgerBalances, BS_ASSET, BS_LIAB, PL_INCOME, PL_EXPENSE } from "@/lib/reports";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Dashboard — Your Mehtaji" }] }),
  component: Dashboard,
});

interface RecentRow {
  id: string;
  voucher_date: string;
  voucher_number: string;
  voucher_type: string;
  total_paise: number;
  ledgers: { name: string } | null;
}

interface MonthBucket {
  month: string;
  sales: number;
  purchase: number;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function fmtMonth(d: Date): string {
  return d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

function Dashboard() {
  const { activeCompanyId, activeMembership } = useCompany();
  const [salesMTD, setSalesMTD] = useState(0);
  const [receivables, setReceivables] = useState(0);
  const [payables, setPayables] = useState(0);
  const [stockValue, setStockValue] = useState(0);
  const [outputGst, setOutputGst] = useState(0);
  const [inputGst, setInputGst] = useState(0);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [monthly, setMonthly] = useState<MonthBucket[]>([]);
  const [topCustomers, setTopCustomers] = useState<{ name: string; total: number }[]>([]);

  useEffect(() => {
    if (!activeCompanyId) return;
    const now = new Date();
    const monthStart = startOfMonth(now).toISOString().slice(0, 10);
    const monthEnd = now.toISOString().slice(0, 10);
    const sixMonthsBack = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 5, 1));
    const fromSix = sixMonthsBack.toISOString().slice(0, 10);

    (async () => {
      const [salesQ, recentQ, sixQ, gstQ, balances] = await Promise.all([
        supabase
          .from("vouchers")
          .select("total_paise, party_ledger_id, ledgers:party_ledger_id(name)")
          .eq("company_id", activeCompanyId)
          .eq("voucher_type", "sales")
          .gte("voucher_date", monthStart)
          .lte("voucher_date", monthEnd),
        supabase
          .from("vouchers")
          .select("id, voucher_date, voucher_number, voucher_type, total_paise, ledgers:party_ledger_id(name)")
          .eq("company_id", activeCompanyId)
          .order("voucher_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("vouchers")
          .select("voucher_date, voucher_type, total_paise")
          .eq("company_id", activeCompanyId)
          .in("voucher_type", ["sales", "purchase"])
          .gte("voucher_date", fromSix)
          .lte("voucher_date", monthEnd),
        supabase
          .from("vouchers")
          .select("voucher_type, cgst_paise, sgst_paise, igst_paise")
          .eq("company_id", activeCompanyId)
          .gte("voucher_date", monthStart)
          .lte("voucher_date", monthEnd),
        fetchLedgerBalances(activeCompanyId, monthEnd),
      ]);

      // Sales MTD + top customers
      const salesRows = (salesQ.data || []) as { total_paise: number; party_ledger_id: string | null; ledgers: { name: string } | null }[];
      setSalesMTD(salesRows.reduce((s, r) => s + r.total_paise, 0));
      const partyMap = new Map<string, number>();
      for (const r of salesRows) {
        const name = r.ledgers?.name ?? "Cash";
        partyMap.set(name, (partyMap.get(name) || 0) + r.total_paise);
      }
      setTopCustomers(
        [...partyMap.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5),
      );

      // Recent
      setRecent((recentQ.data || []) as unknown as RecentRow[]);

      // 6-month bar chart
      const buckets: MonthBucket[] = [];
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
        buckets.push({ month: fmtMonth(d), sales: 0, purchase: 0 });
      }
      for (const r of (sixQ.data || []) as { voucher_date: string; voucher_type: string; total_paise: number }[]) {
        const d = new Date(r.voucher_date);
        const idx = (d.getFullYear() - sixMonthsBack.getFullYear()) * 12 + (d.getMonth() - sixMonthsBack.getMonth());
        if (idx >= 0 && idx < 6) {
          if (r.voucher_type === "sales") buckets[idx].sales += r.total_paise / 100;
          else buckets[idx].purchase += r.total_paise / 100;
        }
      }
      setMonthly(buckets);

      // GST output/input MTD
      let oG = 0;
      let iG = 0;
      for (const r of (gstQ.data || []) as { voucher_type: string; cgst_paise: number; sgst_paise: number; igst_paise: number }[]) {
        const tax = r.cgst_paise + r.sgst_paise + r.igst_paise;
        if (r.voucher_type === "sales" || r.voucher_type === "credit_note") oG += r.voucher_type === "credit_note" ? -tax : tax;
        if (r.voucher_type === "purchase" || r.voucher_type === "debit_note") iG += r.voucher_type === "debit_note" ? -tax : tax;
      }
      setOutputGst(oG);
      setInputGst(iG);

      // Receivables (sundry_debtor positive) and payables (sundry_creditor negative absolute)
      let recv = 0;
      let pay = 0;
      for (const b of balances) {
        if (b.type === "sundry_debtor" && b.closing_paise > 0) recv += b.closing_paise;
        if (b.type === "sundry_creditor" && b.closing_paise < 0) pay += -b.closing_paise;
      }
      setReceivables(recv);
      setPayables(pay);

      // Stock value from items opening (simple proxy)
      const { data: items } = await supabase
        .from("items")
        .select("opening_stock_qty, opening_stock_rate_paise")
        .eq("company_id", activeCompanyId);
      const sv = (items || []).reduce((s, i) => s + i.opening_stock_qty * i.opening_stock_rate_paise, 0);
      setStockValue(sv);

      // suppress lint for unused buckets
      void PL_INCOME;
      void PL_EXPENSE;
      void BS_ASSET;
      void BS_LIAB;
    })();
  }, [activeCompanyId]);

  const stats = useMemo(
    () => [
      { label: "Sales (this month)", value: formatINR(salesMTD), icon: TrendingUp, color: "text-success" },
      { label: "Receivables", value: formatINR(receivables), icon: Users, color: "text-primary" },
      { label: "Payables", value: formatINR(payables), icon: ReceiptText, color: "text-warning" },
      { label: "Stock value", value: formatINR(stockValue), icon: Package, color: "text-accent" },
    ],
    [salesMTD, receivables, payables, stockValue],
  );

  const netGst = outputGst - inputGst;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {activeMembership?.companies.name ?? "Dashboard"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Quick overview of your books for {new Date().toLocaleString("en-IN", { month: "long", year: "numeric" })}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="num text-2xl font-semibold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Sales vs Purchase — last 6 months</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => `₹ ${Number(v).toLocaleString("en-IN")}`} />
                <Legend />
                <Bar dataKey="sales" name="Sales" fill="oklch(0.55 0.18 265)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="purchase" name="Purchase" fill="oklch(0.7 0.16 60)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex justify-between">
                <span>GST Payable (this month)</span>
                <IndianRupee className="h-4 w-4 text-warning" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Output GST</span><span className="font-mono">{formatINR(outputGst)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Input GST</span><span className="font-mono">{formatINR(inputGst)}</span></div>
              <div className="my-1 border-t" />
              <div className={`flex justify-between text-base font-semibold ${netGst >= 0 ? "text-warning" : "text-success"}`}>
                <span>{netGst >= 0 ? "Net Payable" : "Net Refund"}</span>
                <span className="font-mono">{formatINR(Math.abs(netGst))}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Top customers (this month)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {topCustomers.length === 0 ? (
                <p className="text-muted-foreground">No sales yet.</p>
              ) : (
                topCustomers.map((c) => (
                  <div key={c.name} className="flex justify-between">
                    <span className="truncate pr-2">{c.name}</span>
                    <span className="font-mono">{formatINR(c.total)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild size="sm"><Link to="/app/vouchers/new/sales"><ShoppingCart className="mr-2 h-4 w-4" />New Sale</Link></Button>
          <Button asChild size="sm" variant="secondary"><Link to="/app/vouchers/new/purchase"><ShoppingBag className="mr-2 h-4 w-4" />New Purchase</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/app/vouchers/new/receipt"><ArrowDownToLine className="mr-2 h-4 w-4" />Receipt</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/app/vouchers/new/payment"><ArrowUpFromLine className="mr-2 h-4 w-4" />Payment</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link to="/app/ledgers"><Users className="mr-2 h-4 w-4" />Ledgers</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link to="/app/items"><Package className="mr-2 h-4 w-4" />Items</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link to="/app/companies"><Building2 className="mr-2 h-4 w-4" />Companies</Link></Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent vouchers</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No vouchers yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>No.</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.voucher_date}</TableCell>
                    <TableCell className="capitalize">{r.voucher_type.replace("_", " ")}</TableCell>
                    <TableCell className="font-mono text-xs">{r.voucher_number}</TableCell>
                    <TableCell>{r.ledgers?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(r.total_paise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
