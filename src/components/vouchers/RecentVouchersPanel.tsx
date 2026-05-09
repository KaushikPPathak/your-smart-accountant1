import { markVoucherOrigin } from "@/lib/voucher-return";
import { fmtIndianDate } from "@/lib/format-date";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useCompany } from "@/lib/company-context";
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
 * type. Click any row to open it for editing. `refreshKey` should change after
 * each successful save so the list refreshes.
 */
export function RecentVouchersPanel({
  voucherType,
  refreshKey = 0,
  limit = 10,
}: {
  voucherType: string;
  refreshKey?: number;
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
  }, [activeCompanyId, voucherType, refreshKey, limit]);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Recent {voucherType.replace(/_/g, " ")}s</span>
          <span className="text-[10px] text-muted-foreground">click to edit</span>
        </div>
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between px-2 py-1.5 text-left"
                onClick={() => (markVoucherOrigin(), navigate({ to: "/app/vouchers/$voucherId", params: { voucherId: r.id } }))}
              >
                <span className="flex flex-col items-start">
                  <span className="font-mono text-xs">{r.voucher_number}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {fmtIndianDate(r.voucher_date)}
                    {r.party_ledger_id && partyNames[r.party_ledger_id] ? ` · ${partyNames[r.party_ledger_id]}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs">{formatINR(r.total_paise)}</span>
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
