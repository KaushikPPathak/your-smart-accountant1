import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { readVouchers, readVoucherItemsForCompany } from "@/lib/offline/cache-read";
import { useCostCentres } from "@/hooks/useCostCentres";
import { EmptyState } from "@/components/EmptyState";
import { Tag } from "lucide-react";

export const Route = createFileRoute("/app/reports/cost-centre")({
  head: () => ({ meta: [{ title: "Cost centre report — Reports" }] }),
  component: CostCentreReport,
});

interface VItem {
  voucher_id: string;
  amount_paise: number;
  taxable_paise: number;
  cost_centre_id?: string | null;
  cost_category_id?: string | null;
}

interface Voucher {
  id: string;
  voucher_type: string;
  voucher_date: string;
}

function CostCentreReport() {
  const { activeCompanyId } = useCompany();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const { centres, categories, loading: mastersLoading } = useCostCentres(activeCompanyId ?? null);
  const [items, setItems] = useState<VItem[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      readVoucherItemsForCompany(activeCompanyId),
      readVouchers(activeCompanyId, { from, to }),
    ])
      .then(([its, vs]) => {
        if (cancelled) return;
        setItems(its as unknown as VItem[]);
        setVouchers(vs as unknown as Voucher[]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeCompanyId, from, to]);

  const voucherIndex = useMemo(() => {
    const m = new Map<string, Voucher>();
    for (const v of vouchers) m.set(v.id, v);
    return m;
  }, [vouchers]);

  // Sign: sales / debit_note = inflow (revenue); purchase / credit_note = outflow (expense).
  const signFor = (t: string): number => {
    if (t === "sales" || t === "debit_note") return +1;
    if (t === "purchase" || t === "credit_note") return -1;
    return 0;
  };

  const grouped = useMemo(() => {
    // { centreId -> { name, total, byCategory: { categoryId -> { name, total } } } }
    type Bucket = { id: string; name: string; total: number; byCat: Map<string, { id: string; name: string; total: number }> };
    const map = new Map<string, Bucket>();
    const bucketFor = (id: string | null | undefined): Bucket => {
      const key = id ?? "__untagged__";
      let b = map.get(key);
      if (!b) {
        const name = id ? (centres.find((c) => c.id === id)?.name ?? "(deleted)") : "Untagged";
        b = { id: key, name, total: 0, byCat: new Map() };
        map.set(key, b);
      }
      return b;
    };

    for (const it of items) {
      const v = voucherIndex.get(it.voucher_id);
      if (!v) continue; // outside date range
      const s = signFor(v.voucher_type);
      if (s === 0) continue;
      const value = s * Number(it.taxable_paise ?? it.amount_paise ?? 0);
      const b = bucketFor(it.cost_centre_id);
      b.total += value;
      const catKey = it.cost_category_id ?? "__no_cat__";
      const catName = it.cost_category_id
        ? (categories.find((c) => c.id === it.cost_category_id)?.name ?? "(deleted)")
        : "—";
      const cat = b.byCat.get(catKey) ?? { id: catKey, name: catName, total: 0 };
      cat.total += value;
      b.byCat.set(catKey, cat);
    }
    return Array.from(map.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [items, voucherIndex, centres, categories]);

  const grandTotal = grouped.reduce((s, b) => s + b.total, 0);

  if (mastersLoading || loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (centres.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Cost centre report</h1>
        <EmptyState
          icon={Tag}
          title="No cost centres yet"
          description="Configure cost centres in Settings → Cost centres, then tag voucher lines to see them grouped here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cost centre report</h1>
        <p className="text-sm text-muted-foreground">
          Net turnover per cost centre (sales &minus; purchases &plusmn; returns), grouped by category.
        </p>
      </div>
      <ReportToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} />

      {grouped.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No tagged transactions in this period"
          description="Tag lines from the voucher form using the tag icon on each row."
        />
      ) : (
        <div className="space-y-3">
          {grouped.map((b) => (
            <Card key={b.id}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base">{b.name}</CardTitle>
                <span className={`font-mono text-sm ${b.total < 0 ? "text-destructive" : "text-emerald-700"}`}>
                  {formatINR(Math.abs(b.total))} {b.total < 0 ? "Dr" : "Cr"}
                </span>
              </CardHeader>
              <CardContent className="pt-0 pb-3">
                <div className="divide-y text-sm">
                  {Array.from(b.byCat.values())
                    .sort((x, y) => Math.abs(y.total) - Math.abs(x.total))
                    .map((c) => (
                      <div key={c.id} className="flex justify-between py-1.5">
                        <span className="text-muted-foreground">{c.name}</span>
                        <span className="font-mono">
                          {formatINR(Math.abs(c.total))} {c.total < 0 ? "Dr" : "Cr"}
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardContent className="flex justify-between py-3 font-semibold">
              <span>Net</span>
              <span className={`font-mono ${grandTotal < 0 ? "text-destructive" : "text-emerald-700"}`}>
                {formatINR(Math.abs(grandTotal))} {grandTotal < 0 ? "Dr" : "Cr"}
              </span>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
