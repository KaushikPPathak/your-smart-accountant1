// Backup & Restore utilities — JSON snapshot per-company or all-companies.
// In Electron desktop builds, files are also written to C:\YourMehtaji\<Company>\backups\.
import { supabase } from "@/integrations/supabase/client";
import { wrapBackup, isBackupEnvelope, verifyEnvelope } from "@/lib/backup-policy";
import { isLocalOnlyMode } from "@/lib/local-only-mode";

// ---------- Types ----------
// Schema v2 (Round-1 completeness upgrade): adds 14 previously-uncaptured
// collections so backups round-trip 100% of company data — e-invoicing,
// period locks, BOMs, tax templates, bill sundries, transport, cost
// centres, custom voucher series, account-group overrides.
//
// Backwards-compatibility: readers accept v1 files verbatim — missing
// collections are treated as empty arrays. Writers always emit v2.
export interface CompanyBackup {
  schema_version: 1 | 2;
  exported_at: string;
  company: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  ledgers: Record<string, unknown>[];
  items: Record<string, unknown>[];
  vouchers: Record<string, unknown>[];
  voucher_items: Record<string, unknown>[];
  voucher_entries: Record<string, unknown>[];
  bill_allocations: Record<string, unknown>[];
  recurring_invoices: Record<string, unknown>[];
  // ---- v2 additions (all optional so v1 backups still parse) ----
  account_subgroups?: Record<string, unknown>[];
  ledger_group_mappings?: Record<string, unknown>[];
  account_group_overrides?: Record<string, unknown>[];
  voucher_export_details?: Record<string, unknown>[];
  einvoice_details?: Record<string, unknown>[];
  period_locks?: Record<string, unknown>[];
  bom_templates?: Record<string, unknown>[];
  bom_template_lines?: Record<string, unknown>[];
  voucher_series?: Record<string, unknown>[];
  tax_templates?: Record<string, unknown>[];
  bill_sundries?: Record<string, unknown>[];
  transport_details?: Record<string, unknown>[];
  cost_centres?: Record<string, unknown>[];
  cost_categories?: Record<string, unknown>[];
}

export interface MultiCompanyBackup {
  schema_version: 1 | 2;
  kind: "all_companies";
  exported_at: string;
  companies: CompanyBackup[];
}

// ---------- Native desktop bridge (Electron or Tauri) ----------
import { isDesktopRuntime, saveCompanyFileNative, writeAbsoluteFileNative } from "./native-bridge";
import { getBackupFolder } from "./backup-location";

// ---------- Helpers ----------
function safeName(s: string | null | undefined): string {
  return (s ?? "company").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "company";
}

function browserDownload(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Export ----------

// Local-only build: read the entire company from IndexedDB. Cloud tables
// are empty (or stale) in local-only mode — reading them would produce a
// silent zero-row backup that would then break auto-snapshot's integrity
// manifest and disable auto-restore. See Bug 1.1 audit.
async function buildCompanyBackupFromLocal(companyId: string): Promise<CompanyBackup> {
  const { offlineDb: db } = await import("./offline/db");
  const byCompany = <T>(table: { where: (i: string) => { equals: (v: string) => { toArray: () => Promise<T[]> } } }) =>
    table.where("company_id").equals(companyId).toArray().catch(() => [] as T[]);

  const [
    company, settings,
    ledgers, items,
    vouchers, voucher_entries, voucher_items, bill_allocations, recurring_invoices,
    account_subgroups, ledger_group_mappings, account_group_overrides,
    voucher_export_details, einvoice_details, period_locks,
    bom_templates, bom_template_lines,
    voucher_series, tax_templates, bill_sundries, transport_details,
    cost_centres, cost_categories,
  ] = await Promise.all([
    db.cache_companies.get(companyId).catch(() => null),
    db.cache_company_settings.where("company_id").equals(companyId).first().catch(() => null),
    byCompany<Record<string, unknown>>(db.cache_ledgers),
    byCompany<Record<string, unknown>>(db.cache_items),
    byCompany<Record<string, unknown>>(db.cache_vouchers),
    byCompany<Record<string, unknown>>(db.cache_voucher_entries),
    byCompany<Record<string, unknown>>(db.cache_voucher_items),
    byCompany<Record<string, unknown>>(db.cache_bill_allocations),
    byCompany<Record<string, unknown>>(db.cache_recurring_invoices),
    byCompany<Record<string, unknown>>(db.cache_account_subgroups),
    byCompany<Record<string, unknown>>(db.cache_ledger_group_mappings),
    byCompany<Record<string, unknown>>(db.cache_account_group_overrides),
    byCompany<Record<string, unknown>>(db.cache_voucher_export_details),
    byCompany<Record<string, unknown>>(db.cache_einvoice_details),
    byCompany<Record<string, unknown>>(db.cache_period_locks),
    byCompany<Record<string, unknown>>(db.cache_bom_templates),
    byCompany<Record<string, unknown>>(db.cache_bom_template_lines),
    byCompany<Record<string, unknown>>(db.cache_voucher_series),
    byCompany<Record<string, unknown>>(db.cache_tax_templates),
    byCompany<Record<string, unknown>>(db.cache_bill_sundries),
    byCompany<Record<string, unknown>>(db.cache_transport_details),
    byCompany<Record<string, unknown>>(db.cache_cost_centres),
    byCompany<Record<string, unknown>>(db.cache_cost_categories),
  ]);
  return {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    company: (company as Record<string, unknown> | null) ?? null,
    settings: (settings as Record<string, unknown> | null) ?? null,
    ledgers, items, vouchers, voucher_entries, voucher_items, bill_allocations, recurring_invoices,
    account_subgroups, ledger_group_mappings, account_group_overrides,
    voucher_export_details, einvoice_details, period_locks,
    bom_templates, bom_template_lines,
    voucher_series, tax_templates, bill_sundries, transport_details,
    cost_centres, cost_categories,
  };
}

export async function buildCompanyBackup(companyId: string): Promise<CompanyBackup> {
  // In local-only mode the cloud tables are not authoritative — the device
  // IndexedDB is. Read from there so exports, mirrors and auto-snapshots
  // capture the real data instead of writing empty envelopes.
  if (isLocalOnlyMode() && typeof indexedDB !== "undefined") {
    return buildCompanyBackupFromLocal(companyId);
  }

  const [c, s, l, i, v, vi, ve, ba, ri] = await Promise.all([
    supabase.from("companies").select("*").eq("id", companyId).single(),
    supabase.from("company_settings").select("*").eq("company_id", companyId).maybeSingle(),
    supabase.from("ledgers").select("*").eq("company_id", companyId),
    supabase.from("items").select("*").eq("company_id", companyId),
    supabase.from("vouchers").select("*").eq("company_id", companyId),
    supabase
      .from("voucher_items")
      .select("*, vouchers!inner(company_id)")
      .eq("vouchers.company_id", companyId),
    supabase
      .from("voucher_entries")
      .select("*, vouchers!inner(company_id)")
      .eq("vouchers.company_id", companyId),
    supabase.from("bill_allocations").select("*").eq("company_id", companyId),
    supabase.from("recurring_invoices").select("*").eq("company_id", companyId),
  ]);
  const strip = <T extends Record<string, unknown>>(rows: T[] | null) =>
    (rows ?? []).map(({ vouchers: _v, ...rest }) => rest as Record<string, unknown>);

  // Cloud path also augments with the local-only tables (BOM, cost centres,
  // period locks, etc.) so a cloud-mode backup is a full superset of the
  // company's actual state, matching the local-only path's completeness.
  const localExtras = (typeof indexedDB !== "undefined")
    ? await buildCompanyBackupFromLocal(companyId).catch(() => null)
    : null;

  return {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    company: (c.data as Record<string, unknown> | null) ?? null,
    settings: (s.data as Record<string, unknown> | null) ?? null,
    ledgers: (l.data as Record<string, unknown>[] | null) ?? [],
    items: (i.data as Record<string, unknown>[] | null) ?? [],
    vouchers: (v.data as Record<string, unknown>[] | null) ?? [],
    voucher_items: strip(vi.data as Record<string, unknown>[] | null),
    voucher_entries: strip(ve.data as Record<string, unknown>[] | null),
    bill_allocations: (ba.data as Record<string, unknown>[] | null) ?? [],
    recurring_invoices: (ri.data as Record<string, unknown>[] | null) ?? [],
    account_subgroups: localExtras?.account_subgroups ?? [],
    ledger_group_mappings: localExtras?.ledger_group_mappings ?? [],
    account_group_overrides: localExtras?.account_group_overrides ?? [],
    voucher_export_details: localExtras?.voucher_export_details ?? [],
    einvoice_details: localExtras?.einvoice_details ?? [],
    period_locks: localExtras?.period_locks ?? [],
    bom_templates: localExtras?.bom_templates ?? [],
    bom_template_lines: localExtras?.bom_template_lines ?? [],
    voucher_series: localExtras?.voucher_series ?? [],
    tax_templates: localExtras?.tax_templates ?? [],
    bill_sundries: localExtras?.bill_sundries ?? [],
    transport_details: localExtras?.transport_details ?? [],
    cost_centres: localExtras?.cost_centres ?? [],
    cost_categories: localExtras?.cost_categories ?? [],
  };
}

export interface SaveResult {
  fileName: string;
  desktopPath?: string;
}

export async function exportCompanyBackup(
  companyId: string,
  companyName: string,
): Promise<SaveResult> {
  const payload = await buildCompanyBackup(companyId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `${safeName(companyName)}_backup_${stamp}.json`;
  const envelope = await wrapBackup(payload);
  const contents = JSON.stringify(envelope, null, 2);

  if (isDesktopRuntime()) {
    const chosen = getBackupFolder(companyId);
    if (chosen) {
      const base = `${chosen.replace(/[\\/]+$/, "")}/${safeName(companyName)}`;
      const res = await writeAbsoluteFileNative(base, "backups", fileName, contents);
      if (res.ok) return { fileName, desktopPath: res.path };
    } else {
      const res = await saveCompanyFileNative(companyName, "backups", fileName, contents);
      if (res.ok) return { fileName, desktopPath: res.path };
    }
  }
  browserDownload(fileName, contents);
  return { fileName };
}

export async function exportAllCompaniesBackup(
  companies: { id: string; name: string }[],
): Promise<SaveResult> {
  const all: CompanyBackup[] = [];
  for (const c of companies) {
    all.push(await buildCompanyBackup(c.id));
  }
  const payload: MultiCompanyBackup = {
    schema_version: 2,
    kind: "all_companies",
    exported_at: new Date().toISOString(),
    companies: all,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `YourMehtaji_AllCompanies_${stamp}.json`;
  const envelope = await wrapBackup(payload);
  const contents = JSON.stringify(envelope, null, 2);

  if (isDesktopRuntime()) {
    const res = await saveCompanyFileNative("_AllCompanies", "backups", fileName, contents);
    if (res.ok) return { fileName, desktopPath: res.path };
  }
  browserDownload(fileName, contents);
  return { fileName };
}

// ---------- Restore ----------
export interface RestoreSummary {
  companyId: string;
  ledgers: number;
  items: number;
  vouchers: number;
  voucher_items: number;
  voucher_entries: number;
  bill_allocations: number;
  recurring_invoices: number;
  // v2 additions — silently 0 for v1 backups.
  account_subgroups?: number;
  ledger_group_mappings?: number;
  account_group_overrides?: number;
  voucher_export_details?: number;
  einvoice_details?: number;
  period_locks?: number;
  bom_templates?: number;
  bom_template_lines?: number;
  voucher_series?: number;
  tax_templates?: number;
  bill_sundries?: number;
  transport_details?: number;
  cost_centres?: number;
  cost_categories?: number;
}

/**
 * Restore one company backup INTO an existing target company.
 * - Maps source ledger/item/voucher IDs -> new IDs.
 * - Does NOT touch the target company's settings or member list.
 * - Skips rows that fail (e.g. duplicate voucher numbers).
 */
// Current schema version this build writes. Older backups (v1) are accepted
// verbatim — v2-only collections default to empty and are not wiped, so
// downgraded/legacy backups never delete data the app already knows about.
// Newer backups: unknown fields ignored, known tables restored, warning logged.
export const CURRENT_BACKUP_SCHEMA = 2;

/**
 * User-initiated full restore: wipes the target company and replaces it with snapshot data.
 * - This is DESTRUCTIVE and should only be called via manual user action.
 * - Maps source IDs to new IDs by default to avoid conflicts, but preserves voucher numbers.
 */
export async function restoreCompanyBackup(
  targetCompanyId: string,
  backup: CompanyBackup,
  opts: { wipeExisting?: boolean; journalKind?: import("./restore-safety").RestoreKind } = {},
): Promise<RestoreSummary> {
  const { beginRestoreJournal, endRestoreJournal } = await import("./restore-safety");
  const kind = opts.journalKind ?? "file-restore";
  const companyName = ((backup.company as { name?: string } | null)?.name) ?? undefined;
  
  beginRestoreJournal({ companyId: targetCompanyId, companyName, kind });
  try {
    const summary = await restoreCompanyBackupImpl(targetCompanyId, backup, opts);
    endRestoreJournal();
    return summary;
  } catch (err) {
    try {
      const { recordFailure } = await import("./crash-log");
      recordFailure("restore", err, {
        company_id: targetCompanyId,
        schema_version: (backup as { schema_version?: unknown }).schema_version,
      });
    } catch { /* ignore */ }
    endRestoreJournal();
    throw err;
  }
}

/**
 * Non-destructive recovery: only restores missing rows using their ORIGINAL IDs.
 * - NEVER wipes existing data.
 * - NEVER overwrites existing rows (prevents older snapshots from replacing newer data).
 * - Identity preservation: preserves original UUIDs for companies, ledgers, items, vouchers.
 */
export async function recoverMissingFromSnapshot(
  targetCompanyId: string,
  backup: CompanyBackup
): Promise<RestoreSummary> {
  const { offlineDb: db } = await import("./offline/db");
  
  // 1. Identity Guard: Snapshot must match the target company ID.
  const sourceId = String((backup.company as { id?: unknown } | null)?.id ?? "");
  if (sourceId && sourceId !== targetCompanyId) {
    throw new Error(`Recovery identity conflict: snapshot ID ${sourceId} does not match target ${targetCompanyId}`);
  }

  const summary: RestoreSummary = {
    companyId: targetCompanyId,
    ledgers: 0, items: 0, vouchers: 0,
    voucher_items: 0, voucher_entries: 0,
    bill_allocations: 0, recurring_invoices: 0
  };

  await db.transaction("rw", [
    db.cache_ledgers, db.cache_items, db.cache_vouchers,
    db.cache_voucher_entries, db.cache_voucher_items,
    db.cache_bill_allocations, db.cache_recurring_invoices,
    db.cache_company_settings, db.cache_account_subgroups,
    db.cache_ledger_group_mappings, db.cache_account_group_overrides,
    db.cache_voucher_export_details, db.cache_einvoice_details,
    db.cache_period_locks, db.cache_bom_templates, db.cache_bom_template_lines,
    db.cache_voucher_series, db.cache_tax_templates, db.cache_bill_sundries,
    db.cache_transport_details, db.cache_cost_centres, db.cache_cost_categories
  ], async () => {
    
    const restoreMissing = async (table: any, rows: any[], name: keyof RestoreSummary) => {
      let count = 0;
      for (const row of rows) {
        if (!row.id) continue;
        const exists = await table.get(row.id);
        if (!exists) {
          // Preserve original data exactly — no remapping, no timestamp updates.
          await table.put(row);
          count++;
        } else {
          // Row exists: preserve live data. Conflict logging could be added here.
        }
      }
      if (typeof summary[name] === "number") (summary[name] as number) += count;
    };

    await Promise.all([
      restoreMissing(db.cache_ledgers, backup.ledgers, "ledgers"),
      restoreMissing(db.cache_items, backup.items, "items"),
      restoreMissing(db.cache_vouchers, backup.vouchers, "vouchers"),
      restoreMissing(db.cache_voucher_entries, backup.voucher_entries, "voucher_entries"),
      restoreMissing(db.cache_voucher_items, backup.voucher_items, "voucher_items"),
      restoreMissing(db.cache_bill_allocations, backup.bill_allocations, "bill_allocations"),
      restoreMissing(db.cache_recurring_invoices, backup.recurring_invoices, "recurring_invoices"),
      // v2 additions
      restoreMissing(db.cache_account_subgroups, backup.account_subgroups ?? [], "account_subgroups" as any),
      restoreMissing(db.cache_ledger_group_mappings, backup.ledger_group_mappings ?? [], "ledger_group_mappings" as any),
      restoreMissing(db.cache_account_group_overrides, backup.account_group_overrides ?? [], "account_group_overrides" as any),
      restoreMissing(db.cache_voucher_export_details, backup.voucher_export_details ?? [], "voucher_export_details" as any),
      restoreMissing(db.cache_einvoice_details, backup.einvoice_details ?? [], "einvoice_details" as any),
      restoreMissing(db.cache_period_locks, backup.period_locks ?? [], "period_locks" as any),
      restoreMissing(db.cache_bom_templates, backup.bom_templates ?? [], "bom_templates" as any),
      restoreMissing(db.cache_bom_template_lines, backup.bom_template_lines ?? [], "bom_template_lines" as any),
      restoreMissing(db.cache_voucher_series, backup.voucher_series ?? [], "voucher_series" as any),
      restoreMissing(db.cache_tax_templates, backup.tax_templates ?? [], "tax_templates" as any),
      restoreMissing(db.cache_bill_sundries, backup.bill_sundries ?? [], "bill_sundries" as any),
      restoreMissing(db.cache_transport_details, backup.transport_details ?? [], "transport_details" as any),
      restoreMissing(db.cache_cost_centres, backup.cost_centres ?? [], "cost_centres" as any),
      restoreMissing(db.cache_cost_categories, backup.cost_categories ?? [], "cost_categories" as any),
    ]);
  });

  return summary;
}

async function restoreCompanyBackupImpl(
  targetCompanyId: string,
  backup: CompanyBackup,
  opts: { wipeExisting?: boolean } = {},
): Promise<RestoreSummary> {
  const ver = Number((backup as { schema_version?: unknown }).schema_version ?? 0);
  if (!Number.isFinite(ver) || ver < 1) {
    throw new Error("Backup file is missing a valid schema_version");
  }
  // Older versions: accept and migrate forward (all v1 fields optional-safe below).
  // Newer versions: accept, ignore unknown fields, warn via console.
  if (ver > CURRENT_BACKUP_SCHEMA) {
    console.warn(
      `Backup schema v${ver} is newer than app schema v${CURRENT_BACKUP_SCHEMA}. ` +
      `Restoring known fields only; upgrade the app to preserve any new data.`,
    );
  }

  // In local-only mode, skip all supabase writes — the company id only
  // exists in IndexedDB, and any cloud inserts would fail FK checks (or
  // pollute a stale cloud row). The mirror below is authoritative.
  const { isLocalOnlyMode } = await import("./local-only-mode");
  const localOnly = isLocalOnlyMode();

  // DESTRUCTIVE RESTORE RULE: Manually initiated restores wipe the target company's 
  // data before replacing it. This is intended for "restore from file" scenarios 
  // where the user wants to explicitly replace their current data.
  void opts.wipeExisting;
  if (!localOnly) {
    // Order matters due to FKs.
    await supabase.from("bill_allocations").delete().eq("company_id", targetCompanyId);
    const { data: existingVouchers } = await supabase
      .from("vouchers")
      .select("id")
      .eq("company_id", targetCompanyId);
    const ids = (existingVouchers ?? []).map((v) => v.id);
    if (ids.length) {
      await supabase.from("voucher_items").delete().in("voucher_id", ids);
      await supabase.from("voucher_entries").delete().in("voucher_id", ids);
      await supabase.from("vouchers").delete().in("id", ids);
    }
    await supabase.from("recurring_invoices").delete().eq("company_id", targetCompanyId);
    await supabase.from("items").delete().eq("company_id", targetCompanyId);
    await supabase.from("ledgers").delete().eq("company_id", targetCompanyId);
  }

  const ledgerIdMap = new Map<string, string>();
  const itemIdMap = new Map<string, string>();
  const voucherIdMap = new Map<string, string>();
  const summary: RestoreSummary = {
    companyId: targetCompanyId,
    ledgers: 0,
    items: 0,
    vouchers: 0,
    voucher_items: 0,
    voucher_entries: 0,
    bill_allocations: 0,
    recurring_invoices: 0,
  };

  // Ledgers
  if (!localOnly) {
  for (const lRaw of backup.ledgers) {
    const { id, company_id: _c, created_at: _ca, updated_at: _ua, ...rest } = lRaw as Record<
      string,
      unknown
    >;
    const { data, error } = await supabase
      .from("ledgers")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ ...(rest as any), company_id: targetCompanyId })
      .select("id")
      .single();
    if (!error && data) {
      ledgerIdMap.set(String(id), data.id);
      summary.ledgers++;
    }
  }

  // Items
  for (const iRaw of backup.items) {
    const { id, company_id: _c, created_at: _ca, updated_at: _ua, ...rest } = iRaw as Record<
      string,
      unknown
    >;
    const { data, error } = await supabase
      .from("items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ ...(rest as any), company_id: targetCompanyId })
      .select("id")
      .single();
    if (!error && data) {
      itemIdMap.set(String(id), data.id);
      summary.items++;
    }
  }

  // Vouchers
  for (const vRaw of backup.vouchers) {
    const {
      id,
      company_id: _c,
      created_at: _ca,
      updated_at: _ua,
      created_by: _cb,
      party_ledger_id,
      original_voucher_id: _ov,
      linked_voucher_ids: _lv,
      ...rest
    } = vRaw as Record<string, unknown>;
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("vouchers")
      .insert({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(rest as any),
        company_id: targetCompanyId,
        created_by: u.user?.id ?? "",
        party_ledger_id: party_ledger_id
          ? ledgerIdMap.get(String(party_ledger_id)) ?? null
          : null,
      })
      .select("id")
      .single();
    if (!error && data) {
      voucherIdMap.set(String(id), data.id);
      summary.vouchers++;
    }
  }

  // Voucher items
  for (const viRaw of backup.voucher_items) {
    const { id: _id, voucher_id, item_id, created_at: _ca, ...rest } = viRaw as Record<
      string,
      unknown
    >;
    const newV = voucherIdMap.get(String(voucher_id));
    const newI = itemIdMap.get(String(item_id));
    if (!newV || !newI) continue;
    const { error } = await supabase
      .from("voucher_items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ ...(rest as any), voucher_id: newV, item_id: newI });
    if (!error) summary.voucher_items++;
  }

  // Voucher entries — MUST insert all rows of a voucher in a single statement,
  // otherwise the Dr=Cr balance trigger (AFTER INSERT FOR EACH STATEMENT) rejects
  // partial inserts. Group by new voucher_id and insert per-voucher batches.
  const entriesByVoucher = new Map<string, Record<string, unknown>[]>();
  for (const veRaw of backup.voucher_entries) {
    const { id: _id, voucher_id, ledger_id, created_at: _ca, ...rest } = veRaw as Record<
      string,
      unknown
    >;
    const newV = voucherIdMap.get(String(voucher_id));
    const newL = ledgerIdMap.get(String(ledger_id));
    if (!newV || !newL) continue;
    const row = { ...(rest as Record<string, unknown>), voucher_id: newV, ledger_id: newL };
    const arr = entriesByVoucher.get(newV) ?? [];
    arr.push(row);
    entriesByVoucher.set(newV, arr);
  }
  for (const rows of entriesByVoucher.values()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from("voucher_entries").insert(rows as any);
    if (!error) summary.voucher_entries += rows.length;
  }

  // Bill allocations
  for (const baRaw of backup.bill_allocations) {
    const {
      id: _id,
      company_id: _c,
      invoice_voucher_id,
      payment_voucher_id,
      ledger_id,
      created_at: _ca,
      ...rest
    } = baRaw as Record<string, unknown>;
    const inv = voucherIdMap.get(String(invoice_voucher_id));
    const pay = voucherIdMap.get(String(payment_voucher_id));
    const led = ledgerIdMap.get(String(ledger_id));
    if (!inv || !pay || !led) continue;
    const { error } = await supabase.from("bill_allocations").insert({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(rest as any),
      company_id: targetCompanyId,
      invoice_voucher_id: inv,
      payment_voucher_id: pay,
      ledger_id: led,
    });
    if (!error) summary.bill_allocations++;
  }

  // Recurring invoices
  for (const rRaw of backup.recurring_invoices) {
    const {
      id: _id,
      company_id: _c,
      created_at: _ca,
      updated_at: _ua,
      created_by: _cb,
      party_ledger_id,
      last_generated_voucher_id: _lgv,
      ...rest
    } = rRaw as Record<string, unknown>;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("recurring_invoices").insert({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(rest as any),
      company_id: targetCompanyId,
      created_by: u.user?.id ?? "",
      party_ledger_id: party_ledger_id
        ? ledgerIdMap.get(String(party_ledger_id)) ?? null
        : null,
      last_generated_voucher_id: null,
    });
    if (!error) summary.recurring_invoices++;
  }
  } // end if (!localOnly)


  // ------------------------------------------------------------------
  // Local-cache mirror (CRITICAL for local-only mode).
  // The UI reads from IndexedDB cache tables, not from supabase. Cloud
  // sync is disabled in local-only mode, so without this mirror the
  // user sees an empty company after a "successful" restore.
  // We keep original source IDs (UUIDs) so voucher_entries/items still
  // reference the parent vouchers correctly; company_id is remapped.
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // Local-cache mirror (CRITICAL for local-only mode).
  //
  // NOTE: This call in restoreCompanyBackupImpl is part of the 
  // DESTRUCTIVE path. It uses shouldRemapIds logic to potentially 
  // import a company from a different ID.
  // ------------------------------------------------------------------
  try {
    await mirrorRestoreToLocalCache(targetCompanyId, backup, summary);
  } catch (err) {
    console.error("[restore] local cache mirror failed:", err);
  }

  // Lock out the one-time cloud→local migration permanently. After a
  // restore, local IndexedDB is authoritative; if the flag were still
  // unset (e.g. user restored on a fresh install), the next sign-in
  // would call scheduleCloudMigrationDown() and re-pull old cloud
  // companies, resurrecting the very duplicates the restore removed
  // and overwriting the restored data.
  try {
    const { setMeta } = await import("./offline/db");
    await setMeta("cloud_migration_v1_done", { at: Date.now(), note: "locked by restore" });
  } catch (err) {
    console.warn("[restore] failed to lock cloud migration flag:", err);
  }

  return summary;
}

async function mirrorRestoreToLocalCache(
  targetCompanyId: string,
  backup: CompanyBackup,
  summary: RestoreSummary,
): Promise<void> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  const { offlineDb: db } = await import("./offline/db");

  const sourceCompanyId = String(
    ((backup.company as Record<string, unknown> | null)?.id ??
      (backup.company as Record<string, unknown> | null)?.company_id ??
      ""),
  );
  // During AUTOMATIC recovery (or user-initiated same-ID restore), identities
  // MUST be preserved exactly. Source accounting IDs (UUIDs) are sacred.
  const shouldRemapIds = sourceCompanyId && sourceCompanyId !== targetCompanyId;

  const remapId = (scope: string, id: unknown): string | undefined => {
    if (id === null || id === undefined || id === "") return undefined;
    const raw = String(id);
    if (!shouldRemapIds) return raw;
    // Remapping is ONLY for cross-company clones/imports, never for recovery.
    return `local:${targetCompanyId}:${scope}:${raw}`;
  };

  const ledgerId = (id: unknown) => remapId("ledger", id);
  const itemId = (id: unknown) => remapId("item", id);
  const voucherId = (id: unknown) => remapId("voucher", id);
  const entryId = (id: unknown) => remapId("entry", id);
  const voucherItemId = (id: unknown) => remapId("voucher-item", id);
  const allocationId = (id: unknown) => remapId("allocation", id);
  const recurringId = (id: unknown) => remapId("recurring", id);

  const stamp = (row: Record<string, unknown>): Record<string, unknown> => ({
    ...row,
    company_id: targetCompanyId,
    updated_at: (row.updated_at as string) ?? new Date().toISOString(),
    is_synced: true,
  });

  const withId = (
    row: Record<string, unknown>,
    id: string | undefined,
    extra: Record<string, unknown> = {},
  ) => {
    const out = stamp({ ...row, ...extra });
    if (id) out.id = id;
    return out;
  };

  const mapLinkedVoucherIds = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((id) => voucherId(id) ?? id);
    return value;
  };

  // ATOMIC: wipe + rewrite for this company happens inside ONE Dexie
  // transaction. A crash mid-restore either rolls the whole thing back
  // (leaving the previous data intact) or commits everything. Without
  // this, an app close between the wipe and the bulkPut left the
  // company with zero rows and no snapshot to recover from. See Bug 3.1.
  const tables = [
    db.companies,
    db.cache_companies,
    db.cache_company_settings,
    db.cache_ledgers,
    db.cache_items,
    db.cache_vouchers,
    db.cache_voucher_entries,
    db.cache_voucher_items,
    db.cache_bill_allocations,
    db.cache_recurring_invoices,
    // v2 additions — kept in the SAME transaction so atomicity extends
    // to every collection the backup carries. If any bulkPut fails,
    // the whole restore rolls back (per Bug 3.1 comment above).
    db.cache_account_subgroups,
    db.cache_ledger_group_mappings,
    db.cache_account_group_overrides,
    db.cache_voucher_export_details,
    db.cache_einvoice_details,
    db.cache_period_locks,
    db.cache_bom_templates,
    db.cache_bom_template_lines,
    db.cache_voucher_series,
    db.cache_tax_templates,
    db.cache_bill_sundries,
    db.cache_transport_details,
    db.cache_cost_centres,
    db.cache_cost_categories,
  ];

  // v2 backups carry these tables; older v1 backups leave them undefined,
  // in which case we DO NOT wipe them (preserves any local data the app
  // has for these features so a v1 restore doesn't nuke settings the user
  // never intended to touch).
  const hasV2 = (backup.schema_version ?? 1) >= 2;

  await db.transaction("rw", tables, async () => {
    // ---------- Settings guard (Round 2) ----------
    // Read the CURRENT settings row before wiping. If the local copy is
    // newer than the one in the backup (e.g. the user just tweaked GSTIN,
    // logo, or invoice numbering after the backup was taken), keep the
    // local values — merging over the backup's settings — instead of
    // silently reverting them. This is the most common footgun users hit
    // when auto-restore repairs an orphaned profile hours after new
    // configuration was saved. We NEVER silently downgrade settings.
    let localSettings: Record<string, unknown> | null = null;
    try {
      const rows = await db.cache_company_settings
        .where("company_id").equals(targetCompanyId).toArray();
      localSettings = (rows[0] as Record<string, unknown> | undefined) ?? null;
    } catch { /* ignore */ }

    const wipes: Promise<unknown>[] = [
      db.cache_ledgers.where("company_id").equals(targetCompanyId).delete(),
      db.cache_items.where("company_id").equals(targetCompanyId).delete(),
      db.cache_vouchers.where("company_id").equals(targetCompanyId).delete(),
      db.cache_voucher_entries.where("company_id").equals(targetCompanyId).delete(),
      db.cache_voucher_items.where("company_id").equals(targetCompanyId).delete(),
      db.cache_bill_allocations.where("company_id").equals(targetCompanyId).delete(),
      db.cache_recurring_invoices.where("company_id").equals(targetCompanyId).delete(),
      db.cache_company_settings.where("company_id").equals(targetCompanyId).delete(),
    ];
    if (hasV2) {
      wipes.push(
        db.cache_account_subgroups.where("company_id").equals(targetCompanyId).delete(),
        db.cache_ledger_group_mappings.where("company_id").equals(targetCompanyId).delete(),
        db.cache_account_group_overrides.where("company_id").equals(targetCompanyId).delete(),
        db.cache_voucher_export_details.where("company_id").equals(targetCompanyId).delete(),
        db.cache_einvoice_details.where("company_id").equals(targetCompanyId).delete(),
        db.cache_period_locks.where("company_id").equals(targetCompanyId).delete(),
        db.cache_bom_templates.where("company_id").equals(targetCompanyId).delete(),
        db.cache_bom_template_lines.where("company_id").equals(targetCompanyId).delete(),
        db.cache_voucher_series.where("company_id").equals(targetCompanyId).delete(),
        db.cache_tax_templates.where("company_id").equals(targetCompanyId).delete(),
        db.cache_bill_sundries.where("company_id").equals(targetCompanyId).delete(),
        db.cache_transport_details.where("company_id").equals(targetCompanyId).delete(),
        db.cache_cost_centres.where("company_id").equals(targetCompanyId).delete(),
        db.cache_cost_categories.where("company_id").equals(targetCompanyId).delete(),
      );
    }
    await Promise.all(wipes);

    if (backup.company) {
      const companyRow = stamp({ ...(backup.company as Record<string, unknown>), id: targetCompanyId });
      await db.cache_companies.put(companyRow);
      await db.companies.put({
        id: targetCompanyId,
        name: String(companyRow.name ?? "Restored company"),
        has_password: Boolean((companyRow as { has_password?: unknown }).has_password),
        account_id: "local-user",
      });
    }
    // Choose the settings row that wins the guard.
    const backupSettingsRaw = backup.settings as Record<string, unknown> | null;
    let effectiveSettings: Record<string, unknown> | null = backupSettingsRaw;
    if (localSettings) {
      const localTs = Date.parse(String(localSettings.updated_at ?? "")) || 0;
      const backupTs = Date.parse(String(backupSettingsRaw?.updated_at ?? "")) || 0;
      if (localTs > backupTs) {
        // Keep local — but layer any fields the backup has that local is
        // missing (e.g. brand-new columns). Local wins on collisions.
        effectiveSettings = { ...(backupSettingsRaw ?? {}), ...localSettings };
        // eslint-disable-next-line no-console
        console.warn(
          "[restore] Kept newer local company_settings (updated_at %s > backup %s) — backup settings were older and would have reverted user changes.",
          new Date(localTs).toISOString(),
          new Date(backupTs).toISOString(),
        );
      }
    }
    if (effectiveSettings) {
      const s = stamp({ ...effectiveSettings }) as Record<string, unknown>;
      s.id = shouldRemapIds ? `settings-${targetCompanyId}` : (s.id || `settings-${targetCompanyId}`);
      await db.cache_company_settings.put(s);
    }

    if (backup.ledgers?.length) {
      await db.cache_ledgers.bulkPut(
        backup.ledgers.map((r) => {
          const row = r as Record<string, unknown>;
          return withId(row, ledgerId(row.id));
        }),
      );
      summary.ledgers = Math.max(summary.ledgers, backup.ledgers.length);
    }
    if (backup.items?.length) {
      await db.cache_items.bulkPut(
        backup.items.map((r) => {
          const row = r as Record<string, unknown>;
          return withId(row, itemId(row.id));
        }),
      );
      summary.items = Math.max(summary.items, backup.items.length);
    }
    if (backup.vouchers?.length) {
      await db.cache_vouchers.bulkPut(
        backup.vouchers.map((r) => {
          const row = r as Record<string, unknown>;
          return withId(row, voucherId(row.id), {
            party_ledger_id: row.party_ledger_id ? ledgerId(row.party_ledger_id) ?? null : row.party_ledger_id,
            // DO NOT destructure/remove original_voucher_id and linked_voucher_ids during restore.
            original_voucher_id: row.original_voucher_id ? voucherId(row.original_voucher_id) ?? null : row.original_voucher_id,
            linked_voucher_ids: mapLinkedVoucherIds(row.linked_voucher_ids),
          });
        }),
      );
      summary.vouchers = Math.max(summary.vouchers, backup.vouchers.length);
    }
    if (backup.voucher_entries?.length) {
      await db.cache_voucher_entries.bulkPut(
        backup.voucher_entries.map((r) => {
          const row = r as Record<string, unknown>;
          return withId(row, entryId(row.id), {
            voucher_id: voucherId(row.voucher_id) ?? row.voucher_id,
            ledger_id: ledgerId(row.ledger_id) ?? row.ledger_id,
          });
        }),
      );
      summary.voucher_entries = Math.max(summary.voucher_entries, backup.voucher_entries.length);
    }
    if (backup.voucher_items?.length) {
      await db.cache_voucher_items.bulkPut(
        backup.voucher_items.map((r) => {
          const row = r as Record<string, unknown>;
          return withId(row, voucherItemId(row.id), {
            voucher_id: voucherId(row.voucher_id) ?? row.voucher_id,
            item_id: itemId(row.item_id) ?? row.item_id,
          });
        }),
      );
      summary.voucher_items = Math.max(summary.voucher_items, backup.voucher_items.length);
    }
    if (backup.bill_allocations?.length) {
      await db.cache_bill_allocations.bulkPut(
        backup.bill_allocations.map((r) => {
          const row = r as Record<string, unknown>;
          return withId(row, allocationId(row.id), {
            invoice_voucher_id: voucherId(row.invoice_voucher_id) ?? row.invoice_voucher_id,
            payment_voucher_id: voucherId(row.payment_voucher_id) ?? row.payment_voucher_id,
            ledger_id: ledgerId(row.ledger_id) ?? row.ledger_id,
          });
        }),
      );
      summary.bill_allocations = Math.max(summary.bill_allocations, backup.bill_allocations.length);
    }
    if (backup.recurring_invoices?.length) {
      await db.cache_recurring_invoices.bulkPut(
        backup.recurring_invoices.map((r) => {
          const row = r as Record<string, unknown>;
          return withId(row, recurringId(row.id), {
            party_ledger_id: row.party_ledger_id ? ledgerId(row.party_ledger_id) ?? null : row.party_ledger_id,
            last_generated_voucher_id: row.last_generated_voucher_id
              ? voucherId(row.last_generated_voucher_id) ?? null
              : row.last_generated_voucher_id,
          });
        }),
      );
      summary.recurring_invoices = Math.max(
        summary.recurring_invoices,
        backup.recurring_invoices.length,
      );
    }

    // ---------- v2 additions ----------
    // Same-company restore (auto-restore, undo, re-import) -> shouldRemapIds
    // is false, so IDs pass through unchanged and every FK stays valid.
    // Cross-company restore (recovery wizard "restore into new company") ->
    // IDs get remapped consistently with vouchers/ledgers/items above.
    const bomTemplateId = (id: unknown) => remapId("bom-template", id);
    const subgroupId = (id: unknown) => remapId("subgroup", id);
    const mappingId = (id: unknown) => remapId("group-mapping", id);
    const overrideId = (id: unknown) => remapId("group-override", id);
    const periodLockId = (id: unknown) => remapId("period-lock", id);
    const seriesId = (id: unknown) => remapId("voucher-series", id);
    const taxTplId = (id: unknown) => remapId("tax-template", id);
    const sundryId = (id: unknown) => remapId("bill-sundry", id);
    const centreId = (id: unknown) => remapId("cost-centre", id);
    const categoryId = (id: unknown) => remapId("cost-category", id);
    const exportDetId = (voucher: unknown) => voucherId(voucher);
    const einvDetId = (voucher: unknown) => voucherId(voucher);
    const transportDetId = (voucher: unknown) => voucherId(voucher);

    const putArr = async (
      arr: Record<string, unknown>[] | undefined,
      table: { bulkPut: (rows: unknown[]) => Promise<unknown> },
      mapRow: (row: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<number> => {
      if (!arr || !arr.length) return 0;
      const rows = arr.map((r) => mapRow(r));
      await table.bulkPut(rows);
      return rows.length;
    };

    summary.account_subgroups = await putArr(backup.account_subgroups, db.cache_account_subgroups, (r) =>
      withId(r, subgroupId(r.id)),
    );
    summary.ledger_group_mappings = await putArr(backup.ledger_group_mappings, db.cache_ledger_group_mappings, (r) =>
      withId(r, mappingId(r.id), {
        ledger_id: r.ledger_id ? ledgerId(r.ledger_id) ?? r.ledger_id : r.ledger_id,
        subgroup_id: r.subgroup_id ? subgroupId(r.subgroup_id) ?? r.subgroup_id : r.subgroup_id,
      }),
    );
    summary.account_group_overrides = await putArr(backup.account_group_overrides, db.cache_account_group_overrides, (r) =>
      withId(r, overrideId(r.id), {
        ledger_id: r.ledger_id ? ledgerId(r.ledger_id) ?? r.ledger_id : r.ledger_id,
      }),
    );
    summary.voucher_export_details = await putArr(backup.voucher_export_details, db.cache_voucher_export_details, (r) => {
      const row = withId(r, undefined, {
        voucher_id: exportDetId(r.voucher_id) ?? r.voucher_id,
      });
      // table is keyed by voucher_id, not id — use it as the primary key
      row.voucher_id = row.voucher_id ?? r.voucher_id;
      return row;
    });
    summary.einvoice_details = await putArr(backup.einvoice_details, db.cache_einvoice_details, (r) => {
      const row = withId(r, undefined, {
        voucher_id: einvDetId(r.voucher_id) ?? r.voucher_id,
      });
      row.voucher_id = row.voucher_id ?? r.voucher_id;
      return row;
    });
    summary.period_locks = await putArr(backup.period_locks, db.cache_period_locks, (r) =>
      withId(r, periodLockId(r.id)),
    );
    summary.bom_templates = await putArr(backup.bom_templates, db.cache_bom_templates, (r) =>
      withId(r, bomTemplateId(r.id), {
        output_item_id: r.output_item_id ? itemId(r.output_item_id) ?? r.output_item_id : r.output_item_id,
      }),
    );
    summary.bom_template_lines = await putArr(backup.bom_template_lines, db.cache_bom_template_lines, (r) =>
      withId(r, remapId("bom-template-line", r.id), {
        template_id: r.template_id ? bomTemplateId(r.template_id) ?? r.template_id : r.template_id,
        item_id: r.item_id ? itemId(r.item_id) ?? r.item_id : r.item_id,
      }),
    );
    summary.voucher_series = await putArr(backup.voucher_series, db.cache_voucher_series, (r) =>
      withId(r, seriesId(r.id)),
    );
    summary.tax_templates = await putArr(backup.tax_templates, db.cache_tax_templates, (r) =>
      withId(r, taxTplId(r.id)),
    );
    summary.bill_sundries = await putArr(backup.bill_sundries, db.cache_bill_sundries, (r) =>
      withId(r, sundryId(r.id), {
        voucher_id: r.voucher_id ? voucherId(r.voucher_id) ?? r.voucher_id : r.voucher_id,
        ledger_id: r.ledger_id ? ledgerId(r.ledger_id) ?? r.ledger_id : r.ledger_id,
      }),
    );
    summary.transport_details = await putArr(backup.transport_details, db.cache_transport_details, (r) => {
      const row = withId(r, undefined, {
        voucher_id: transportDetId(r.voucher_id) ?? r.voucher_id,
      });
      row.voucher_id = row.voucher_id ?? r.voucher_id;
      return row;
    });
    summary.cost_centres = await putArr(backup.cost_centres, db.cache_cost_centres, (r) =>
      withId(r, centreId(r.id)),
    );
    summary.cost_categories = await putArr(backup.cost_categories, db.cache_cost_categories, (r) =>
      withId(r, categoryId(r.id)),
    );
  });
}


export async function parseBackupFile(
  text: string,
): Promise<
  | { kind: "single"; data: CompanyBackup; checksumOk?: boolean }
  | { kind: "multi"; data: MultiCompanyBackup; checksumOk?: boolean }
> {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) {
    throw new Error(
      "This file is not a Your Mehtaji backup. Restore only accepts the .json file produced by 'Export full backup'.",
    );
  }
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      "Backup file is not valid JSON. Please upload the .json file produced by 'Export full backup'.",
    );
  }

  // New format: wrapped in a signed envelope with SHA-256 checksum.
  if (isBackupEnvelope(j)) {
    const checksumOk = await verifyEnvelope(j);
    const inner = j.payload as Record<string, unknown>;
    if (inner.kind === "all_companies" && Array.isArray(inner.companies)) {
      return { kind: "multi", data: inner as unknown as MultiCompanyBackup, checksumOk };
    }
    if (typeof inner.schema_version === "number") {
      return { kind: "single", data: inner as unknown as CompanyBackup, checksumOk };
    }
    throw new Error("Backup envelope contains an unknown payload.");
  }

  // Legacy format: bare CompanyBackup / MultiCompanyBackup.
  if (j.kind === "all_companies" && Array.isArray(j.companies)) {
    return { kind: "multi", data: j as unknown as MultiCompanyBackup };
  }
  if (typeof j.schema_version === "number") {
    return { kind: "single", data: j as unknown as CompanyBackup };
  }
  throw new Error("Not a Your Mehtaji backup file (missing schema_version).");
}
