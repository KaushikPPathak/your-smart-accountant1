// Backup & Restore utilities — JSON snapshot per-company or all-companies.
// In Electron desktop builds, files are also written to C:\YourMehtaji\<Company>\backups\.
import { supabase } from "@/integrations/supabase/client";
import { wrapBackup, isBackupEnvelope, verifyEnvelope } from "@/lib/backup-policy";

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

// ---------- Electron bridge (optional) ----------
interface ElectronAPI {
  saveCompanyFile: (
    company: string,
    subFolder: string,
    fileName: string,
    contents: string,
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
}
function electron(): ElectronAPI | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { yourMehtaji?: ElectronAPI };
  return w.yourMehtaji ?? null;
}

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
export async function buildCompanyBackup(companyId: string): Promise<CompanyBackup> {
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

  const api = electron();
  if (api) {
    const res = await api.saveCompanyFile(companyName, "backups", fileName, contents);
    if (res.ok) return { fileName, desktopPath: res.path };
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

  const api = electron();
  if (api) {
    const res = await api.saveCompanyFile("_AllCompanies", "backups", fileName, contents);
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
export async function restoreCompanyBackup(
  targetCompanyId: string,
  backup: CompanyBackup,
  opts: { wipeExisting?: boolean } = {},
): Promise<RestoreSummary> {
  if (backup.schema_version !== 1) throw new Error("Unsupported backup version");

  if (opts.wipeExisting) {
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

  // Voucher entries
  for (const veRaw of backup.voucher_entries) {
    const { id: _id, voucher_id, ledger_id, created_at: _ca, ...rest } = veRaw as Record<
      string,
      unknown
    >;
    const newV = voucherIdMap.get(String(voucher_id));
    const newL = ledgerIdMap.get(String(ledger_id));
    if (!newV || !newL) continue;
    const { error } = await supabase
      .from("voucher_entries")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ ...(rest as any), voucher_id: newV, ledger_id: newL });
    if (!error) summary.voucher_entries++;
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

  return summary;
}

export function parseBackupFile(
  text: string,
): { kind: "single"; data: CompanyBackup } | { kind: "multi"; data: MultiCompanyBackup } {
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
  if (j.kind === "all_companies" && Array.isArray(j.companies)) {
    return { kind: "multi", data: j as unknown as MultiCompanyBackup };
  }
  if (typeof j.schema_version === "number") {
    return { kind: "single", data: j as unknown as CompanyBackup };
  }
  throw new Error("Not a Your Mehtaji backup file (missing schema_version).");
}
