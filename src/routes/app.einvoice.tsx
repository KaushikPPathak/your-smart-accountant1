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
