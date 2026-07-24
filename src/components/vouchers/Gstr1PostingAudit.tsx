// GSTR-1 posting audit — shows exactly which GSTR-1 buckets each line of a
// single sales / CN / DN voucher posts to, and why. Mounted on the voucher
// detail page and reused inside the reconciliation drill-down.

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatINR } from "@/lib/money";
import { fetchCompanyMeta, type VoucherRow, type CompanyMeta } from "@/lib/gst-returns";
import { classifyVoucher, type TracedLine } from "@/lib/gstr1-trace";

interface Props {
  voucherId: string;
  companyId: string;
}

const SELECT = `id, voucher_date, voucher_number, voucher_type, is_interstate, place_of_supply_code,
reference_no, vendor_invoice_no, vendor_invoice_date, reason, original_voucher_id,
subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise,
supply_nature, shipping_bill_no, shipping_bill_date, port_code,
is_amendment, orig_invoice_no, orig_invoice_date, orig_period,
itc_class, itc_eligible,
ledgers:party_ledger_id(name, gstin, state_code, gst_treatment, country),
voucher_items(qty, rate_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, gst_rate,
items:item_id(name, hsn_code, unit))`;

const SECTION_TONE: Record<string, string> = {
  B2B: "bg-emerald-100 text-emerald-900 border-emerald-300",
  B2BA: "bg-emerald-50 text-emerald-800 border-emerald-200",
  B2CL: "bg-sky-100 text-sky-900 border-sky-300",
  B2CLA: "bg-sky-50 text-sky-800 border-sky-200",
  B2CS: "bg-indigo-100 text-indigo-900 border-indigo-300",
  CDNR: "bg-orange-100 text-orange-900 border-orange-300",
  CDNRA: "bg-orange-50 text-orange-800 border-orange-200",
  CDNUR: "bg-orange-100 text-orange-900 border-orange-300",
  EXP: "bg-purple-100 text-purple-900 border-purple-300",
  NIL: "bg-amber-100 text-amber-900 border-amber-300",
};

const FLAG_LABEL: Record<string, string> = {
  missing_hsn: "HSN missing",
  missing_uqc: "UQC missing",
  nil_no_hsn: "Nil line without HSN",
  header_only: "No line items",
  empty_line: "Zero-value line",
};

export function Gstr1PostingAudit({ voucherId, companyId }: Props) {
  const [voucher, setVoucher] = useState<VoucherRow | null>(null);
  const [company, setCompany] = useState<CompanyMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data, error }, meta] = await Promise.all([
          supabase.from("vouchers").select(SELECT).eq("id", voucherId).maybeSingle(),
          fetchCompanyMeta(companyId),
        ]);
        if (cancelled) return;
        if (error) throw error;
        setVoucher(data as unknown as VoucherRow);
        setCompany(meta);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [voucherId, companyId]);

  if (error) return <Card><CardContent className="p-3 text-sm text-destructive">GSTR-1 audit unavailable: {error}</CardContent></Card>;
  if (!voucher || !company) return null;

  const lines: TracedLine[] = classifyVoucher(voucher, company);

  const totals = lines.reduce(
    (a, l) => ({
      taxable: a.taxable + l.taxable_paise,
      tax: a.tax + l.iamt_paise + l.camt_paise + l.samt_paise,
    }),
    { taxable: 0, tax: 0 },
  );

  const distinctSections = Array.from(new Set(lines.map((l) => l.section).filter(Boolean))) as string[];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          GSTR-1 posting audit
          {distinctSections.map((s) => (
            <span key={s} className={`text-xs px-2 py-0.5 rounded border ${SECTION_TONE[s] || "border-muted"}`}>{s}</span>
          ))}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Where each line of this voucher lands in GSTR-1, and why. Uses the same rules as the report engine.
        </p>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>HSN</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead className="text-right">Taxable</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>HSN bucket</TableHead>
              <TableHead>Why</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{l.itemName || "—"}</TableCell>
                <TableCell><code className="text-xs">{l.hsn || "—"}</code></TableCell>
                <TableCell>{l.rate}%</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(l.taxable_paise)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(l.iamt_paise + l.camt_paise + l.samt_paise)}</TableCell>
                <TableCell>
                  {l.section ? (
                    <span className={`text-xs px-2 py-0.5 rounded border ${SECTION_TONE[l.section] || "border-muted"}`}>
                      {l.section}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">— dropped —</span>
                  )}
                  {l.subKey && <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{l.subKey}</div>}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">{l.hsnBucket || "—"}</span>
                </TableCell>
                <TableCell className="max-w-[420px]">
                  <div className="text-xs">{l.reason}</div>
                  {l.flags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {l.flags.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px] py-0 px-1 border-amber-400 text-amber-800">
                          {FLAG_LABEL[f] || f}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/50 font-medium">
              <TableCell colSpan={4}>Total ({lines.length} line{lines.length === 1 ? "" : "s"})</TableCell>
              <TableCell className="text-right tabular-nums">{formatINR(totals.taxable)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatINR(totals.tax)}</TableCell>
              <TableCell colSpan={3}></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
