// Field-integrity audit: read-only enumeration of invariants that
// might be violated in the local Dexie cache. Gives an honest count
// of "how many rows have a suspicious value" so the user knows
// whether a rebuild is warranted, without any auto-mutation.

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, HardDriveDownload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { offlineDb } from "@/lib/offline/db";
import { checkCanRebuild, rebuildCompanyCache } from "@/lib/offline/cache-rebuild";
import { getStoredSchemaVersion, SCHEMA_VERSION } from "@/lib/offline/schema-version";

interface Issue {
  table: string;
  issue: string;
  count: number;
}

async function auditCompany(companyId: string): Promise<Issue[]> {
  const [companies, ledgers, items, vouchers, entries, allocations] = await Promise.all([
    offlineDb.cache_companies.filter((r: any) => r?.id === companyId).toArray().catch(() => []),
    offlineDb.cache_ledgers.where("company_id").equals(companyId).toArray().catch(() => []),
    offlineDb.cache_items.where("company_id").equals(companyId).toArray().catch(() => []),
    offlineDb.cache_vouchers.where("company_id").equals(companyId).toArray().catch(() => []),
    offlineDb.cache_voucher_entries.where("company_id").equals(companyId).toArray().catch(() => []),
    offlineDb.cache_bill_allocations.where("company_id").equals(companyId).toArray().catch(() => []),
  ]);

  const voucherIds = new Set((vouchers as any[]).map((v) => String(v.id)));
  const activeLedgerIds = new Set((ledgers as any[]).filter((l) => l?.is_deleted !== true).map((l) => String(l.id)));

  const issues: Issue[] = [
    {
      table: "Companies",
      issue: "gst_registered=false but GSTIN present",
      count: (companies as any[]).filter((c) => c?.gstin && !c?.gst_registered).length,
    },
    {
      table: "Companies",
      issue: "missing state_code",
      count: (companies as any[]).filter((c) => !c?.state_code).length,
    },
    {
      table: "Companies",
      issue: "missing financial_year_start",
      count: (companies as any[]).filter((c) => !c?.financial_year_start).length,
    },
    {
      table: "Ledgers",
      issue: "missing group_id",
      count: (ledgers as any[]).filter((l) => !l?.group_id).length,
    },
    {
      table: "Ledgers",
      issue: "GSTIN present but no gst_treatment",
      count: (ledgers as any[]).filter((l) => l?.gstin && !l?.gst_treatment).length,
    },
    {
      table: "Items",
      issue: "missing hsn_code",
      count: (items as any[]).filter((i) => i?.is_deleted !== true && !i?.hsn_code).length,
    },
    {
      table: "Items",
      issue: "gst_rate is null/undefined",
      count: (items as any[]).filter((i) => i?.is_deleted !== true && i?.gst_rate == null).length,
    },
    {
      table: "Vouchers",
      issue: "without any voucher_entries",
      count: (vouchers as any[]).filter((v) => v?.is_deleted !== true && !(entries as any[]).some((e) => String(e.voucher_id) === String(v.id))).length,
    },
    {
      table: "Voucher entries",
      issue: "reference deleted/unknown ledger",
      count: (entries as any[]).filter((e) => e?.ledger_id && !activeLedgerIds.has(String(e.ledger_id))).length,
    },
    {
      table: "Bill allocations",
      issue: "orphaned (invoice voucher missing)",
      count: (allocations as any[]).filter((a) => a?.invoice_voucher_id && !voucherIds.has(String(a.invoice_voucher_id))).length,
    },
  ];
  return issues;
}

export function FieldIntegrityPanel({ companyId }: { companyId: string | null | undefined }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [storedVersion, setStoredVersion] = useState<number>(SCHEMA_VERSION);

  const refresh = useCallback(async () => {
    if (!companyId) { setIssues([]); return; }
    setBusy(true);
    try {
      const [rows, v] = await Promise.all([auditCompany(companyId), getStoredSchemaVersion()]);
      setIssues(rows);
      setStoredVersion(v);
    } finally { setBusy(false); }
  }, [companyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onRebuild = async () => {
    if (!companyId) return;
    const guard = await checkCanRebuild(companyId);
    if (!guard.ok) { toast.error(guard.reason); return; }
    if (!confirm("Rebuild this company's local cache from the server? Unsynced changes stay in the outbox; only cached read data is refreshed.")) return;
    setRebuilding(true);
    try {
      const res = await rebuildCompanyCache(companyId);
      toast.success(`Rebuilt cache: cleared ${res.cleared} row(s), refetched ${res.fetchedTables} table(s).`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rebuild failed");
    } finally { setRebuilding(false); }
  };

  const totalIssues = (issues ?? []).reduce((s, i) => s + i.count, 0);
  const schemaStale = storedVersion < SCHEMA_VERSION;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            {totalIssues === 0 && !schemaStale ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            )}
            Field integrity
            {schemaStale && (
              <Badge variant="outline" className="ml-2">
                Schema v{storedVersion} &lt; v{SCHEMA_VERSION} — rebuild recommended
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={busy || !companyId}>
              <RefreshCw className={`h-4 w-4 mr-1 ${busy ? "animate-spin" : ""}`} />
              Refresh audit
            </Button>
            <Button variant="outline" size="sm" onClick={onRebuild} disabled={rebuilding || !companyId}>
              <HardDriveDownload className={`h-4 w-4 mr-1 ${rebuilding ? "animate-pulse" : ""}`} />
              Rebuild from server
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!companyId ? (
          <p className="text-sm text-muted-foreground">Pick a company to run the audit.</p>
        ) : issues && issues.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Table</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="w-[80px] text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((i, idx) => (
                <TableRow key={idx} className={i.count === 0 ? "text-muted-foreground" : ""}>
                  <TableCell>{i.table}</TableCell>
                  <TableCell>{i.issue}</TableCell>
                  <TableCell className="text-right font-mono">{i.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">Running audit…</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Audits are read-only. Zero counts across the board plus a current schema version mean the local cache is in sync with the app's expectations.
        </p>
      </CardContent>
    </Card>
  );
}
