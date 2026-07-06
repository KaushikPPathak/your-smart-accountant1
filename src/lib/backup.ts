// Backup & Restore utilities — JSON snapshot per-company or all-companies.
// In Electron desktop builds, files are also written to C:\YourMehtaji\<Company>\backups\.
import { supabase } from "@/integrations/supabase/client";
import { wrapBackup, isBackupEnvelope, verifyEnvelope } from "@/lib/backup-policy";
import { isLocalOnlyMode } from "@/lib/local-only-mode";

// ---------- Types ----------
export interface CompanyBackup {
  schema_version: 1;
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
}

export interface MultiCompanyBackup {
  schema_version: 1;
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
  const [company, settings, ledgers, items, vouchers, voucher_entries, voucher_items, bill_allocations, recurring_invoices] = await Promise.all([
    db.cache_companies.get(companyId).catch(() => null),
    db.cache_company_settings.where("company_id").equals(companyId).first().catch(() => null),
    db.cache_ledgers.where("company_id").equals(companyId).toArray().catch(() => []),
    db.cache_items.where("company_id").equals(companyId).toArray().catch(() => []),
    db.cache_vouchers.where("company_id").equals(companyId).toArray().catch(() => []),
    db.cache_voucher_entries.where("company_id").equals(companyId).toArray().catch(() => []),
    db.cache_voucher_items.where("company_id").equals(companyId).toArray().catch(() => []),
    db.cache_bill_allocations.where("company_id").equals(companyId).toArray().catch(() => []),
    db.cache_recurring_invoices.where("company_id").equals(companyId).toArray().catch(() => []),
  ]);
  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    company: (company as Record<string, unknown> | null) ?? null,
    settings: (settings as Record<string, unknown> | null) ?? null,
    ledgers: (ledgers as Record<string, unknown>[]) ?? [],
    items: (items as Record<string, unknown>[]) ?? [],
    vouchers: (vouchers as Record<string, unknown>[]) ?? [],
    voucher_entries: (voucher_entries as Record<string, unknown>[]) ?? [],
    voucher_items: (voucher_items as Record<string, unknown>[]) ?? [],
    bill_allocations: (bill_allocations as Record<string, unknown>[]) ?? [],
    recurring_invoices: (recurring_invoices as Record<string, unknown>[]) ?? [],
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
  return {
    schema_version: 1,
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
    schema_version: 1,
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
}

/**
 * Restore one company backup INTO an existing target company.
 * - Maps source ledger/item/voucher IDs -> new IDs.
 * - Does NOT touch the target company's settings or member list.
 * - Skips rows that fail (e.g. duplicate voucher numbers).
 */
// Current schema version this build writes. Older backups are accepted
// verbatim; newer backups are accepted with a "forward compatibility" warning
// (unknown fields are ignored, known tables are restored). This mirrors the
// bidirectional version tolerance users expect from established accounting
// software — never refuse a legitimate backup just because the version number
// differs.
export const CURRENT_BACKUP_SCHEMA = 1;

export async function restoreCompanyBackup(
  targetCompanyId: string,
  backup: CompanyBackup,
  opts: { wipeExisting?: boolean } = {},
): Promise<RestoreSummary> {
  try {
    return await restoreCompanyBackupImpl(targetCompanyId, backup, opts);
  } catch (err) {
    // Layer 5 — record restore failures locally so users / support can see
    // what went wrong on the device without any network telemetry.
    try {
      const { recordFailure } = await import("./crash-log");
      recordFailure("restore", err, {
        company_id: targetCompanyId,
        schema_version: (backup as { schema_version?: unknown }).schema_version,
        ledgers: backup.ledgers?.length ?? 0,
        vouchers: backup.vouchers?.length ?? 0,
      });
    } catch { /* never let telemetry mask the real error */ }
    throw err;
  }
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

  // STRICT RESTORE RULE: always wipe the target company's data before restoring.
  // "Overwrite existing balances and add missing transactions" is only achievable
  // by replacing the full snapshot — merging by heuristic keys produces
  // duplicate ledgers / duplicate vouchers / mismatched balances. This is
  // non-negotiable and ignores any caller that tries to disable it.
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
  try {
    await mirrorRestoreToLocalCache(targetCompanyId, backup, summary);
  } catch (err) {
    console.error("[restore] local cache mirror failed:", err);
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
  const shouldRemapIds = !sourceCompanyId || sourceCompanyId !== targetCompanyId;

  const remapId = (scope: string, id: unknown): string | undefined => {
    if (id === null || id === undefined || id === "") return undefined;
    const raw = String(id);
    if (!shouldRemapIds) return raw;
    return `local:${targetCompanyId}:${scope}:${raw}`;
  };

  const ledgerId = (id: unknown) => remapId("ledger", id);
  const itemId = (id: unknown) => remapId("item", id);
  const voucherId = (id: unknown) => remapId("voucher", id);
  const entryId = (id: unknown) => remapId("entry", id);
  const voucherItemId = (id: unknown) => remapId("voucher-item", id);
  const allocationId = (id: unknown) => remapId("allocation", id);
  const recurringId = (id: unknown) => remapId("recurring", id);

  const stamp = (row: Record<string, unknown>) => ({
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
  ];

  await db.transaction("rw", tables, async () => {
    await Promise.all([
      db.cache_ledgers.where("company_id").equals(targetCompanyId).delete(),
      db.cache_items.where("company_id").equals(targetCompanyId).delete(),
      db.cache_vouchers.where("company_id").equals(targetCompanyId).delete(),
      db.cache_voucher_entries.where("company_id").equals(targetCompanyId).delete(),
      db.cache_voucher_items.where("company_id").equals(targetCompanyId).delete(),
      db.cache_bill_allocations.where("company_id").equals(targetCompanyId).delete(),
      db.cache_recurring_invoices.where("company_id").equals(targetCompanyId).delete(),
      db.cache_company_settings.where("company_id").equals(targetCompanyId).delete(),
    ]);

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
    if (backup.settings) {
      const s = stamp({ ...(backup.settings as Record<string, unknown>) }) as Record<string, unknown>;
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
