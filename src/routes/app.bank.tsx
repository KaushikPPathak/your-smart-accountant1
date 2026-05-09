import { fmtIndianDate } from "@/lib/format-date";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link2, X, FileScan } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useAuth } from "@/lib/auth-context";
import { formatINR } from "@/lib/money";
import { parseBankCsv, suggestMatch, type ParsedBankLine, type VoucherCandidate } from "@/lib/bank-rec";
import { BankOcrImportDialog } from "@/components/bank/BankOcrImportDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/app/bank")({
  head: () => ({ meta: [{ title: "Bank Reconciliation — Your Mehtaji" }] }),
  component: BankRecPage,
});

interface BankLedger { id: string; name: string }
interface Line {
  id: string;
  txn_date: string;
  description: string | null;
  reference: string | null;
  debit_paise: number;
  credit_paise: number;
  matched_voucher_id: string | null;
  match_status: string;
}

function BankRecPage() {
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const [bankLedgers, setBankLedgers] = useState<BankLedger[]>([]);
  const [bankLedgerId, setBankLedgerId] = useState<string>("");
  const [lines, setLines] = useState<Line[]>([]);
  const [candidates, setCandidates] = useState<VoucherCandidate[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [ocrOpen, setOcrOpen] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase.from("ledgers").select("id, name").eq("company_id", activeCompanyId).in("type", ["bank", "cash"]).order("name")
      .then(({ data }) => setBankLedgers((data || []) as BankLedger[]));
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase.from("vouchers").select("id, voucher_date, voucher_number, reference_no, total_paise, voucher_type")
      .eq("company_id", activeCompanyId).order("voucher_date", { ascending: false }).order("voucher_number", { ascending: false }).limit(2000)
      .then(({ data }) => setCandidates((data || []) as VoucherCandidate[]));
  }, [activeCompanyId]);

  async function loadLines() {
    if (!activeCompanyId || !bankLedgerId) { setLines([]); return; }
    const { data } = await supabase.from("bank_statement_lines")
      .select("id, txn_date, description, reference, debit_paise, credit_paise, matched_voucher_id, match_status, statement_id, bank_statements!inner(bank_ledger_id)")
      .eq("company_id", activeCompanyId).eq("bank_statements.bank_ledger_id", bankLedgerId)
      .order("txn_date", { ascending: false });
    setLines((data || []) as unknown as Line[]);
  }

  useEffect(() => { loadLines(); }, [activeCompanyId, bankLedgerId]);

  async function onUpload(file: File) {
    if (!activeCompanyId || !bankLedgerId || !user) { toast.error("Pick a bank ledger first"); return; }
    const text = await file.text();
    const parsed = parseBankCsv(text);
    if (parsed.length === 0) { toast.error("Could not parse this CSV. Expected Date, Description, Debit, Credit columns."); return; }
    const dates = parsed.map((p) => p.txn_date).sort();
    const { data: stmt, error } = await supabase.from("bank_statements").insert({
      company_id: activeCompanyId, bank_ledger_id: bankLedgerId, file_name: file.name,
      from_date: dates[0], to_date: dates[dates.length - 1],
      total_lines: parsed.length, imported_by: user.id,
    }).select("id").single();
    if (error || !stmt) { toast.error(error?.message || "Import failed"); return; }
    const rows = parsed.map((p: ParsedBankLine) => {
      const matchId = suggestMatch(p, candidates);
      return {
        statement_id: stmt.id, company_id: activeCompanyId,
        txn_date: p.txn_date, description: p.description, reference: p.reference,
        debit_paise: p.debit_paise, credit_paise: p.credit_paise, balance_paise: p.balance_paise,
        matched_voucher_id: matchId, match_status: matchId ? "suggested" : "unmatched",
      };
    });
    const { error: lineErr } = await supabase.from("bank_statement_lines").insert(rows);
    if (lineErr) { toast.error(lineErr.message); return; }
    toast.success(`Imported ${parsed.length} lines · ${rows.filter((r) => r.matched_voucher_id).length} suggested matches`);
    if (fileRef.current) fileRef.current.value = "";
    loadLines();
  }

  async function setStatus(id: string, status: "matched" | "ignored", voucherId?: string | null) {
    await supabase.from("bank_statement_lines").update({ match_status: status, matched_voucher_id: voucherId ?? null }).eq("id", id);
    loadLines();
  }

  const counts = useMemo(() => {
    const o = { matched: 0, suggested: 0, unmatched: 0, ignored: 0 } as Record<string, number>;
    for (const l of lines) o[l.match_status] = (o[l.match_status] || 0) + 1;
    return o;
  }, [lines]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Bank Reconciliation</h1>
        <p className="text-xs text-muted-foreground">Import bank CSV or scan a PDF/photo of a statement → auto-match → confirm or ignore.</p>
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
              <Label className="text-xs">Upload statement (CSV)</Label>
              <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={!bankLedgerId}
                onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Or scan PDF / Image (offline OCR)</Label>
              <Button size="sm" variant="outline" disabled={!bankLedgerId} onClick={() => setOcrOpen(true)}>
                <FileScan className="mr-2 h-3.5 w-3.5" /> Import from PDF / Image
              </Button>
            </div>
            <div className="ml-auto flex gap-2 text-xs">
              <Badge variant="outline">Matched: {counts.matched || 0}</Badge>
              <Badge variant="outline">Suggested: {counts.suggested || 0}</Badge>
              <Badge variant="outline">Unmatched: {counts.unmatched || 0}</Badge>
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
                    <TableCell className="font-mono text-xs">{l.txn_date}</TableCell>
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

      {activeCompanyId && bankLedgerId && user && (
        <BankOcrImportDialog
          open={ocrOpen}
          onOpenChange={setOcrOpen}
          companyId={activeCompanyId}
          bankLedgerId={bankLedgerId}
          userId={user.id}
          onPosted={loadLines}
        />
      )}
    </div>
  );
}
