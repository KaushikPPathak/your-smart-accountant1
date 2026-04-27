// Offline Opening-Balance import: upload trial balance / balance sheet image or PDF,
// OCR-extract account name + amount + Dr/Cr, map each row to an existing ledger
// (or create a new one), then write opening balances onto ledgers.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractTextFromFile, type OcrProgress } from "@/lib/ocr";
import { extractOpeningBalanceTotals, parseTrialBalanceText, type ExtractedOpening } from "@/lib/statement-parse";
import type { Database } from "@/integrations/supabase/types";
import {
  ACCOUNT_GROUPS,
  GROUP_BY_CODE,
  defaultLedgerTypeForGroup,
  guessGroupCode,
} from "@/lib/account-groups";

type LedgerType = Database["public"]["Enums"]["ledger_type"];

const LEDGER_TYPES: { value: LedgerType; label: string }[] = [
  { value: "sundry_debtor", label: "Sundry Debtor" },
  { value: "sundry_creditor", label: "Sundry Creditor" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "expense_direct", label: "Direct Expense" },
  { value: "expense_indirect", label: "Indirect Expense" },
  { value: "income_direct", label: "Direct Income" },
  { value: "income_indirect", label: "Indirect Income" },
  { value: "fixed_asset", label: "Fixed Asset" },
  { value: "current_asset", label: "Current Asset" },
  { value: "current_liability", label: "Current Liability" },
  { value: "loan_liability", label: "Loan Liability" },
  { value: "capital", label: "Capital" },
  { value: "duties_taxes", label: "Duties & Taxes" },
  { value: "stock_in_hand", label: "Stock in Hand" },
];

interface LedgerOpt { id: string; name: string; type: LedgerType }

interface EditableRow extends ExtractedOpening {
  _key: string;
  _selected: boolean;
  ledger_id: string; // empty = create-new
  new_type: LedgerType;
  group_code: string;
}

interface Props { companyId: string; disabled: boolean }

export function OpeningBalanceImport({ companyId, disabled }: Props) {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [rawText, setRawText] = useState("");
  const [documentTotals, setDocumentTotals] = useState<{ sourcesTotal: number | null; applicationsTotal: number | null }>({
    sourcesTotal: null,
    applicationsTotal: null,
  });
  const [showRaw, setShowRaw] = useState(false);
  const [ledgers, setLedgers] = useState<LedgerOpt[]>([]);
  const [posting, setPosting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!companyId) return;
    supabase
      .from("ledgers")
      .select("id, name, type")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => setLedgers((data || []) as LedgerOpt[]));
  }, [companyId]);

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function autoMatch(name: string): string {
    const norm = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const normaliseLedger = (ledgerName: string) => ledgerName.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const exact = ledgers.find((l) => normaliseLedger(l.name) === norm);
    if (exact) return exact.id;
    const partial = ledgers.find((l) =>
      normaliseLedger(l.name).includes(norm) || norm.includes(normaliseLedger(l.name)),
    );
    return partial?.id ?? "";
  }
  function guessType(name: string, side: "Dr" | "Cr"): LedgerType {
    const n = name.toLowerCase();
    if (/bank|hdfc|icici|sbi|axis|kotak|yes bank/.test(n)) return "bank";
    if (/cash/.test(n)) return "cash";
    if (/debtor|receivable|customer/.test(n)) return "sundry_debtor";
    if (/creditor|payable|supplier|vendor/.test(n)) return "sundry_creditor";
    if (/capital|equity|owner/.test(n)) return "capital";
    if (/loan|borrow/.test(n)) return "loan_liability";
    if (/cgst|sgst|igst|tax|tds/.test(n)) return "duties_taxes";
    if (/stock|inventory|goods/.test(n)) return "stock_in_hand";
    if (/building|machinery|furniture|vehicle|equipment|asset/.test(n)) return "fixed_asset";
    if (/sales|revenue|income/.test(n)) return "income_direct";
    if (/purchase|cogs|cost of/.test(n)) return "expense_direct";
    if (/expense|salary|rent|electricity|interest paid/.test(n)) return "expense_indirect";
    return side === "Dr" ? "current_asset" : "current_liability";
  }

  async function runOcr() {
    if (!file) return;
    setBusy(true);
    try {
      const text = await extractTextFromFile(file, setProgress);
      setRawText(text);
      setDocumentTotals(extractOpeningBalanceTotals(text));
      const parsed = parseTrialBalanceText(text);
      setRows(parsed.map((p, i) => {
        const groupCode = guessGroupCode(p.account_name, p.side);
        return {
          ...p,
          _key: `r${i}`,
          _selected: true,
          ledger_id: autoMatch(p.account_name),
          new_type: defaultLedgerTypeForGroup(groupCode),
          group_code: groupCode,
        };
      }));
      toast.success(`Extracted ${parsed.length} accounts. Click "Show OCR text" to see what was read.`);
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || "OCR failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function update(key: string, patch: Partial<EditableRow>) {
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }
  function remove(key: string) {
    setRows((rs) => rs.filter((r) => r._key !== key));
  }
  function addBlank() {
    setRows((rs) => [...rs, {
      _key: `n${Date.now()}`, _selected: true, ledger_id: "", new_type: "current_asset",
      account_name: "", amount: 0, side: "Dr", group_code: "CURRENT_ASSETS",
    }]);
  }

  const stats = useMemo(() => {
    const sel = rows.filter((r) => r._selected);
    const dr = sel.filter((r) => r.side === "Dr").reduce((a, r) => a + r.amount, 0);
    const cr = sel.filter((r) => r.side === "Cr").reduce((a, r) => a + r.amount, 0);
    const diff = dr - cr;
    const sourceDiff = documentTotals.sourcesTotal == null ? 0 : cr - documentTotals.sourcesTotal;
    const applicationDiff = documentTotals.applicationsTotal == null ? 0 : dr - documentTotals.applicationsTotal;
    return { count: sel.length, dr, cr, diff, sourceDiff, applicationDiff };
  }, [documentTotals, rows]);

  async function postOpenings() {
    const sel = rows.filter((r) => r._selected && r.account_name.trim() && r.amount > 0);
    if (!sel.length) { toast.error("Nothing to post"); return; }
    if (Math.abs(stats.diff) >= 0.5) {
      toast.error("Debit and Credit totals must match before posting opening balances.");
      return;
    }
    if (Math.abs(stats.sourceDiff) >= 0.5 || Math.abs(stats.applicationDiff) >= 0.5) {
      toast.error("Selected ledger heads must match the Balance Sheet Sources and Applications totals.");
      return;
    }
    setPosting(true);
    try {
      let created = 0, updated = 0;
      for (const r of sel) {
        let ledgerId = r.ledger_id;
        if (!ledgerId) {
          const { data, error } = await supabase
            .from("ledgers")
            .insert({
              company_id: companyId,
              name: r.account_name.trim(),
              type: r.new_type,
              opening_balance_paise: Math.round(r.amount * 100),
              opening_balance_is_debit: r.side === "Dr",
            })
            .select("id")
            .single();
          if (error) throw error;
          ledgerId = data!.id;
          created++;
        } else {
          const { error } = await supabase
            .from("ledgers")
            .update({
              opening_balance_paise: Math.round(r.amount * 100),
              opening_balance_is_debit: r.side === "Dr",
            })
            .eq("id", ledgerId);
          if (error) throw error;
          updated++;
        }
      }
      toast.success(`Opening balances posted as of 01/04/${year} — ${created} created, ${updated} updated`);
      setRows([]); setFile(null);
      // refresh ledger list
      const { data } = await supabase
        .from("ledgers")
        .select("id, name, type")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name");
      setLedgers((data || []) as LedgerOpt[]);
    } catch (e) {
      const err = e as Error;
      toast.error(err.message || "Posting failed");
    } finally {
      setPosting(false);
    }
  }

  const isPdf = !!file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4" /> Opening Balance Import (Trial Balance / BS)
        </CardTitle>
        <CardDescription>
          Upload a trial balance or balance sheet PDF/image. Offline OCR extracts account names and
          amounts. Map each row to an existing ledger (or create new), then post opening balances as of
          01/04/&lt;FY&gt;.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Financial Year (1 Apr)</Label>
            <Input type="number" className="h-9 w-28" value={year}
              onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Document</Label>
            <div className="flex gap-2">
              <input ref={fileInput} type="file" accept=".pdf,image/*" className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRows([]); setRawText(""); setDocumentTotals({ sourcesTotal: null, applicationsTotal: null }); }} />
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={disabled}>
                Choose PDF / Image
              </Button>
              <Button size="sm" onClick={runOcr} disabled={!file || busy || disabled}>
                {busy ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Reading…</> : "Extract"}
              </Button>
            </div>
            {file && <div className="text-[11px] text-muted-foreground truncate max-w-[280px]">{file.name}</div>}
            {progress && (
              <div className="text-[11px] text-muted-foreground">
                {progress.stage === "pdf-text" && `Reading text page ${progress.page}/${progress.totalPages}…`}
                {progress.stage === "ocr" && `OCR ${progress.page ? `${progress.page}/${progress.totalPages} ` : ""}${progress.pct ?? 0}%`}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {rawText && (
              <Button size="sm" variant="outline" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "Hide" : "Show"} OCR text
              </Button>
            )}
            <Badge variant="outline">Rows: {stats.count}</Badge>
            {documentTotals.sourcesTotal != null && <Badge variant="outline">BS Sources ₹{documentTotals.sourcesTotal.toFixed(2)}</Badge>}
            {documentTotals.applicationsTotal != null && <Badge variant="outline">BS Applications ₹{documentTotals.applicationsTotal.toFixed(2)}</Badge>}
            <Badge variant="outline">Dr ₹{stats.dr.toFixed(2)}</Badge>
            <Badge variant="outline">Cr ₹{stats.cr.toFixed(2)}</Badge>
            {documentTotals.sourcesTotal != null && (
              <Badge variant={Math.abs(stats.sourceDiff) < 0.5 ? "default" : "destructive"}>Sources Δ ₹{stats.sourceDiff.toFixed(2)}</Badge>
            )}
            {documentTotals.applicationsTotal != null && (
              <Badge variant={Math.abs(stats.applicationDiff) < 0.5 ? "default" : "destructive"}>Applications Δ ₹{stats.applicationDiff.toFixed(2)}</Badge>
            )}
            <Badge variant={Math.abs(stats.diff) < 0.5 ? "default" : "destructive"}>
              Diff ₹{stats.diff.toFixed(2)}
            </Badge>
          </div>
        </div>

        {showRaw && rawText && (
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="text-[11px] font-medium mb-1 text-muted-foreground">
              Raw OCR text — copy any line that's missing from the table and use "+ Add row" to enter it manually.
            </div>
            <pre className="text-[11px] whitespace-pre-wrap max-h-[260px] overflow-auto font-mono">{rawText}</pre>
          </div>
        )}

        {(documentTotals.sourcesTotal != null || documentTotals.applicationsTotal != null) && (
          <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
            Balance Sheet check: selected Cr heads must equal Sources of Funds and selected Dr heads must equal Applications of Funds before posting.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-3 min-h-[400px]">
          <div className="rounded-md border bg-muted/30 overflow-hidden">
            {!preview ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground p-4 text-center">
                Original document preview will appear here.
              </div>
            ) : isPdf ? (
              <iframe src={preview} className="h-full min-h-[400px] w-full" title="trial balance" />
            ) : (
              <img src={preview} alt="tb" className="max-w-full" />
            )}
          </div>

          <div className="rounded-md border flex flex-col min-h-0">
            <div className="flex justify-between items-center border-b p-2">
              <span className="text-xs font-medium">Extracted accounts (editable)</span>
              <Button size="sm" variant="ghost" onClick={addBlank} disabled={disabled}>+ Add row</Button>
            </div>
            <ScrollArea className="max-h-[460px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Account from document</TableHead>
                    <TableHead>Map to ledger</TableHead>
                    <TableHead className="w-[110px] text-right">Amount</TableHead>
                    <TableHead className="w-[80px]">Dr/Cr</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                      No rows yet. Upload a document and click Extract, or click "+ Add row" to enter manually.
                    </TableCell></TableRow>
                  ) : rows.map((r) => (
                    <TableRow key={r._key}>
                      <TableCell>
                        <input type="checkbox" checked={r._selected}
                          onChange={(e) => update(r._key, { _selected: e.target.checked })} />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs" value={r.account_name}
                          onChange={(e) => update(r._key, {
                            account_name: e.target.value,
                            ledger_id: autoMatch(e.target.value),
                          })} />
                      </TableCell>
                      <TableCell>
                        <Select value={r.ledger_id || "__new__"}
                          onValueChange={(v) => update(r._key, { ledger_id: v === "__new__" ? "" : v })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__new__">
                              <span className="text-primary">+ Create new</span>
                            </SelectItem>
                            {ledgers.map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.name} <span className="ml-1 text-[10px] text-muted-foreground">{l.type}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!r.ledger_id && (
                          <Select value={r.new_type}
                            onValueChange={(v) => update(r._key, { new_type: v as LedgerType })}>
                            <SelectTrigger className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {LEDGER_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs text-right" type="number" value={r.amount || ""}
                          onChange={(e) => update(r._key, { amount: parseFloat(e.target.value) || 0 })} />
                      </TableCell>
                      <TableCell>
                        <Select value={r.side} onValueChange={(v) => update(r._key, { side: v as "Dr" | "Cr" })}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Dr">Dr</SelectItem>
                            <SelectItem value="Cr">Cr</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove(r._key)}>
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

        <div className="flex justify-end gap-2">
          <Button onClick={postOpenings} disabled={posting || stats.count === 0 || disabled || Math.abs(stats.diff) >= 0.5 || Math.abs(stats.sourceDiff) >= 0.5 || Math.abs(stats.applicationDiff) >= 0.5}>
            {posting ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Posting…</> : `Post ${stats.count} Opening Balance${stats.count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
