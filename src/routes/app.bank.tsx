import { fmtIndianDate } from "@/lib/format-date";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link2, X, FileScan, Trash2, BookPlus } from "lucide-react";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { readLedgers } from "@/lib/offline/cache-read";
import { parseStatementFile, type ParseResponse } from "@/lib/bank/parse-client";
import {
  commitStatement, listLines, loadVoucherCandidates, updateLine, deleteStatement, suggestMatch,
  type LocalBankLine, type VoucherCandidate,
} from "@/lib/bank/local-store";
import { BankImportPreviewDialog } from "@/components/bank/BankImportPreviewDialog";
import { BankOcrImportDialog } from "@/components/bank/BankOcrImportDialog";
import { BankLinePostDialog } from "@/components/bank/BankLinePostDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/app/bank")({
  head: () => ({ meta: [{ title: "Bank Reconciliation — Your Mehtaji" }] }),
  component: BankRecPage,
});

interface BankLedger { id: string; name: string }

function BankRecPage() {
  const { activeCompanyId } = useCompany();
  const [bankLedgers, setBankLedgers] = useState<BankLedger[]>([]);
  const [bankLedgerId, setBankLedgerId] = useState<string>("");
  const [lines, setLines] = useState<LocalBankLine[]>([]);
  const [candidates, setCandidates] = useState<VoucherCandidate[]>([]);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [pendingFileName, setPendingFileName] = useState("");
  const [postLine, setPostLine] = useState<LocalBankLine | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load bank/cash ledgers from local cache.
  useEffect(() => {
    if (!activeCompanyId) return;
    readLedgers(activeCompanyId).then((rows: any[]) => {
      const bs = rows
        .filter((l) => !l.is_deleted && ["bank", "cash"].includes(String(l.type || "").toLowerCase()))
        .map((l) => ({ id: String(l.id), name: String(l.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setBankLedgers(bs);
    });
  }, [activeCompanyId]);

  const reloadLines = useCallback(async () => {
    if (!activeCompanyId || !bankLedgerId) { setLines([]); return; }
    const [ls, cs] = await Promise.all([
      listLines(activeCompanyId, bankLedgerId),
      loadVoucherCandidates(activeCompanyId, bankLedgerId),
    ]);
    setLines(ls);
    setCandidates(cs);
  }, [activeCompanyId, bankLedgerId]);

  useEffect(() => { reloadLines(); }, [reloadLines]);

  async function onFilePicked(file: File) {
    if (!activeCompanyId || !bankLedgerId) { toast.error("Pick a bank ledger first"); return; }
    setPendingFileName(file.name);
    setParseResult(null);
    setPreviewOpen(true);
    const res = await parseStatementFile(file);
    setParseResult(res);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onConfirmImport(rows: import("@/lib/bank/parse-client").ParsedBankLine[]) {
    if (!activeCompanyId || !bankLedgerId) return;
    const res = await commitStatement(activeCompanyId, bankLedgerId, pendingFileName, rows, candidates);
    toast.success(`Imported ${rows.length} lines · ${res.matched} auto-matched`);
    setPreviewOpen(false);
    setParseResult(null);
    reloadLines();
  }

  async function setStatus(id: string, status: LocalBankLine["match_status"], voucherId?: string | null) {
    await updateLine(id, { match_status: status, matched_voucher_id: voucherId ?? null });
    reloadLines();
  }

  // After posting a receipt/payment from an unmatched line, re-run matching so
  // the freshly created voucher links back to that statement line.
  async function onPosted(line: LocalBankLine) {
    if (!activeCompanyId || !bankLedgerId) return;
    const cs = await loadVoucherCandidates(activeCompanyId, bankLedgerId);
    const m = suggestMatch(
      {
        txn_date: line.txn_date,
        description: line.description,
        reference: line.reference,
        debit_paise: line.debit_paise,
        credit_paise: line.credit_paise,
        balance_paise: line.balance_paise,
      } as any,
      cs,
    );
    await updateLine(line.id, { match_status: "matched", matched_voucher_id: m?.id ?? null });
    setCandidates(cs);
    reloadLines();
  }



  const counts = useMemo(() => {
    const o = { matched: 0, suggested: 0, unmatched: 0, ignored: 0 } as Record<string, number>;
    for (const l of lines) o[l.match_status] = (o[l.match_status] || 0) + 1;
    return o;
  }, [lines]);

  const statementIds = useMemo(() => Array.from(new Set(lines.map((l) => l.statement_id))), [lines]);

  async function onDeleteAll() {
    if (!statementIds.length) return;
    if (!window.confirm(`Delete ${lines.length} imported lines for this ledger?`)) return;
    for (const sid of statementIds) await deleteStatement(sid);
    toast.success("Cleared imported statement lines.");
    reloadLines();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Bank Reconciliation</h1>
        <p className="text-xs text-muted-foreground">
          Import bank CSV / Excel → preview → auto-match against local vouchers → confirm.
          Statements stay on this device only.
        </p>
      </div>
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Bank ledger</Label>
              <Select value={bankLedgerId} onValueChange={setBankLedgerId}>
                <SelectTrigger className="h-9 w-[260px]"><SelectValue placeholder="Select bank/cash ledger" /></SelectTrigger>
                <SelectContent>
                  {bankLedgers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Upload statement (CSV / XLSX)</Label>
              <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx,text/csv" disabled={!bankLedgerId}
                onChange={(e) => e.target.files?.[0] && onFilePicked(e.target.files[0])}
                className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Or scan PDF / Image (offline OCR)</Label>
              <Button size="sm" variant="outline" disabled={!bankLedgerId} onClick={() => setOcrOpen(true)}>
                <FileScan className="mr-2 h-3.5 w-3.5" /> Import from PDF / Image
              </Button>
            </div>
            <div className="ml-auto flex flex-wrap gap-2 text-xs items-center">
              <Badge variant="outline">Matched: {counts.matched || 0}</Badge>
              <Badge variant="outline">Suggested: {counts.suggested || 0}</Badge>
              <Badge variant="outline">Unmatched: {counts.unmatched || 0}</Badge>
              {lines.length > 0 && (
                <Button size="sm" variant="ghost" onClick={onDeleteAll} title="Clear imported lines">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Ref</TableHead>
              <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead>
              <TableHead>Status</TableHead><TableHead>Match</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="p-6 text-center text-sm text-muted-foreground">No imported lines yet.</TableCell></TableRow>
              ) : lines.map((l) => {
                const v = candidates.find((c) => c.id === l.matched_voucher_id);
                return (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{fmtIndianDate(l.txn_date)}</TableCell>
                    <TableCell className="text-sm">{l.description}</TableCell>
                    <TableCell className="text-xs">{l.reference}</TableCell>
                    <TableCell className="text-right font-mono">{l.debit_paise ? formatINR(l.debit_paise) : ""}</TableCell>
                    <TableCell className="text-right font-mono">{l.credit_paise ? formatINR(l.credit_paise) : ""}</TableCell>
                    <TableCell>
                      <Badge variant={l.match_status === "matched" ? "default" : l.match_status === "suggested" ? "secondary" : "outline"}>
                        {l.match_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{v ? `${v.voucher_number} · ${formatINR(v.total_paise)}` : "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {l.matched_voucher_id && l.match_status !== "matched" && (
                          <Button size="sm" variant="default" onClick={() => setStatus(l.id, "matched", l.matched_voucher_id)}>
                            <Link2 className="h-3 w-3 mr-1" />Confirm
                          </Button>
                        )}
                        {l.match_status !== "ignored" && (
                          <Button size="icon" variant="ghost" onClick={() => setStatus(l.id, "ignored", null)} title="Ignore">
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BankImportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        fileName={pendingFileName}
        parseResult={parseResult}
        candidates={candidates}
        onConfirm={onConfirmImport}
      />

      {activeCompanyId && bankLedgerId && (
        <BankOcrImportDialog
          open={ocrOpen}
          onOpenChange={setOcrOpen}
          companyId={activeCompanyId}
          bankLedgerId={bankLedgerId}
          userId=""
          onPosted={reloadLines}
        />
      )}
    </div>
  );
}
