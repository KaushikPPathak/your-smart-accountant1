// Housekeeping → Merge Companies. Recovery tool for duplicate local
// company rows created by fresh installs. See src/lib/merge-companies.ts.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Merge, RefreshCw, ShieldCheck, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  findDuplicateCompanyGroups, buildMergePreview, mergeCompanies,
  type DuplicateGroup, type CompanyStat, type MergePreview,
} from "@/lib/merge-companies";

interface Props { disabled?: boolean }

export function MergeCompaniesTool({ disabled }: Props) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [selected, setSelected] = useState<{ keepId: string; fromId: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [merging, setMerging] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const g = await findDuplicateCompanyGroups();
      setGroups(g);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to scan companies");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const pickPair = async (keep: CompanyStat, from: CompanyStat) => {
    setSelected({ keepId: keep.id, fromId: from.id });
    try {
      const p = await buildMergePreview(keep.id, from.id);
      setPreview(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
      setPreview(null);
    }
  };

  const swap = async () => {
    if (!selected) return;
    await pickPair(
      { id: selected.fromId } as CompanyStat,
      { id: selected.keepId } as CompanyStat,
    );
    setSelected({ keepId: selected.fromId, fromId: selected.keepId });
  };

  const doMerge = async () => {
    if (!preview) return;
    setMerging(true);
    try {
      const res = await mergeCompanies(preview.keep.id, preview.from.id);
      const okSnaps = res.safetySnapshots.filter((s) => s.path).length;
      toast.success(
        `Merged: moved ${res.vouchersMoved} vouchers, ${res.entriesMoved} postings, ${res.itemsMoved} inventory lines. ` +
        `Ledgers: ${res.ledgersRemapped} matched, ${res.ledgersReparented} re-parented. ` +
        `Safety snapshots on disk: ${okSnaps}/2.`,
        { duration: 8000 },
      );
      if (okSnaps < 2) {
        toast.warning("One or both safety snapshots could NOT be written to disk. Merge itself succeeded, but check %LOCALAPPDATA%\\com.smartaccountant.app\\snapshots\\ and take a manual backup now.");
      }
      setPreview(null);
      setSelected(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setMerging(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Recovery tool — read carefully
          </CardTitle>
          <CardDescription className="text-foreground/80">
            Use this only when two local company rows represent the <b>same real company</b>
            (typically caused by a fresh install after a lost profile). It moves every voucher,
            posting, ledger and item from the <b>Merge from</b> side into the <b>Keep</b> side and
            then deletes the empty duplicate. Before touching anything, a full JSON safety snapshot
            of <em>both</em> sides is written to
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">%LOCALAPPDATA%\com.smartaccountant.app\snapshots\&lt;today&gt;\</code>
            so the operation is reversible.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {loading ? "Scanning…" : groups && groups.length === 0
            ? "No duplicate company names found — nothing to merge."
            : `${groups?.length ?? 0} duplicate group(s) found.`}
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading || disabled}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Rescan
        </Button>
      </div>

      {groups?.map((g) => (
        <Card key={g.normalisedName}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{g.companies[0]?.name ?? g.normalisedName}</CardTitle>
            <CardDescription>{g.companies.length} rows share this name — pick a keep + merge-from pair.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company id</TableHead>
                  <TableHead className="text-right">Ledgers</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Vouchers</TableHead>
                  <TableHead>Date range</TableHead>
                  <TableHead className="w-[220px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.id.slice(0, 8)}…</TableCell>
                    <TableCell className="text-right">{c.ledgers}</TableCell>
                    <TableCell className="text-right">{c.items}</TableCell>
                    <TableCell className="text-right font-medium">{c.vouchers}</TableCell>
                    <TableCell className="text-xs">
                      {c.earliestVoucherDate ?? "—"} → {c.latestVoucherDate ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {g.companies.filter((o) => o.id !== c.id).map((o) => (
                          <Button
                            key={o.id}
                            variant={selected?.keepId === c.id && selected?.fromId === o.id ? "default" : "outline"}
                            size="sm"
                            disabled={disabled}
                            onClick={() => pickPair(c, o)}
                          >
                            Keep this, merge {o.id.slice(0, 6)}…
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {preview && (
        <Card className="border-primary">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Merge className="h-4 w-4" /> Merge preview
            </CardTitle>
            <CardDescription>Review carefully. Nothing is written until you press Merge.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <SideSummary label="KEEP (survivor)" side={preview.keep} tone="keep" />
              <SideSummary label="MERGE FROM (deleted after move)" side={preview.from} tone="from" />
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">{preview.vouchersToMove} vouchers will be moved</Badge>
              <Badge variant="outline">
                Ledgers: {preview.ledgerMerges.filter((m) => m.keepId).length} matched by name,{" "}
                {preview.ledgerMerges.filter((m) => !m.keepId).length} re-parented
              </Badge>
              <Badge variant="outline">
                Items: {preview.itemMerges.filter((m) => m.keepId).length} matched,{" "}
                {preview.itemMerges.filter((m) => !m.keepId).length} re-parented
              </Badge>
            </div>

            {preview.ledgerMerges.some((m) => m.keepId) && (
              <details className="rounded border p-2 text-xs">
                <summary className="cursor-pointer font-medium">Ledger name matches ({preview.ledgerMerges.filter((m) => m.keepId).length})</summary>
                <ul className="mt-2 space-y-1">
                  {preview.ledgerMerges.filter((m) => m.keepId).map((m) => (
                    <li key={m.fromId}>{m.fromName} → keep <b>{m.keepName}</b></li>
                  ))}
                </ul>
              </details>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={swap} disabled={merging || disabled}>
                <ArrowRight className="mr-1 h-4 w-4" /> Swap keep / merge-from
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={merging || disabled}>
                <Merge className="mr-1 h-4 w-4" /> Merge now
              </Button>
              <Button variant="ghost" onClick={() => { setPreview(null); setSelected(null); }} disabled={merging}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge these two companies?</AlertDialogTitle>
            <AlertDialogDescription>
              A JSON snapshot of BOTH sides is written to
              <code className="mx-1 rounded bg-muted px-1 text-xs">%LOCALAPPDATA%\com.smartaccountant.app\snapshots\&lt;today&gt;\</code>
              before any change. If anything looks wrong afterwards, restore either file from Backup / Restore.
              This action moves every voucher, posting, ledger and item from the "merge from" side into the "keep" side,
              then deletes the empty duplicate. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doMerge} disabled={merging}>
              {merging ? "Merging…" : "Merge and take safety snapshots"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SideSummary({ label, side, tone }: { label: string; side: CompanyStat; tone: "keep" | "from" }) {
  const border = tone === "keep" ? "border-green-500" : "border-amber-500";
  return (
    <div className={`rounded-md border ${border} p-3`}>
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {tone === "keep" ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />} {label}
      </div>
      <div className="text-sm font-medium">{side.name}</div>
      <div className="mt-1 font-mono text-xs text-muted-foreground">{side.id}</div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
        <Stat k="L" v={side.ledgers} />
        <Stat k="I" v={side.items} />
        <Stat k="V" v={side.vouchers} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Range: {side.earliestVoucherDate ?? "—"} → {side.latestVoucherDate ?? "—"}
      </div>
      {side.monthly.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer">Monthly voucher counts</summary>
          <table className="mt-1 w-full">
            <tbody>
              {side.monthly.map((m) => (
                <tr key={m.month}><td className="pr-2">{m.month}</td><td className="text-right font-mono">{m.count}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div className="rounded bg-muted px-2 py-1 font-mono">
      <span className="text-muted-foreground">{k}</span> <span className="font-semibold">{v}</span>
    </div>
  );
}
