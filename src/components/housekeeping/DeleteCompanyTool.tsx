// Housekeeping → Delete Company.
//
// After the Recovery Wizard produces a clean restored copy, the user
// often wants to remove the older duplicate company that shipped with the
// reinstall. This tool safely purges a single local company along with
// every row that belongs to it (vouchers, entries, ledgers, items, and
// all satellite caches). A pre-delete safety backup is written to disk
// on desktop first so nothing is truly lost.
//
// Guardrails:
//   • Cannot delete the currently active company (switch first).
//   • User must type the exact company name to confirm.
//   • Preview shows row counts before the destructive action.

import { useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/lib/company-context";
import {
  previewCompanyPurge,
  purgeCompany,
  type PurgePreview,
  type PurgeResult,
} from "@/lib/recovery/purge-company";

interface Props { disabled?: boolean }

export function DeleteCompanyTool({ disabled }: Props) {
  const { memberships, activeCompanyId, refresh } = useCompany();
  const [targetId, setTargetId] = useState<string>("");
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PurgeResult | null>(null);

  const options = useMemo(
    () => memberships.filter((m) => m.company_id !== activeCompanyId),
    [memberships, activeCompanyId],
  );

  const runPreview = useCallback(async (id: string) => {
    setTargetId(id);
    setPreview(null);
    setResult(null);
    setConfirmName("");
    if (!id) return;
    try {
      const p = await previewCompanyPurge(id);
      setPreview(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    }
  }, []);

  const runDelete = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await purgeCompany(preview.companyId);
      setResult(r);
      await refresh();
      toast.success(`Deleted "${r.companyName}" — ${r.rowsDeleted} rows removed`);
      setPreview(null);
      setTargetId("");
      setConfirmName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }, [preview, refresh]);

  const nameMatches =
    !!preview && confirmName.trim().toLowerCase() === preview.companyName.trim().toLowerCase();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-destructive" /> Delete Company
        </CardTitle>
        <CardDescription>
          Permanently removes a local company and every voucher, ledger, item and setting that
          belongs to it. A pre-delete safety backup is written to disk first (desktop).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Safety first</AlertTitle>
          <AlertDescription>
            You cannot delete the <strong>currently active</strong> company — switch to the one you
            want to keep first, then come back here.
          </AlertDescription>
        </Alert>

        <div className="grid gap-2 sm:max-w-md">
          <Label>Company to delete</Label>
          <Select value={targetId} onValueChange={runPreview} disabled={disabled || busy}>
            <SelectTrigger>
              <SelectValue placeholder={options.length ? "Pick a company…" : "No other companies"} />
            </SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m.company_id} value={m.company_id}>
                  {m.companies.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {preview && (
          <>
            <Separator />
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This will permanently remove</AlertTitle>
              <AlertDescription className="space-y-1">
                <div>
                  <strong>{preview.companyName}</strong> — {preview.vouchers} vouchers ·
                  {" "}{preview.entries} entries · {preview.ledgers} ledgers ·
                  {" "}{preview.items} items · {preview.rowsTotal} rows across{" "}
                  {preview.perTable.length} table(s).
                </div>
                <div className="text-xs opacity-80">
                  Type the company name exactly to enable the Delete button.
                </div>
              </AlertDescription>
            </Alert>

            <div className="grid gap-2 sm:max-w-md">
              <Label htmlFor="confirm-name">
                Confirm by typing: <span className="font-mono">{preview.companyName}</span>
              </Label>
              <Input
                id="confirm-name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={preview.companyName}
              />
            </div>

            <div className="flex justify-end">
              <Button
                variant="destructive"
                disabled={disabled || busy || !nameMatches}
                onClick={() => setConfirmOpen(true)}
              >
                {busy ? "Deleting…" : "Delete company permanently"}
              </Button>
            </div>
          </>
        )}

        {result && (
          <Alert className="border-emerald-500/40">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Deleted</AlertTitle>
            <AlertDescription>
              Removed <strong>{result.companyName}</strong> ({result.rowsDeleted} rows).{" "}
              {result.safetyBackup.path
                ? `Safety backup: ${result.safetyBackup.path}`
                : result.safetyBackup.error
                  ? `Safety backup skipped (${result.safetyBackup.error})`
                  : ""}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {preview?.companyName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {preview?.rowsTotal ?? 0} rows across all local tables. A safety backup
              is written first, but there is no in-app undo. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
