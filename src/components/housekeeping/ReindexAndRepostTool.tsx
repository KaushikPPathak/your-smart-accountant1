/**
 * ReindexAndRepostTool
 *
 * Routine local maintenance for the active company's books. This is NOT a
 * "repair" — the local IndexedDB is the source of truth and stays that way.
 * The tool simply:
 *
 *   1. Reindex — walk every voucher, drop rows whose parent voucher no
 *      longer exists (tombstones can leave dangling children behind after
 *      a crash mid-write), and confirm each posting is dr = cr.
 *   2. Re-post — for every item voucher (sales / purchase / credit note /
 *      debit note), rebuild `cache_voucher_entries` from the voucher's
 *      stored totals and ITC classification via `buildItemVoucherPostings`.
 *      Entry vouchers (receipt / payment / journal) are user-entered — their
 *      lines ARE the source, so they are left alone.
 *
 * Everything runs against IndexedDB. No network calls. No cloud fallback.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Play, CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { offlineDb } from "@/lib/offline/db";
import { buildItemVoucherPostings, type ItemVoucherKind, type ItcClass } from "@/lib/voucher-postings";
import { describeError } from "@/lib/error-message";

type StepStatus = "pending" | "running" | "ok" | "warn" | "error";

interface StepResult {
  key: string;
  label: string;
  status: StepStatus;
  message: string;
  found?: number;
  fixed?: number;
}

const INITIAL: Omit<StepResult, "status" | "message">[] = [
  { key: "reindex_orphans", label: "Reindex: drop orphan posting & inventory rows" },
  { key: "reindex_balance", label: "Reindex: confirm every voucher is balanced (dr = cr)" },
  { key: "repost_items",    label: "Re-post: rebuild sales / purchase / credit & debit note postings" },
];

const ITEM_KINDS: ReadonlySet<string> = new Set(["sales", "purchase", "credit_note", "debit_note"]);

function blank(): StepResult[] {
  return INITIAL.map((s) => ({ ...s, status: "pending", message: "—" }));
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "ok")      return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "warn")    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (status === "error")   return <XCircle className="h-4 w-4 text-destructive" />;
  return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

export function ReindexAndRepostTool({ companyId }: { companyId: string | null }) {
  const [steps, setSteps] = useState<StepResult[]>(() => blank());
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  function patch(key: string, p: Partial<StepResult>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...p } : s)));
  }

  async function run() {
    if (!companyId) { toast.error("Select a company first"); return; }
    setRunning(true);
    setSummary(null);
    setSteps(blank());

    let totalFound = 0;
    let totalFixed = 0;
    let hadError = false;

    // Load once — every step operates on these snapshots.
    let vouchers: any[] = [];
    let entries: any[] = [];
    let items: any[] = [];
    try {
      [vouchers, entries, items] = await Promise.all([
        offlineDb.cache_vouchers.where("company_id").equals(companyId).toArray(),
        offlineDb.cache_voucher_entries.where("company_id").equals(companyId).toArray(),
        offlineDb.cache_voucher_items.where("company_id").equals(companyId).toArray(),
      ]);
    } catch (err) {
      toast.error(describeError(err));
      setRunning(false);
      return;
    }

    const liveVoucherIds = new Set(
      vouchers.filter((v) => v?.is_deleted !== true).map((v) => v.id as string),
    );

    // -------- 1. Reindex: orphans --------
    patch("reindex_orphans", { status: "running", message: "Scanning…" });
    try {
      const orphanEntries = entries.filter((e) => !liveVoucherIds.has(e.voucher_id));
      const orphanItems = items.filter((i) => !liveVoucherIds.has(i.voucher_id));
      const found = orphanEntries.length + orphanItems.length;
      if (found > 0) {
        await offlineDb.transaction("rw", offlineDb.cache_voucher_entries, offlineDb.cache_voucher_items, async () => {
          if (orphanEntries.length) await offlineDb.cache_voucher_entries.bulkDelete(orphanEntries.map((e) => e.id));
          if (orphanItems.length)   await offlineDb.cache_voucher_items.bulkDelete(orphanItems.map((i) => i.id));
        });
        entries = entries.filter((e) => liveVoucherIds.has(e.voucher_id));
        items = items.filter((i) => liveVoucherIds.has(i.voucher_id));
        totalFound += found;
        totalFixed += found;
        patch("reindex_orphans", { status: "ok", found, fixed: found, message: `Removed ${found} orphan row(s).` });
      } else {
        patch("reindex_orphans", { status: "ok", found: 0, fixed: 0, message: "No orphans." });
      }
    } catch (err) {
      hadError = true;
      patch("reindex_orphans", { status: "error", message: describeError(err) });
    }

    // -------- 2. Reindex: balance check (report only) --------
    patch("reindex_balance", { status: "running", message: "Verifying dr = cr…" });
    try {
      const byVoucher = new Map<string, { dr: number; cr: number }>();
      for (const e of entries) {
        const cur = byVoucher.get(e.voucher_id) ?? { dr: 0, cr: 0 };
        cur.dr += e.debit_paise ?? 0;
        cur.cr += e.credit_paise ?? 0;
        byVoucher.set(e.voucher_id, cur);
      }
      const unbalanced: string[] = [];
      for (const v of vouchers) {
        if (v?.is_deleted) continue;
        const b = byVoucher.get(v.id);
        // Vouchers with no entries yet (sales_order/delivery_note/quotation) skip.
        if (!b) continue;
        if (b.dr !== b.cr) unbalanced.push(v.voucher_number || v.id);
      }
      if (unbalanced.length === 0) {
        patch("reindex_balance", { status: "ok", found: 0, message: "Every voucher balances." });
      } else {
        totalFound += unbalanced.length;
        patch("reindex_balance", {
          status: "warn",
          found: unbalanced.length,
          message: `${unbalanced.length} unbalanced voucher(s). Re-post below will fix item vouchers; entry vouchers need editing.`,
        });
      }
    } catch (err) {
      hadError = true;
      patch("reindex_balance", { status: "error", message: describeError(err) });
    }

    // -------- 3. Re-post item vouchers --------
    patch("repost_items", { status: "running", message: "Rebuilding postings…" });
    try {
      const targets = vouchers.filter(
        (v) => v?.is_deleted !== true && ITEM_KINDS.has(v.voucher_type) && v.party_ledger_id,
      );
      let rebuilt = 0;
      let skipped = 0;
      for (const v of targets) {
        try {
          const totals = {
            subtotal_paise: v.subtotal_paise ?? 0,
            cgst_paise: v.cgst_paise ?? 0,
            sgst_paise: v.sgst_paise ?? 0,
            igst_paise: v.igst_paise ?? 0,
            total_paise: v.total_paise ?? 0,
            round_off_paise: v.round_off_paise ?? 0,
          };
          const capitalItems =
            v.itc_class === "capital_goods"
              ? items
                  .filter((i) => i.voucher_id === v.id)
                  .map((i) => ({
                    name: (i.description || "Capital Asset").toString().trim(),
                    taxable_paise: i.taxable_paise ?? 0,
                    cgst_paise: i.cgst_paise ?? 0,
                    sgst_paise: i.sgst_paise ?? 0,
                    igst_paise: i.igst_paise ?? 0,
                  }))
              : undefined;
          const postings = await buildItemVoucherPostings(
            companyId,
            v.voucher_type as ItemVoucherKind,
            v.party_ledger_id,
            totals,
            {
              itcClass: (v.itc_class ?? "na") as ItcClass,
              itcEligible: v.itc_eligible ?? true,
              capitalItems,
            },
          );
          const stamp = new Date().toISOString();
          const rows = postings.map((p) => ({
            id: crypto.randomUUID(),
            voucher_id: v.id,
            company_id: companyId,
            ledger_id: p.ledger_id,
            debit_paise: p.debit_paise,
            credit_paise: p.credit_paise,
            narration: p.narration ?? null,
            line_no: p.line_no,
            updated_at: stamp,
          }));
          await offlineDb.transaction("rw", offlineDb.cache_voucher_entries, async () => {
            const existing = await offlineDb.cache_voucher_entries.where("voucher_id").equals(v.id).toArray();
            if (existing.length) await offlineDb.cache_voucher_entries.bulkDelete(existing.map((e: any) => e.id));
            if (rows.length) await offlineDb.cache_voucher_entries.bulkPut(rows);
          });
          rebuilt += 1;
        } catch {
          skipped += 1;
        }
      }
      totalFixed += rebuilt;
      patch("repost_items", {
        status: skipped > 0 ? "warn" : "ok",
        found: targets.length,
        fixed: rebuilt,
        message:
          skipped > 0
            ? `Re-posted ${rebuilt}/${targets.length}. Skipped ${skipped} with incomplete data.`
            : `Re-posted ${rebuilt} voucher(s).`,
      });
    } catch (err) {
      hadError = true;
      patch("repost_items", { status: "error", message: describeError(err) });
    }

    setSummary(
      hadError
        ? `Finished with errors. Fixed ${totalFixed}/${totalFound}.`
        : `Done. Rebuilt indexes and re-posted ${totalFixed} voucher(s).`,
    );
    if (hadError) toast.error("Reindex & Re-post finished with errors");
    else toast.success("Reindex & Re-post complete");
    setRunning(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-4 w-4 text-primary" /> Reindex &amp; Re-post vouchers
        </CardTitle>
        <CardDescription>
          Rebuilds local voucher indexes and regenerates automatic postings for sales, purchase, credit and debit
          notes from the voucher totals and ITC classification you saved. Runs entirely on this device — no data
          leaves your machine. Entry vouchers (receipt, payment, journal) are left untouched because their lines
          are the source of truth.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={running || !companyId}>
            {running
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running…</>
              : <><Play className="mr-2 h-4 w-4" /> Run Reindex &amp; Re-post</>}
          </Button>
          {summary && (
            <Badge variant="secondary" className="text-xs">
              {summary}
            </Badge>
          )}
        </div>

        <div className="rounded-md border">
          <ul className="divide-y">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start gap-3 p-3 text-sm">
                <div className="mt-0.5"><StatusIcon status={s.status} /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.message}</div>
                </div>
                {(s.found !== undefined || s.fixed !== undefined) && (
                  <div className="flex shrink-0 gap-1">
                    {s.found !== undefined && <Badge variant="outline" className="text-[10px]">found {s.found}</Badge>}
                    {s.fixed !== undefined && s.fixed > 0 && <Badge className="text-[10px]">fixed {s.fixed}</Badge>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          This is routine maintenance, not a recovery tool. Your data always lives in local storage on this
          device — reindex simply rewalks it and re-post regenerates the derived ledger postings from the
          numbers you already entered.
        </p>
      </CardContent>
    </Card>
  );
}
