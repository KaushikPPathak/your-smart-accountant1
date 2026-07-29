import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR } from "@/lib/money";
import { fmtIndianDate } from "@/lib/format-date";
import { suggestMatch, type VoucherCandidate } from "@/lib/bank/local-store";
import type { ParsedBankLine, ParseResponse } from "@/lib/bank/parse-client";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fileName: string;
  parseResult: ParseResponse | null;
  candidates: VoucherCandidate[];
  onConfirm: (rows: ParsedBankLine[]) => void;
}

export function BankImportPreviewDialog({ open, onOpenChange, fileName, parseResult, candidates, onConfirm }: Props) {
  const summary = useMemo(() => {
    if (!parseResult?.ok) return { matched: 0, unmatched: 0, dr: 0, cr: 0 };
    let matched = 0, dr = 0, cr = 0;
    for (const r of parseResult.rows) {
      if (suggestMatch(r, candidates)) matched++;
      dr += r.debit_paise; cr += r.credit_paise;
    }
    return { matched, unmatched: parseResult.rows.length - matched, dr, cr };
  }, [parseResult, candidates]);

  const rows = parseResult?.rows ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Preview import — {fileName}</DialogTitle>
        </DialogHeader>

        {!parseResult ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Parsing…</div>
        ) : !parseResult.ok ? (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {parseResult.error || "Could not parse the file."}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Rows: {rows.length}</Badge>
              <Badge variant="secondary">Auto-matched: {summary.matched}</Badge>
              <Badge variant="outline">Unmatched: {summary.unmatched}</Badge>
              <Badge variant="outline">Total Dr: {formatINR(summary.dr)}</Badge>
              <Badge variant="outline">Total Cr: {formatINR(summary.cr)}</Badge>
              {parseResult.rejectedCount > 0 && <Badge variant="outline">Skipped rows: {parseResult.rejectedCount}</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              Detected columns — Date: <b>{parseResult.detected.dateCol ?? "?"}</b>,
              Desc: <b>{parseResult.detected.descCol ?? "?"}</b>,
              Dr: <b>{parseResult.detected.drCol ?? "?"}</b>,
              Cr: <b>{parseResult.detected.crCol ?? "?"}</b>
            </div>
            <ScrollArea className="h-[360px] rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead>Match</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 500).map((r, i) => {
                    const m = suggestMatch(r, candidates);
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{fmtIndianDate(r.txn_date)}</TableCell>
                        <TableCell className="text-xs max-w-[260px] truncate">{r.description}</TableCell>
                        <TableCell className="text-xs">{r.reference}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.debit_paise ? formatINR(r.debit_paise) : ""}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.credit_paise ? formatINR(r.credit_paise) : ""}</TableCell>
                        <TableCell>
                          {m ? <Badge variant="secondary">Match</Badge> : <Badge variant="outline">—</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {rows.length > 500 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground">…and {rows.length - 500} more rows (all will be imported).</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!parseResult?.ok || rows.length === 0} onClick={() => onConfirm(rows)}>
            Import {rows.length} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
