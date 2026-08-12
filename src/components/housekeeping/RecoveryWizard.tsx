// Housekeeping → Recovery Wizard. Two-step surgical rebuild for the case
// where a duplicate / partially-typed re-installation has left the active
// company's balances wrong even after a Merge Companies pass.
//
// Step A — "Restore into New": import a clean pre-reinstall backup as a
// brand new company (no data is lost from the current company).
//
// Step B — "Slice Transfer": pull vouchers dated after a chosen cutoff
// from the current (merged) company into the freshly-restored company,
// skipping any that duplicate existing (date, type, number) rows.
//
// Together this reconstructs a company that (a) matches the last tallied
// backup exactly up to the cutoff and (b) carries only the *new* work
// since — no re-typed February/March duplicates.

import { useCallback, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileUp, ShieldCheck, ArrowRight, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/lib/company-context";
import {
  previewBackupForRestore,
  restoreBackupIntoNewCompany,
  type ParsedBackupPreview,
  type RestoreIntoNewResult,
} from "@/lib/recovery/restore-into-new-company";
import {
  previewDateSliceTransfer,
  runDateSliceTransfer,
  type DateSlicePreview,
  type DateSliceResult,
} from "@/lib/recovery/date-slice-transfer";

interface Props { disabled?: boolean }

export function RecoveryWizard({ disabled }: Props) {
  const { memberships, refresh, setActiveCompanyId } = useCompany();
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Step A state
  const [preview, setPreview] = useState<ParsedBackupPreview | null>(null);
  const [newName, setNewName] = useState<string>("");
  const [restoreResult, setRestoreResult] = useState<RestoreIntoNewResult | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Step B state
  const [sourceId, setSourceId] = useState<string>("");
  const [cutoff, setCutoff] = useState<string>("2026-03-25");
  const [sliceInfo, setSliceInfo] = useState<DateSlicePreview | null>(null);
  const [sliceResult, setSliceResult] = useState<DateSliceResult | null>(null);
  const [slicing, setSlicing] = useState(false);

  const targetId = restoreResult?.newCompanyId ?? null;

  const onPickFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const p = await previewBackupForRestore(text);
      setPreview(p);
      setNewName(`${p.displayName} (Restored)`);
      setRestoreResult(null);
      setSliceInfo(null);
      setSliceResult(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to read backup");
    }
  }, []);

  const runRestore = useCallback(async () => {
    if (!preview) return;
    setRestoring(true);
    try {
      const res = await restoreBackupIntoNewCompany(preview.data, newName);
      setRestoreResult(res);
      await refresh();
      toast.success(`Restored into new company: ${res.displayName}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }, [preview, newName, refresh]);

  const runPreviewSlice = useCallback(async () => {
    if (!sourceId || !targetId) return;
    try {
      const info = await previewDateSliceTransfer(sourceId, targetId, cutoff);
      setSliceInfo(info);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    }
  }, [sourceId, targetId, cutoff]);

  const runSlice = useCallback(async () => {
    if (!sourceId || !targetId) return;
    setSlicing(true);
    try {
      const res = await runDateSliceTransfer(sourceId, targetId, cutoff);
      setSliceResult(res);
      toast.success(`Transferred ${res.transferred} voucher(s) after ${cutoff}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setSlicing(false);
    }
  }, [sourceId, targetId, cutoff]);

  const otherCompanies = useMemo(
    () => memberships.filter((m) => m.company_id !== targetId),
    [memberships, targetId],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Recovery Wizard
        </CardTitle>
        <CardDescription>
          Rebuild a company from a clean pre-reinstall backup and then pull only the genuinely
          new vouchers from the current (possibly duplicated) company. Neither source is
          modified.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Safe by design</AlertTitle>
          <AlertDescription>
            Step 1 creates a brand new company — your current data is untouched. Step 2 only
            reads from the current company and writes into the new one.
          </AlertDescription>
        </Alert>

        {/* Step A */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Step 1</Badge>
            <h3 className="text-sm font-medium">Restore backup into a NEW company</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0])}
            />
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="mr-1 h-4 w-4" /> Choose backup file
            </Button>
            {preview && (
              <span className="text-xs text-muted-foreground">
                {preview.displayName} · {preview.vouchers} vouchers · {preview.ledgers} ledgers
                {preview.exportedAt ? ` · exported ${preview.exportedAt.slice(0, 10)}` : ""}
                {preview.checksumOk === false ? " · ⚠ checksum mismatch" : ""}
              </span>
            )}
          </div>

          {preview && (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <Label htmlFor="new-name">New company name</Label>
                <Input
                  id="new-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Restored company"
                />
              </div>
              <Button
                onClick={runRestore}
                disabled={disabled || restoring || !newName.trim() || Boolean(restoreResult)}
              >
                {restoring ? "Restoring…" : restoreResult ? "Restored" : "Restore into new"}
              </Button>
            </div>
          )}

          {restoreResult && (
            <Alert className="border-emerald-500/40">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertTitle>Restored</AlertTitle>
              <AlertDescription className="space-x-3">
                <span>{restoreResult.displayName}</span>
                <span className="text-muted-foreground">
                  {restoreResult.vouchers} vouchers · {restoreResult.ledgers} ledgers
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveCompanyId(restoreResult.newCompanyId)}
                >
                  Switch to it
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Separator />

        {/* Step B */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Step 2</Badge>
            <h3 className="text-sm font-medium">
              Transfer post-cutoff vouchers from an existing company
            </h3>
          </div>
          {!targetId ? (
            <p className="text-sm text-muted-foreground">
              Complete Step 1 first — the restored company is the transfer target.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
              <div className="sm:col-span-2">
                <Label>Source (current, possibly duplicated)</Label>
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick source company…" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherCompanies.map((m) => (
                      <SelectItem key={m.company_id} value={m.company_id}>
                        {m.companies.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cutoff">Cutoff date (transfers vouchers AFTER)</Label>
                <Input
                  id="cutoff"
                  type="date"
                  value={cutoff}
                  onChange={(e) => setCutoff(e.target.value)}
                />
              </div>
            </div>
          )}

          {targetId && sourceId && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={runPreviewSlice}>
                <ArrowRight className="mr-1 h-4 w-4" /> Preview
              </Button>
              <Button onClick={runSlice} disabled={disabled || slicing || !sliceInfo}>
                {slicing ? "Transferring…" : "Run transfer"}
              </Button>
            </div>
          )}

          {sliceInfo && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Preview — after {sliceInfo.cutoffDate}</AlertTitle>
              <AlertDescription className="space-y-1">
                <div>
                  {sliceInfo.postCutoff} voucher(s) qualify · {sliceInfo.duplicates} already
                  present in target (will be skipped)
                </div>
                <div className="text-xs text-muted-foreground">
                  Will clone {sliceInfo.missingLedgers} missing ledger(s) and
                  {" "}{sliceInfo.missingItems} missing item(s) into the target by matching names.
                </div>
              </AlertDescription>
            </Alert>
          )}

          {sliceResult && (
            <Alert className="border-emerald-500/40">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertTitle>Transfer complete</AlertTitle>
              <AlertDescription>
                {sliceResult.transferred} vouchers transferred ·
                {" "}{sliceResult.entries} entries ·
                {" "}{sliceResult.voucherItems} stock lines ·
                {" "}{sliceResult.billAllocations} bill allocations ·
                {" "}{sliceResult.ledgersCreated} ledgers cloned ·
                {" "}{sliceResult.itemsCreated} items cloned ·
                {" "}{sliceResult.skippedDuplicates} duplicates skipped.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
