/**
 * NextVoucherNumberCard
 *
 * Small inline indicator that peeks the next voucher number that will be
 * assigned when this voucher is saved. Mirrors the self-healing logic in
 * the `next_voucher_number` RPC by taking the greater of:
 *   - voucher_number_seq.next_number for (company, type), and
 *   - MAX(numeric voucher_number) + 1 from vouchers for (company, type).
 *
 * It does NOT consume a number — the actual number is allocated atomically
 * at save time by the RPC. This is a UI hint only.
 */
import { useEffect, useState } from "react";
import { Hash, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  companyId: string | null;
  voucherType: string;
  /** Re-peek when this changes (e.g. after saving). */
  refreshKey?: number;
}

export function NextVoucherNumberCard({ companyId, voucherType, refreshKey = 0 }: Props) {
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) { setNext(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [seqRes, maxRes] = await Promise.all([
          supabase
            .from("voucher_number_seq")
            .select("next_number")
            .eq("company_id", companyId)
            .eq("voucher_type", voucherType)
            .maybeSingle(),
          supabase
            .from("vouchers")
            .select("voucher_number")
            .eq("company_id", companyId)
            .eq("voucher_type", voucherType)
            .order("created_at", { ascending: false })
            .limit(500),
        ]);

        const seqNext = (seqRes.data?.next_number as number | undefined) ?? 1;
        let maxNum = 0;
        for (const row of maxRes.data ?? []) {
          const n = parseInt(String(row.voucher_number).replace(/\D/g, ""), 10);
          if (Number.isFinite(n) && n > maxNum) maxNum = n;
        }
        const peek = Math.max(seqNext, maxNum + 1);
        if (!cancelled) setNext(peek);
      } catch {
        if (!cancelled) setNext(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, voucherType, refreshKey]);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm shadow-sm"
      title="Next voucher number — assigned automatically on save"
    >
      <Hash className="h-3.5 w-3.5 text-primary" />
      <span className="text-muted-foreground">Next No.:</span>
      <span className="font-mono font-semibold text-primary">
        {loading ? "…" : next ?? "—"}
      </span>
      {loading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}
