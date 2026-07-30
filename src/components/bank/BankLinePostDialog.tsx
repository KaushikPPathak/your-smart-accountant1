// Post an unmatched bank statement line straight into the books as a
// Receipt (money in) or Payment (money out) against any ledger — existing or
// newly created inline. Bank statements rarely carry the real party name, so
// the user picks/creates the counter-account here.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Combo, type ComboOption } from "@/components/vouchers/Combo";
import { QuickLedgerDialog } from "@/components/vouchers/QuickLedgerDialog";
import { readLedgers } from "@/lib/offline/cache-read";
import { runEntryVoucherCreate } from "@/lib/offline/voucher-executors";
import { formatINR } from "@/lib/money";
import { fmtIndianDate } from "@/lib/format-date";
import type { LocalBankLine } from "@/lib/bank/local-store";
import { rememberDescriptionLedger, suggestLedgerForDescription } from "@/lib/bank/local-store";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  bankLedgerId: string;
  bankLedgerName: string;
  line: LocalBankLine | null;
  onPosted: (line: LocalBankLine) => void;
}

export function BankLinePostDialog({
  open, onOpenChange, companyId, bankLedgerId, bankLedgerName, line, onPosted,
}: Props) {
  const [ledgers, setLedgers] = useState<ComboOption[]>([]);
  const [ledgerId, setLedgerId] = useState("");
  const [narration, setNarration] = useState("");
  const [refNo, setRefNo] = useState("");
  const [remember, setRemember] = useState(true);
  const [posting, setPosting] = useState(false);
  const [newLedgerOpen, setNewLedgerOpen] = useState(false);
  const [newLedgerSeed, setNewLedgerSeed] = useState("");

  const isMoneyIn = !!line && line.credit_paise > 0;
  const amount = line ? (isMoneyIn ? line.credit_paise : line.debit_paise) : 0;
  const voucherType: "receipt" | "payment" = isMoneyIn ? "receipt" : "payment";

  const loadLedgers = async () => {
    if (!companyId) return;
    const rows = (await readLedgers(companyId)) as any[];
    setLedgers(
      rows
        .filter((l) => !l.is_deleted && String(l.id) !== bankLedgerId)
        .map((l) => ({ value: String(l.id), label: String(l.name), hint: String(l.type || "") }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    );
  };

  useEffect(() => {
    if (!open || !line) return;
    void loadLedgers();
    setNarration(line.description || "");
    setRefNo(line.reference || "");
    setRemember(true);
    setLedgerId(suggestLedgerForDescription(companyId, line.description) || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, line?.id]);

  const summary = useMemo(() => {
    if (!line) return null;
    return isMoneyIn
      ? `Dr ${bankLedgerName} · Cr selected ledger`
      : `Dr selected ledger · Cr ${bankLedgerName}`;
  }, [line, isMoneyIn, bankLedgerName]);

  async function post() {
    if (!line) return;
    if (!ledgerId) { toast.error("Select or create the account to post against"); return; }
    if (!amount) { toast.error("This line has no amount"); return; }
    setPosting(true);
    try {
      await runEntryVoucherCreate({
        companyId,
        voucherType,
        voucherDate: line.txn_date,
        partyLedgerId: ledgerId,
        refNo: refNo || "",
        narration: narration || "",
        total: amount,
        entries: isMoneyIn
          ? [
              { ledger_id: bankLedgerId, debit_paise: amount, credit_paise: 0, narration: narration || null, line_no: 1 },
              { ledger_id: ledgerId, debit_paise: 0, credit_paise: amount, narration: narration || null, line_no: 2 },
            ]
          : [
              { ledger_id: ledgerId, debit_paise: amount, credit_paise: 0, narration: narration || null, line_no: 1 },
              { ledger_id: bankLedgerId, debit_paise: 0, credit_paise: amount, narration: narration || null, line_no: 2 },
            ],
      });
      if (remember) rememberDescriptionLedger(companyId, line.description, ledgerId);
      toast.success(`${voucherType === "receipt" ? "Receipt" : "Payment"} posted · ${formatINR(amount)}`);
      onPosted(line);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || "Posting failed");
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Post to books — {voucherType === "receipt" ? "Receipt" : "Payment"}
            </DialogTitle>
          </DialogHeader>

          {line && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
                <div className="flex justify-between gap-3">
                  <span className="font-mono">{fmtIndianDate(line.txn_date)}</span>
                  <span className="font-mono font-semibold">{formatINR(amount)}</span>
                </div>
                <div className="text-muted-foreground break-words">{line.description}</div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{isMoneyIn ? "Money in" : "Money out"}</Badge>
                  <span className="text-muted-foreground">{summary}</span>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Account (party / income / expense)</Label>
                <Combo
                  value={ledgerId}
                  onChange={setLedgerId}
                  options={ledgers}
                  placeholder="Search ledger…"
                  createLabel="Create new ledger"
                  onCreate={(typed) => { setNewLedgerSeed(typed); setNewLedgerOpen(true); }}
                />
                <p className="text-[11px] text-muted-foreground">
                  Not listed? Use “Create new ledger” (Alt+C) to open the account now.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Reference</Label>
                  <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Narration</Label>
                  <Input value={narration} onChange={(e) => setNarration(e.target.value)} className="h-9" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
                Remember this description for future imports (auto-pick this ledger)
              </label>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={post} disabled={posting || !ledgerId}>
              {posting ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Posting…</> : "Post entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickLedgerDialog
        open={newLedgerOpen}
        onOpenChange={setNewLedgerOpen}
        companyId={companyId}
        onSaved={async (l) => {
          await loadLedgers();
          setLedgerId(l.id);
          setNewLedgerOpen(false);
        }}
      />
      {/* seed kept for future prefill support */}
      <span className="hidden">{newLedgerSeed}</span>
    </>
  );
}
