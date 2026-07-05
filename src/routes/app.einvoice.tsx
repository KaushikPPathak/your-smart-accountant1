import { fmtIndianDate } from "@/lib/format-date";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Clock, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { EwayBillPrepDialog } from "@/components/vouchers/EwayBillPrepDialog";
import {
  listEinvoiceQueue, subscribeEinvoiceQueue, discardEinvoiceQueue,
  retryEinvoiceQueue, drainEinvoiceQueue, type EinvoiceQueueRow,
} from "@/lib/offline/einvoice-queue";
import { toast } from "sonner";

export const Route = createFileRoute("/app/einvoice")({
  head: () => ({ meta: [{ title: "E-Invoice & E-Way Bill — Your Mehtaji" }] }),
  component: EinvoicePage,
});

interface Row {
  id: string;
  voucher_number: string;
  voucher_date: string;
  total_paise: number;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  is_interstate: boolean;
  place_of_supply_code: string | null;
  company_id: string;
  ledgers: { name: string; gstin: string | null } | null;
  einvoice_details: { irn: string | null; status: string; ewb_no: string | null; ewb_valid_until: string | null } | null;
}

function EinvoicePage() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [dlg, setDlg] = useState<{ open: boolean; voucher: Row | null }>({ open: false, voucher: null });
  const [queue, setQueue] = useState<EinvoiceQueueRow[]>([]);
  const [draining, setDraining] = useState(false);

  async function load() {
    if (!activeCompanyId) return;
    setLoading(true);
    const { data } = await supabase.from("vouchers")
      .select("id, voucher_number, voucher_date, total_paise, subtotal_paise, cgst_paise, sgst_paise, igst_paise, is_interstate, place_of_supply_code, company_id, ledgers:party_ledger_id(name, gstin), einvoice_details(irn, status, ewb_no, ewb_valid_until)")
      .eq("company_id", activeCompanyId).eq("voucher_type", "sales")
      .order("voucher_date", { ascending: false }).order("voucher_number", { ascending: false }).limit(200);
    setRows((data || []) as unknown as Row[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, [activeCompanyId]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const rows = await listEinvoiceQueue(activeCompanyId ?? undefined);
      if (alive) setQueue(rows);
    };
    void refresh();
    const unsub = subscribeEinvoiceQueue(() => { void refresh(); });
    return () => { alive = false; unsub(); };
  }, [activeCompanyId]);

  async function retryAll() {
    setDraining(true);
    try {
      const r = await drainEinvoiceQueue();
      if (r.ok > 0) toast.success(`${r.ok} generated`);
      if (r.failed > 0) toast.error(`${r.failed} permanently failed — see queue below`);
      if (r.ok === 0 && r.failed === 0 && r.kept > 0) toast.info("Still waiting on the portal");
      await load();
    } finally { setDraining(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">E-Invoice &amp; E-Way Bill</h1>
        <p className="text-xs text-muted-foreground">
          E-Way Bill is mandatory for any consignment &gt; ₹50,000 moving inter-state, or intra-state beyond city limits (typically &gt; 50&nbsp;km). Use the prep tool to build the portal-ready JSON.
        </p>
      </div>

      {queue.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600" />
                <span className="font-semibold text-sm">
                  {queue.length} pending {queue.length === 1 ? "request" : "requests"} to the IRP / EWB portal
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={retryAll} disabled={draining}>
                <RefreshCw className={`h-3 w-3 mr-1 ${draining ? "animate-spin" : ""}`} />
                {draining ? "Retrying…" : "Retry now"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              These invoices were saved offline (or the portal was unreachable). They&apos;ll be generated automatically when the portal is reachable — no action needed.
            </p>
            <div className="rounded border divide-y">
              {queue.map((q) => (
                <div key={q.id} className="flex items-center justify-between p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant={q.status === "failed" ? "destructive" : "outline"}>
                      {q.kind === "irn" ? "IRN" : "EWB"} · {q.status}
                    </Badge>
                    <span className="font-mono">{q.voucher_number || q.voucher_id.slice(0, 8)}</span>
                    {q.attempts > 0 && (
                      <span className="text-muted-foreground">· {q.attempts} {q.attempts === 1 ? "attempt" : "attempts"}</span>
                    )}
                    {q.last_error && q.status === "failed" && (
                      <span className="text-destructive truncate max-w-[300px]" title={q.last_error}>· {q.last_error}</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {q.status === "failed" && (
                      <Button size="sm" variant="ghost" onClick={() => retryEinvoiceQueue(q.id!)}>
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => discardEinvoiceQueue(q.id!)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Invoice #</TableHead><TableHead>Party</TableHead>
              <TableHead>GSTIN</TableHead><TableHead className="text-right">Amount</TableHead>
              <TableHead>IRN status</TableHead><TableHead>EWB</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="p-6 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="p-6 text-center text-sm text-muted-foreground">No sales invoices yet.</TableCell></TableRow>
              ) : rows.map((r) => {
                const requiresEwb = r.total_paise > 5_000_000;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{fmtIndianDate(r.voucher_date)}</TableCell>
                    <TableCell className="font-medium">
                      {r.voucher_number}
                      {requiresEwb && !r.einvoice_details?.ewb_no && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">EWB needed</Badge>
                      )}
                    </TableCell>
                    <TableCell>{r.ledgers?.name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.ledgers?.gstin || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatINR(r.total_paise)}</TableCell>
                    <TableCell>
                      <Badge variant={r.einvoice_details?.irn ? "default" : "outline"}>
                        {r.einvoice_details?.irn ? "Generated" : (r.einvoice_details?.status || "Pending")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.einvoice_details?.ewb_no
                        ? <span className="font-mono">{r.einvoice_details.ewb_no}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setDlg({ open: true, voucher: r })}>
                        <Truck className="h-3 w-3 mr-1" />Prepare
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
          <p><strong>How it works:</strong> Open the prep tool to fill consignor/consignee, transport &amp; vehicle details. Copy the generated JSON to the GST EWB portal (or hand to your GSP) and paste the issued EWB number / IRN back to keep the invoice PDF in sync.</p>
          <p><Link to="/app/settings" className="underline">Go to Settings</Link> to enable e-invoicing and add your UPI ID for payment-link QRs.</p>
        </CardContent>
      </Card>

      <EwayBillPrepDialog
        open={dlg.open}
        onOpenChange={(o) => setDlg((s) => ({ ...s, open: o }))}
        voucher={dlg.voucher}
        onSaved={load}
      />
    </div>
  );
}
