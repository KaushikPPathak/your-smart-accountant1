import { markVoucherOrigin } from "@/lib/voucher-return";
import { fmtIndianDate } from "@/lib/format-date";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCompany } from "@/lib/company-context";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { readLedgers, readVouchers } from "@/lib/offline/cache-read";
import { formatINR } from "@/lib/money";
import { Pencil } from "lucide-react";

interface RecentRow {
  id: string;
  voucher_number: string;
  voucher_date: string;
  total_paise: number;
  party_ledger_id: string | null;
}

/**
 * Tally/Busy-style side panel listing the most recent vouchers of the same
 * type. Click any row to open it for editing.
 */
export function LanguageSwitcher({
  voucherType = "sales",
  limit = 10,
}: {
  voucherType?: string;
  limit?: number;
}) {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const [rows, setRows] = useState<RecentRow[]>([]);
  const [partyNames, setPartyNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    (async () => {
      if (isLocalOnlyMode()) {
        const [vouchers, ledgers] = await Promise.all([
          readVouchers(activeCompanyId, { voucher_type: voucherType }),
          readLedgers(activeCompanyId),
        ]);
        if (cancelled) return;
        const list = (vouchers as RecentRow[]).slice(0, limit);
        setRows(list);
        const m: Record<string, string> = {};
        for (const l of ledgers as Array<{ id: string; name: string }>) m[l.id] = l.name;
        setPartyNames(m);
        return;
      }
      const { data } = await supabase
        .from("vouchers")
        .select("id, voucher_number, voucher_date, total_paise, party_ledger_id")
        .eq("company_id", activeCompanyId)
        .eq("voucher_type", voucherType as Database["public"]["Enums"]["voucher_type"])
        .order("voucher_date", { ascending: false }).order("voucher_number", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (cancelled) return;
      const list = (data || []) as RecentRow[];
      setRows(list);
      const ids = Array.from(new Set(list.map((r) => r.party_ledger_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: lg } = await supabase.from("ledgers").select("id, name").in("id", ids);
        if (!cancelled) {
          const m: Record<string, string> = {};
          for (const l of (lg || []) as { id: string; name: string }[]) m[l.id] = l.name;
          setPartyNames(m);
        }
      } else {
        setPartyNames({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, voucherType, limit]);

  const typeLabel = voucherType.replace(/_/g, " ");
  
  // Dynamic color based on voucher type to match card themes
  const colorClass = 
    voucherType === "sales" ? "bg-blue-50/50 text-blue-900 border-blue-100" :
    voucherType === "purchase" ? "bg-amber-50/50 text-amber-900 border-amber-100" :
    voucherType === "receipt" ? "bg-green-50/50 text-green-900 border-green-100" :
    voucherType === "payment" ? "bg-rose-50/50 text-rose-900 border-rose-100" :
    "bg-muted/50 text-muted-foreground border-muted";

  return (
    <Card className={`border shadow-sm ${colorClass}`}>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between border-b pb-2">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 opacity-70" />
            <span className="text-sm font-bold capitalize">Recent {typeLabel}s</span>
          </div>
          <span className="text-[10px] opacity-60 font-medium uppercase tracking-wider">Last 10 Bills</span>
        </div>
        
        {rows.length === 0 ? (
          <div className="py-4 text-center text-xs opacity-60 italic">No recent {typeLabel}s found.</div>
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-between px-2 py-1.5 text-left hover:bg-black/5 rounded-md transition-colors"
                  onClick={() => (markVoucherOrigin(), navigate({ to: "/app/vouchers/$voucherId", params: { voucherId: r.id } }))}
                >
                  <div className="flex flex-col items-start overflow-hidden">
                    <span className="font-mono text-[11px] font-bold leading-none">{r.voucher_number}</span>
                    <span className="truncate text-[10px] opacity-80 mt-0.5">
                      {fmtIndianDate(r.voucher_date)}
                      {r.party_ledger_id && partyNames[r.party_ledger_id] ? ` · ${partyNames[r.party_ledger_id]}` : ""}
                    </span>
                  </div>
                  <span className="font-mono text-xs font-bold whitespace-nowrap ml-2">
                    {formatINR(r.total_paise)}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        
        {rows.length > 0 && (
          <div className="mt-2 pt-2 border-t text-center">
            <Button 
              variant="link" 
              className="h-auto p-0 text-[10px] font-bold opacity-60 hover:opacity-100 uppercase"
              onClick={() => navigate({ to: "/app/vouchers", search: { type: voucherType } as any })}
            >
              View all {typeLabel}s
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

