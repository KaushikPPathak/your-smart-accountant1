// Offline bank-statement OCR import: upload PDF/image, edit extracted rows,
// duplicate-check vs existing bank_statement_lines (date+amount+reference),
// then post into bank_statements + bank_statement_lines.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, FileScan, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractTextFromFile, type OcrProgress } from "@/lib/ocr";
import { parseStatementText, extractTradeRefs, type ExtractedTxn } from "@/lib/statement-parse";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  bankLedgerId: string;
  userId: string;
  onPosted: () => void;
}

interface EditableTxn extends ExtractedTxn {
  _key: string;
  _dup: boolean;
  _selected: boolean;
}

export function BankOcrImportDialog({
  open, onOpenChange, companyId, bankLedgerId, userId, onPosted,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [rows, setRows] = useState<EditableTxn[]>([]);
  const [tradeRefs, setTradeRefs] = useState<{ shipping_bills: string[]; invoices: string[] }>({
    shipping_bills: [], invoices: [],
  });
  const [posting, setPosting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFile(null); setPreview(""); setRows([]); setProgress(null);
      setTradeRefs({ shipping_bills: [], invoices: [] });
    }
  }, [open]);

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function runOcr() {
    if (!file) return;
    setBusy(true);
    try {
      const text = await extractTextFromFile(file, setProgress);
      const parsed = parseStatementText(text);
      setTradeRefs(extractTradeRefs(text));

      // Duplicate check vs existing bank_statement_lines for this bank ledger
      const dates = parsed.map((p) => p.txn_date);
      const minD = dates.sort()[0];
      const maxD = dates[dates.length - 1];
      const dupKeys = new Set<string>();
      if (minD && maxD) {
        const { data } = await supabase
          .from("bank_statement_lines")
          .select("txn_date, debit_paise, credit_paise, reference, bank_statements!inner(bank_ledger_id)")
          .eq("company_id", companyId)
          .eq("bank_statements.bank_ledger_id", bankLedgerId)
          .gte("txn_date", minD)
          .lte("txn_date", maxD);
        for (const r of (data || []) as { txn_date: string; debit_paise: number; credit_paise: number; reference: string | null }[]) {
          dupKeys.add(`${r.txn_date}|${r.debit_paise}|${r.credit_paise}|${(r.reference || "").trim()}`);
        }
      }

      setRows(parsed.map((p, i) => {
        const key = `${p.txn_date}|${Math.round(p.debit * 100)}|${Math.round(p.credit * 100)}|${(p.reference || "").trim()}`;
        return { ...p, _key: `r${i}`, _dup: dupKeys.has(key), _selected: !dupKeys.has(key) };
      }));
      toast.success(`Extracted ${parsed.length} transactions`);
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || "OCR failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function updateRow(key: string, patch: Partial<EditableTxn>) {
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r._key !== key));
  }

  const stats = useMemo(() => {
    const sel = rows.filter((r) => r._selected);
    return {
      selected: sel.length,
      dups: rows.filter((r) => r._dup).length,
      totalDr: sel.reduce((a, r) => a + r.debit, 0),
      totalCr: sel.reduce((a, r) => a + r.credit, 0),
    };
  }, [rows]);

  async function postToBooks() {
    const selected = rows.filter((r) => r._selected);
    if (!selected.length) { toast.error("No rows selected"); return; }
    setPosting(true);
    try {
      const dates = selected.map((r) => r.txn_date).sort();
      const { data: stmt, error: e1 } = await supabase
        .from("bank_statements")
        .insert({
          company_id: companyId,
          bank_ledger_id: bankLedgerId,
          file_name: file?.name || "ocr-import.pdf",
          from_date: dates[0],
          to_date: dates[dates.length - 1],
          total_lines: selected.length,
          imported_by: userId,
        })
        .select("id")
        .single();
      if (e1 || !stmt) throw e1 || new Error("Failed to create statement");

      const lineRows = selected.map((r) => ({
        statement_id: stmt.id,
        company_id: companyId,
        txn_date: r.txn_date,
        description: r.description.slice(0, 500),
        reference: r.reference || null,
        debit_paise: Math.round(r.debit * 100),
        credit_paise: Math.round(r.credit * 100),
        balance_paise: r.balance != null ? Math.round(r.balance * 100) : null,
        match_status: "unmatched",
      }));
      const { error: e2 } = await supabase.from("bank_statement_lines").insert(lineRows);
      if (e2) throw e2;
      toast.success(`Posted ${selected.length} bank lines`);
      onPosted();
      onOpenChange(false);
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || "Posting failed");
    } finally {
      setPosting(false);
    }
  }

  const isPdf = !!file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileScan className="h-4 w-4" /> Import Bank Statement (PDF / Image) — Offline OCR
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-2 gap-3 overflow-hidden min-h-0">
          {/* Left: original document */}
          <div className="flex flex-col rounded-md border bg-muted/30 min-h-0">
            <div className="flex items-center gap-2 border-b p-2">
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRows([]); }}
              />
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                Choose PDF / Image
              </Button>
              <Button size="sm" onClick={runOcr} disabled={!file || busy}>
                {busy ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Reading…</> : "Extract"}
              </Button>
              {file && <span className="text-xs text-muted-foreground truncate">{file.name}</span>}
            </div>
            <div className="flex-1 overflow-auto p-2">
              {!preview ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Upload a bank statement PDF or photo to begin.
                </div>
              ) : isPdf ? (
                <iframe src={preview} className="h-full w-full rounded" title="document preview" />
              ) : (
                <img src={preview} alt="statement" className="max-w-full rounded border" />
              )}
              {progress && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {progress.stage === "pdf-text" && `Reading text layer page ${progress.page}/${progress.totalPages}…`}
                  {progress.stage === "ocr" && `OCR ${progress.page ? `page ${progress.page}/${progress.totalPages}` : ""} ${progress.pct ?? 0}%`}
                </div>
              )}
            </div>
          </div>

          {/* Right: extracted editable table */}
          <div className="flex flex-col rounded-md border min-h-0">
            <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
              <Badge variant="outline">Selected: {stats.selected}</Badge>
              <Badge variant="outline">Duplicates: {stats.dups}</Badge>
              <Badge variant="outline">Dr ₹{stats.totalDr.toFixed(2)}</Badge>
              <Badge variant="outline">Cr ₹{stats.totalCr.toFixed(2)}</Badge>
              {tradeRefs.shipping_bills.length > 0 && (
                <Badge>SB refs: {tradeRefs.shipping_bills.length}</Badge>
              )}
              {tradeRefs.invoices.length > 0 && (
                <Badge>INV refs: {tradeRefs.invoices.length}</Badge>
              )}
            </div>
            <ScrollArea className="flex-1">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="w-[110px]">Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[110px]">Ref</TableHead>
                    <TableHead className="w-[100px] text-right">Debit</TableHead>
                    <TableHead className="w-[100px] text-right">Credit</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      No rows yet. Click "Extract" to scan the document.
                    </TableCell></TableRow>
                  ) : rows.map((r) => (
                    <TableRow key={r._key} className={r._dup ? "bg-amber-500/5" : ""}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={r._selected}
                          onChange={(e) => updateRow(r._key, { _selected: e.target.checked })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs" value={r.txn_date}
                          onChange={(e) => updateRow(r._key, { txn_date: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs" value={r.description}
                          onChange={(e) => updateRow(r._key, { description: e.target.value })} />
                        {r._dup && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                            <AlertTriangle className="h-3 w-3" /> Duplicate of existing line
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs" value={r.reference}
                          onChange={(e) => updateRow(r._key, { reference: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs text-right" type="number" value={r.debit || ""}
                          onChange={(e) => updateRow(r._key, { debit: parseFloat(e.target.value) || 0 })} />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs text-right" type="number" value={r.credit || ""}
                          onChange={(e) => updateRow(r._key, { credit: parseFloat(e.target.value) || 0 })} />
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeRow(r._key)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={postToBooks} disabled={posting || stats.selected === 0}>
            {posting ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Posting…</> : `Post ${stats.selected} to Books`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
