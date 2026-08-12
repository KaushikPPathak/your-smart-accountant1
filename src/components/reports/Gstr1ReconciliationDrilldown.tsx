// GSTR-1 reconciliation drill-down.
//
// Opens from the reconciliation card on /app/reports/gstr1 to explain the
// exact invoice lines contributing to any Net-outward vs HSN-total Difference.
// Every number here is derived from the trace (`classifyAll`) so the panel
// can NEVER lie about which lines make up which totals.

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatINR } from "@/lib/money";
import { classifyAll, type TracedLine } from "@/lib/gstr1-trace";
import type { VoucherRow, CompanyMeta } from "@/lib/gst-returns";
import { Gstr1PostingAudit } from "@/components/vouchers/Gstr1PostingAudit";
import { FileDown } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  company: CompanyMeta;
  companyId: string;
  sales: VoucherRow[];
  creditNotes: VoucherRow[];
}

const CN_SECTIONS = new Set(["CDNR", "CDNRA", "CDNUR"]);

export function Gstr1ReconciliationDrilldown({
  open, onOpenChange, company, companyId, sales, creditNotes,
}: Props) {
  const [drillVoucherId, setDrillVoucherId] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<string | null>(null);

  const trace = useMemo(() => classifyAll(sales, creditNotes, company), [sales, creditNotes, company]);

  // Side A (Net outward) — signed value per line: positive for sales/DN,
  // negative for CN. This mirrors "Sales gross − CN − CDNUR" in the report.
  // Excludes NIL because the report's "Difference" row is derived from
  // (B2B + B2CL + B2CS + EXP + NIL) − CDNR/CDNUR versus HSN total. NIL sits
  // on both sides of the identity, so it must be included here too.
  const asideByVoucher = useMemo(() => {
    const m = new Map<string, { voucher: TracedLine; taxable: number; tax: number; section: string; lines: TracedLine[] }>();
    for (const l of trace.lines) {
      if (!l.section) continue;
      const sign = CN_SECTIONS.has(l.section) ? -1 : 1;
      const key = `${l.voucherId}|${l.section}`;
      const cur = m.get(key) ?? { voucher: l, taxable: 0, tax: 0, section: l.section, lines: [] };
      cur.taxable += sign * l.taxable_paise;      // taxable_paise already carries CN sign
      cur.tax += sign * (l.iamt_paise + l.camt_paise + l.samt_paise);
      cur.lines.push(l);
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.section.localeCompare(b.section) || a.voucher.voucherDate.localeCompare(b.voucher.voucherDate));
  }, [trace]);

  const bsideByVoucher = useMemo(() => {
    const m = new Map<string, { voucher: TracedLine; taxable: number; tax: number; bucket: string; lines: TracedLine[] }>();
    for (const l of trace.lines) {
      if (!l.hsnBucket) continue;
      const key = `${l.voucherId}|${l.hsnBucket}`;
      const cur = m.get(key) ?? { voucher: l, taxable: 0, tax: 0, bucket: l.hsnBucket, lines: [] };
      cur.taxable += l.taxable_paise;
      cur.tax += l.iamt_paise + l.camt_paise + l.samt_paise;
      cur.lines.push(l);
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.bucket.localeCompare(b.bucket) || a.voucher.voucherDate.localeCompare(b.voucher.voucherDate));
  }, [trace]);

  const sideATotal = asideByVoucher.reduce((s, r) => s + r.taxable + r.tax, 0);
  const sideBTotal = bsideByVoucher.reduce((s, r) => s + r.taxable + r.tax, 0);
  const diff = sideATotal - sideBTotal;

  // Per-voucher mismatch scan: for each voucher, sum A-side and B-side.
  const mismatches = useMemo(() => {
    const byV = new Map<string, { a: number; b: number; voucher: TracedLine; flags: Set<string> }>();
    for (const l of trace.lines) {
      const cur = byV.get(l.voucherId) ?? { a: 0, b: 0, voucher: l, flags: new Set<string>() };
      const line = l.taxable_paise + l.iamt_paise + l.camt_paise + l.samt_paise;
      const sign = l.section && CN_SECTIONS.has(l.section) ? -1 : 1;
      if (l.section) cur.a += sign * line;
      if (l.hsnBucket) cur.b += line;
      for (const f of l.flags) cur.flags.add(f);
      byV.set(l.voucherId, cur);
    }
    return Array.from(byV.values())
      .map((r) => ({ ...r, delta: r.a - r.b }))
      .filter((r) => Math.abs(r.delta) > 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [trace]);

  const diagnose = (delta: number, flags: Set<string>): string => {
    if (flags.has("missing_hsn")) return "HSN missing on one or more lines — counted in outward but not in HSN summary";
    if (flags.has("nil_no_hsn")) return "Nil line has no HSN → drops from HSN summary";
    if (Math.abs(delta) < 100) return "Round-off residue < ₹1";
    if (flags.has("empty_line")) return "Zero-value line skipped by HSN aggregator";
    return "Line-level classification difference — open the voucher to inspect";
  };

  const exportCsv = () => {
    const rows: string[][] = [
      ["Side", "Voucher", "Date", "Party", "Section/HSN", "Taxable (₹)", "Tax (₹)", "Total (₹)"],
    ];
    for (const r of asideByVoucher) {
      rows.push([
        "A (outward)", r.voucher.voucherNumber, r.voucher.voucherDate,
        r.voucher.partyName, r.section,
        (r.taxable / 100).toFixed(2), (r.tax / 100).toFixed(2),
        ((r.taxable + r.tax) / 100).toFixed(2),
      ]);
    }
    for (const r of bsideByVoucher) {
      rows.push([
        "B (HSN)", r.voucher.voucherNumber, r.voucher.voucherDate,
        r.voucher.partyName, r.bucket,
        (r.taxable / 100).toFixed(2), (r.tax / 100).toFixed(2),
        ((r.taxable + r.tax) / 100).toFixed(2),
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `GSTR1_Reconciliation_${company.gstin || "GSTIN"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const aSideFiltered = sectionFilter ? asideByVoucher.filter((r) => r.section === sectionFilter) : asideByVoucher;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl max-h-[92vh]">
          <DialogHeader>
            <DialogTitle>GSTR-1 Reconciliation — Explain Difference</DialogTitle>
            <DialogDescription>
              Every line contributing to the outward vs HSN identity. Click any row to open the voucher's posting audit.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4 py-2 border-y">
            <div>
              <div className="text-xs text-muted-foreground">Net outward (A)</div>
              <div className="tabular-nums font-medium">{formatINR(sideATotal)}</div>
            </div>
            <div className="text-muted-foreground">−</div>
            <div>
              <div className="text-xs text-muted-foreground">HSN total (B)</div>
              <div className="tabular-nums font-medium">{formatINR(sideBTotal)}</div>
            </div>
            <div className="text-muted-foreground">=</div>
            <div>
              <div className="text-xs text-muted-foreground">Difference</div>
              <div className={`tabular-nums font-semibold ${Math.abs(diff) > 0 ? "text-destructive" : "text-emerald-700"}`}>
                {formatINR(diff)}
              </div>
            </div>
            <div className="ml-auto flex gap-2">
              {sectionFilter && (
                <Button variant="ghost" size="sm" onClick={() => setSectionFilter(null)}>Clear filter · {sectionFilter}</Button>
              )}
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <FileDown className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            </div>
          </div>

          <ScrollArea className="h-[60vh]">
            <div className="grid grid-cols-2 gap-4 pr-3">
              <div>
                <h3 className="text-sm font-semibold mb-2">A · Net outward supplies · by section</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Section</TableHead>
                      <TableHead>Voucher</TableHead>
                      <TableHead>Party</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aSideFiltered.map((r) => (
                      <TableRow key={`${r.voucher.voucherId}|${r.section}`} className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setDrillVoucherId(r.voucher.voucherId)}>
                        <TableCell>
                          <button className="text-xs underline decoration-dotted" onClick={(e) => { e.stopPropagation(); setSectionFilter(r.section); }}>
                            {r.section}
                          </button>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{r.voucher.voucherNumber}</div>
                          <div className="text-muted-foreground">{r.voucher.voucherDate}</div>
                        </TableCell>
                        <TableCell className="text-xs">{r.voucher.partyName || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{formatINR(r.taxable)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{formatINR(r.tax)}</TableCell>
                      </TableRow>
                    ))}
                    {aSideFiltered.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-6">No rows</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">B · HSN summary · by bucket</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bucket</TableHead>
                      <TableHead>Voucher</TableHead>
                      <TableHead>Party</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bsideByVoucher.map((r) => (
                      <TableRow key={`${r.voucher.voucherId}|${r.bucket}`} className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setDrillVoucherId(r.voucher.voucherId)}>
                        <TableCell><span className="text-xs px-2 py-0.5 rounded border border-muted">{r.bucket}</span></TableCell>
                        <TableCell className="text-xs">
                          <div>{r.voucher.voucherNumber}</div>
                          <div className="text-muted-foreground">{r.voucher.voucherDate}</div>
                        </TableCell>
                        <TableCell className="text-xs">{r.voucher.partyName || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{formatINR(r.taxable)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{formatINR(r.tax)}</TableCell>
                      </TableRow>
                    ))}
                    {bsideByVoucher.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-6">No rows</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {mismatches.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold mb-2">Per-voucher mismatch scan (A − B ≠ 0)</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Voucher</TableHead>
                      <TableHead>Party</TableHead>
                      <TableHead className="text-right">A side</TableHead>
                      <TableHead className="text-right">B side</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                      <TableHead>Likely cause</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mismatches.slice(0, 200).map((m) => (
                      <TableRow key={m.voucher.voucherId} className="cursor-pointer hover:bg-amber-50"
                        onClick={() => setDrillVoucherId(m.voucher.voucherId)}>
                        <TableCell className="text-xs">
                          <div>{m.voucher.voucherNumber}</div>
                          <div className="text-muted-foreground">{m.voucher.voucherDate}</div>
                        </TableCell>
                        <TableCell className="text-xs">{m.voucher.partyName || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{formatINR(m.a)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{formatINR(m.b)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold text-amber-800">{formatINR(m.delta)}</TableCell>
                        <TableCell className="text-xs">
                          <div>{diagnose(m.delta, m.flags)}</div>
                          {m.flags.size > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {Array.from(m.flags).map((f) => (
                                <Badge key={f} variant="outline" className="text-[10px] py-0 px-1 border-amber-400 text-amber-800">{f}</Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {mismatches.length > 200 && (
                  <p className="text-xs text-muted-foreground mt-2">Showing top 200 of {mismatches.length} mismatched vouchers by |Δ|.</p>
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={!!drillVoucherId} onOpenChange={(o) => !o && setDrillVoucherId(null)}>
        <DialogContent className="max-w-5xl max-h-[92vh]">
          <DialogHeader>
            <DialogTitle>Voucher posting audit</DialogTitle>
          </DialogHeader>
          {drillVoucherId && (
            <ScrollArea className="max-h-[80vh]">
              <Gstr1PostingAudit voucherId={drillVoucherId} companyId={companyId} />
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
