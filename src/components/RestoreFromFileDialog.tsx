// Pre-company restore — pick a backup .json file and either:
//   (a) create a NEW company from it (safe default), or
//   (b) overwrite an EXISTING company you select, with a typed-name confirmation.
//
// Scoping invariant: rows are always written under exactly ONE companyId
// (the new one we just created, or the explicit target). The backup file's
// embedded company_id is ignored everywhere; restoreCompanyBackup strips it.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, FilePlus2, Replace, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  parseBackupFile, restoreCompanyBackup, type CompanyBackup,
} from "@/lib/backup";
import { runSemanticChecks } from "@/lib/semantic-checks";
import { savePreRestoreSnapshot } from "@/lib/restore-safety";

interface Membership {
  company_id: string;
  companies: { name: string };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberships: Membership[];
  onDone?: () => void;
}

type Mode = "new" | "overwrite";

export function RestoreFromFileDialog({ open, onOpenChange, memberships, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState<CompanyBackup | null>(null);
  const [sourceName, setSourceName] = useState<string>("");
  const [mode, setMode] = useState<Mode>("new");
  const [newName, setNewName] = useState("");
  const [targetId, setTargetId] = useState<string>("");
  const [confirmText, setConfirmText] = useState("");

  function reset() {
    setBackup(null);
    setSourceName("");
    setMode("new");
    setNewName("");
    setTargetId("");
    setConfirmText("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(file: File) {
    setParsing(true);
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const isArchive =
        (head[0] === 0x50 && head[1] === 0x4b) ||
        (head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72) ||
        (head[0] === 0x37 && head[1] === 0x7a);
      if (isArchive) {
        toast.error("Archive detected. Extract the .json file from the archive first.");
        return;
      }
      const text = await file.text();
      const parsed = await parseBackupFile(text);
      if (parsed.kind !== "single") {
        toast.error("This is a multi-company backup. Open Housekeeping inside a company to restore individual companies from it.");
        return;
      }
      if (parsed.checksumOk === false) {
        toast.warning("Backup checksum mismatch — file may be edited. Proceed carefully.");
      }
      const srcName =
        ((parsed.data.company as { name?: string } | null)?.name) ?? "Unknown company";
      setBackup(parsed.data);
      setSourceName(srcName);
      setNewName(srcName);
    } catch (e) {
      toast.error((e as Error).message || "Could not read backup");
    } finally {
      setParsing(false);
    }
  }

  async function createNewCompanyFrom(b: CompanyBackup, name: string): Promise<string> {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id;
    if (!uid) throw new Error("Not signed in");
    const src = (b.company ?? {}) as Record<string, unknown>;
    // Copy a safe subset; drop ids/timestamps/audit fields.
    const KEEP = [
      "entity_status", "cin", "share_capital_paise", "corpus_fund_paise",
      "gstin", "pan", "state", "state_code", "address", "email", "phone",
      "financial_year_start", "bank_name", "bank_account_no", "bank_ifsc",
      "bank_branch", "logo_url", "gst_registered", "gst_filing_frequency",
      "inventory_enabled", "annual_turnover_paise", "currency_code", "date_format",
    ];
    const payload: Record<string, unknown> = { name };
    for (const k of KEEP) if (src[k] !== undefined) payload[k] = src[k];
    const newId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const insertRow = { id: newId, name, ...payload, created_by: uid };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from("companies").insert(insertRow as any);
    if (error) throw new Error(error.message);
    await supabase.from("company_members").upsert(
      { company_id: newId, user_id: uid, role: "admin" },
      { onConflict: "company_id,user_id", ignoreDuplicates: true },
    );
    return newId;
  }

  async function onRestore() {
    if (!backup) return;
    setBusy(true);
    try {
      let target: string;
      if (mode === "new") {
        const nm = newName.trim();
        if (!nm) { toast.error("Enter a name for the new company"); return; }
        target = await createNewCompanyFrom(backup, nm);
      } else {
        if (!targetId) { toast.error("Pick a target company"); return; }
        const targetName = memberships.find((m) => m.company_id === targetId)?.companies.name ?? "";
        if (confirmText.trim() !== targetName) {
          toast.error(`Type the target name exactly: "${targetName}"`);
          return;
        }
        target = targetId;
        // Rule 5 — pre-restore safety snapshot (24h undo from Housekeeping).
        const snap = await savePreRestoreSnapshot(target, targetName);
        if (!snap.ok) {
          toast.warning("Could not create safety snapshot — proceeding without undo option.");
        }
      }
      const summary = await restoreCompanyBackup(target, backup, { wipeExisting: true });
      const restoredName = mode === "new" ? newName : (memberships.find((m) => m.company_id === target)?.companies.name ?? "");
      toast.success(
        `Restored into "${restoredName}": ` +
        `${summary.ledgers} ledgers, ${summary.items} items, ${summary.vouchers} vouchers`,
      );
      // Post-restore semantic validation — catches partial restores, missing
      // entries, blank-P&L, untallied BS before the user finds out manually.
      try {
        const report = await runSemanticChecks(target);
        if (report.hasError) {
          toast.error(`Restore verified with CRITICAL issues: ${report.summary}`, { duration: 12000 });
        } else if (report.hasWarning) {
          toast.warning(`Restore verified: ${report.summary}`, { duration: 8000 });
        } else {
          toast.success(`Restore verified — ${report.summary}`);
        }
      } catch {
        toast.warning("Restored, but post-restore verification could not run. Open Housekeeping → Verify & Repair.");
      }
      onDone?.();
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error((e as Error).message || "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  const targetName = memberships.find((m) => m.company_id === targetId)?.companies.name ?? "";
  const canRestore =
    !!backup &&
    !busy &&
    (mode === "new"
      ? newName.trim().length > 0
      : !!targetId && confirmText.trim() === targetName);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" /> Restore from backup file
          </DialogTitle>
        </DialogHeader>

        {!backup ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pick a <code>.json</code> backup file produced by{" "}
              <strong>Export full backup</strong>. You'll then choose whether to create a new
              company from it or overwrite an existing one.
            </p>
            <Input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
              disabled={parsing}
            />
            {parsing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-2 text-xs">
              <div><strong>Source company:</strong> {sourceName}</div>
              <div className="text-muted-foreground">
                {backup.ledgers.length} ledgers · {backup.items.length} items ·{" "}
                {backup.vouchers.length} vouchers
              </div>
            </div>

            <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <div className="flex items-start gap-2 rounded-md border p-2">
                <RadioGroupItem value="new" id="mode-new" className="mt-1" />
                <Label htmlFor="mode-new" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-1.5 font-medium">
                    <FilePlus2 className="h-3.5 w-3.5" /> Create a NEW company (safe)
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    No existing data is touched. Recommended after a fresh install.
                  </div>
                </Label>
              </div>
              <div className="flex items-start gap-2 rounded-md border p-2">
                <RadioGroupItem value="overwrite" id="mode-over" className="mt-1" />
                <Label htmlFor="mode-over" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Replace className="h-3.5 w-3.5" /> Overwrite an EXISTING company
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Wipes the chosen company's ledgers/items/vouchers, then restores from the file.
                  </div>
                </Label>
              </div>
            </RadioGroup>

            {mode === "new" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">New company name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Target company to overwrite</Label>
                  <Select value={targetId} onValueChange={setTargetId}>
                    <SelectTrigger><SelectValue placeholder="Choose target…" /></SelectTrigger>
                    <SelectContent>
                      {memberships.map((m) => (
                        <SelectItem key={m.company_id} value={m.company_id}>
                          {m.companies.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {targetId && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-destructive shrink-0" />
                      <div className="flex-1">
                        This will permanently delete all current data in{" "}
                        <strong>{targetName}</strong> and replace it with{" "}
                        <strong>{sourceName}</strong>. Type{" "}
                        <code>{targetName}</code> below to confirm.
                      </div>
                    </div>
                    <Input
                      className="mt-2"
                      placeholder={`Type "${targetName}"`}
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }} disabled={busy}>
            Cancel
          </Button>
          {backup && (
            <Button onClick={onRestore} disabled={!canRestore}>
              {busy
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Restoring…</>
                : <>Restore</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
