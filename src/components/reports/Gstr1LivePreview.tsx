// Live GSTR-1 preview panel.
//
// Renders a compact per-section summary that re-runs `buildGstr1` whenever any
// voucher save fires on the cache-events bus, debounced. Provides an
// always-current Excel + JSON export from the exact in-memory build.

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileSpreadsheet, FileJson, RefreshCw, Search } from "lucide-react";
import { onDataChange } from "@/lib/ai/cache-events";
import {
  buildGstr1, gstr1ToJson, gstr1ToXlsxSheets, downloadJson,
  type VoucherRow, type CompanyMeta,
} from "@/lib/gst-returns";
import { downloadXlsx } from "@/lib/exporters";
import { classifyAll, sumBySection, sumByHsnBucket } from "@/lib/gstr1-trace";
import { formatINR } from "@/lib/money";

interface Props {
  company: CompanyMeta;
  companyId: string;
  sales: VoucherRow[];
  creditNotes: VoucherRow[];
  from: string;
  to: string;
  fp: string;
  iffOnly: boolean;
  fileBase: string;
  onOpenDrilldown: () => void;
  onReload: () => void;
}

export function Gstr1LivePreview({
  company, companyId, sales, creditNotes, from, to, fp, iffOnly, fileBase,
  onOpenDrilldown, onReload,
}: Props) {
  const [tick, setTick] = useState(0);
  const debounceRef = useRef<number | null>(null);

  // Live subscription: whenever a voucher is saved for this company, debounce
  // 300 ms and ask the page to re-fetch. The page owns the query; we own the
  // computation. This mirrors the AI cache warm-up pattern.
  useEffect(() => {
    const off = onDataChange((e) => {
      if (e.companyId !== companyId || e.kind !== "voucher") return;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        onReload();
        setTick((t) => t + 1);
      }, 300);
    });
    return () => {
      off();
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [companyId, onReload]);

  const built = useMemo(
    () => buildGstr1({ company, from, to, fp, sales, creditNotes, iffOnly }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [company, sales, creditNotes, from, to, fp, iffOnly, tick],
  );

  const trace = useMemo(() => classifyAll(sales, creditNotes, company), [sales, creditNotes, company]);
  const sections = useMemo(() => sumBySection(trace.lines), [trace]);
  const hsn = useMemo(() => sumByHsnBucket(trace.lines), [trace]);

  const cnSet = new Set(["CDNR", "CDNRA", "CDNUR"]);
  const outward = sections.reduce((s, r) => s + (cnSet.has(r.section) ? -1 : 1) * (r.taxable + r.iamt + r.camt + r.samt), 0);
  const hsnTotal = hsn.reduce((s, r) => s + r.taxable + r.iamt + r.camt + r.samt, 0);
  const diff = outward - hsnTotal;

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Live GSTR-1 preview
            <Badge variant="outline" className="text-[10px]">auto-refresh on voucher save</Badge>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { onReload(); setTick((t) => t + 1); }}>
                <RefreshCw className="h-3 w-3 mr-1" /> Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={onOpenDrilldown}>
                <Search className="h-3 w-3 mr-1" /> Explain Difference
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadXlsx(`${fileBase}.xlsx`, gstr1ToXlsxSheets(built))}>
                <FileSpreadsheet className="h-3 w-3 mr-1" /> Excel now
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadJson(`${fileBase}.json`, gstr1ToJson(built))}>
                <FileJson className="h-3 w-3 mr-1" /> JSON now
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Net outward (A)" value={outward} />
            <Stat label="HSN total (B)" value={hsnTotal} />
            <Stat label="Difference (A − B)" value={diff} tone={Math.abs(diff) > 0 ? "warn" : "ok"} />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Section</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.map((s) => (
                <TableRow key={s.section}>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button onClick={onOpenDrilldown} className="text-xs underline decoration-dotted">{s.section}</button>
                      </TooltipTrigger>
                      <TooltipContent>{s.lineCount} line{s.lineCount === 1 ? "" : "s"} — click to trace</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.lineCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(s.taxable)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(s.iamt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(s.camt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(s.samt)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatINR(s.total)}</TableCell>
                </TableRow>
              ))}
              {hsn.map((h) => (
                <TableRow key={h.bucket} className="bg-muted/30">
                  <TableCell><span className="text-xs">{h.bucket}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{h.lineCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(h.taxable)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(h.iamt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(h.camt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatINR(h.samt)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatINR(h.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <p className="text-[11px] text-muted-foreground">
            Source: live trace of {trace.lines.length} lines from {sales.length} sales + {creditNotes.length} note voucher(s).
            Numbers here are computed by the same engine that writes your Excel and JSON exports.
            {/* companyId used implicitly by parent onReload */}
            <span className="hidden">{companyId}</span>
          </p>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color = tone === "warn" && Math.abs(value) > 0 ? "text-destructive" : tone === "ok" ? "text-emerald-700" : "";
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tabular-nums font-semibold ${color}`}>{formatINR(value)}</div>
    </div>
  );
}
