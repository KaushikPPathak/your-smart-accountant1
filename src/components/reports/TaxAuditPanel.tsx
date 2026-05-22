import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { fetchLedgerBalances } from "@/lib/reports";
import {
  DEFAULT_IT_BLOCKS,
  scan40A3,
  fetch43BSnapshot,
  summariseBlocks,
  bookDepreciationPaise,
  netProfitBooks,
  buildComputation,
  type BlockSummary,
  type ItAsset,
  type ItMovement,
} from "@/lib/tax-audit";
import { formatINR } from "@/lib/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  mode: "pl" | "bs";
  fyStart: string;
  fyEnd: string;
}

interface Loaded {
  blocks: BlockSummary[];
  netProfit: number;
  bookDep: number;
  itDep: number;
  cash40A3: number;
  disallowOther: number;
  disallow40aIa: number;
}

export function TaxAuditPanel({ mode, fyStart, fyEnd }: Props) {
  const { activeCompanyId } = useCompany();
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [bals, hits, customBlocksRes, assetsRes, movementsRes, disallowRes] = await Promise.all([
        fetchLedgerBalances(activeCompanyId, fyEnd, fyStart),
        scan40A3(activeCompanyId, fyStart, fyEnd),
        supabase.from("it_asset_blocks").select("code, name, rate_pct").eq("company_id", activeCompanyId),
        supabase.from("it_fixed_assets").select("*").eq("company_id", activeCompanyId).eq("fy_start", fyStart),
        supabase.from("it_asset_movements").select("*").eq("company_id", activeCompanyId).eq("fy_start", fyStart),
        supabase.from("it_disallowances").select("section, amount_paise").eq("company_id", activeCompanyId).eq("fy_end", fyEnd),
      ]);
      // 43B unpaid → also disallowance
      const dues = await fetch43BSnapshot(activeCompanyId, fyEnd);
      const unpaid43B = dues.reduce(
        (s, d) => s + Math.max(0, d.closing_paise - (d.cleared_paise ?? 0)),
        0,
      );

      const customBlocks = (customBlocksRes.data ?? []) as { code: string; name: string; rate_pct: number }[];
      const blocksDef = customBlocks.length > 0
        ? customBlocks
        : DEFAULT_IT_BLOCKS.map((b) => ({ code: b.code, name: b.name, rate_pct: b.rate_pct }));
      const assets = (assetsRes.data ?? []) as ItAsset[];
      const movements = (movementsRes.data ?? []) as ItMovement[];
      const blockSummaries = summariseBlocks(blocksDef, assets, movements, fyStart);

      const disallowMap = new Map<string, number>();
      for (const d of (disallowRes.data ?? []) as { section: string; amount_paise: number }[]) {
        disallowMap.set(d.section, (disallowMap.get(d.section) ?? 0) + d.amount_paise);
      }

      const cash40A3 = hits.reduce((s, h) => s + h.amount_paise, 0);
      const itDep = blockSummaries.reduce((s, b) => s + b.depreciation_paise, 0);
      const bookDep = bookDepreciationPaise(bals);
      const netProfit = netProfitBooks(bals);
      const disallow40aIa = disallowMap.get("40(a)(ia)") ?? 0;
      const disallowOther =
        (disallowMap.get("Other") ?? 0) +
        (disallowMap.get("43B") ?? 0) +
        unpaid43B;

      if (cancelled) return;
      setData({
        blocks: blockSummaries,
        netProfit,
        bookDep,
        itDep,
        cash40A3,
        disallowOther,
        disallow40aIa,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeCompanyId, fyStart, fyEnd]);

  if (loading || !data) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (mode === "pl") {
    const { rows, taxablePaise } = buildComputation({
      netProfitPaise: data.netProfit,
      cash40A3Paise: data.cash40A3,
      disallow40aIaPaise: data.disallow40aIa,
      otherDisallowPaise: data.disallowOther,
      bookDepreciationPaise: data.bookDep,
      itDepreciationPaise: data.itDep,
    });
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tax Audit View — Computation of PGBP</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Particulars</TableHead>
                <TableHead className="text-right">Amount (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} className={r.kind === "equals" ? "font-semibold border-t-2" : ""}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right font-mono">
                    {r.kind === "less" ? `(${formatINR(r.paise)})` : formatINR(r.paise)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            Taxable PGBP: <strong>{formatINR(taxablePaise)}</strong>. Compare with Net Profit (books) <strong>{formatINR(data.netProfit)}</strong>.
            Configure disallowances and IT asset blocks in <em>Reports → Tax Audit (3CD)</em>.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Balance Sheet mode → IT block-of-assets closing WDV table
  const total = data.blocks.reduce((s, b) => s + b.closing_wdv_paise, 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Tax Audit View — Fixed Assets per Income Tax Act</CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Block</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Opening WDV</TableHead>
              <TableHead className="text-right">Add ≥180d</TableHead>
              <TableHead className="text-right">Add &lt;180d</TableHead>
              <TableHead className="text-right">Deletions</TableHead>
              <TableHead className="text-right">Depreciation</TableHead>
              <TableHead className="text-right">Closing WDV</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.blocks.map((b) => (
              <TableRow key={b.code}>
                <TableCell>{b.name}</TableCell>
                <TableCell className="text-right">{b.rate_pct}%</TableCell>
                <TableCell className="text-right font-mono">{formatINR(b.opening_paise)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(b.additions_ge180_paise)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(b.additions_lt180_paise)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(b.deletions_paise)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(b.depreciation_paise)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{formatINR(b.closing_wdv_paise)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold border-t-2">
              <TableCell colSpan={7}>Total Fixed Assets (IT WDV)</TableCell>
              <TableCell className="text-right font-mono">{formatINR(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Replaces book Fixed Assets with Income-Tax block closing WDV. Manage blocks/assets in <em>Reports → Tax Audit (3CD)</em>.
        </p>
      </CardContent>
    </Card>
  );
}
