// Backup file inspector.
//
// Reads a .laccbak / .json backup file, verifies the signed envelope,
// walks every embedded company payload and returns a structured report
// the UI can show BEFORE the user commits to a destructive restore.
//
// Pure — no network, no writes. Safe to run on user-picked files.

import {
  parseBackupFile,
  type CompanyBackup,
  type MultiCompanyBackup,
} from "@/lib/backup";

export interface CompanyPreview {
  index: number;
  name: string;
  gstin: string | null;
  pan: string | null;
  ledgers: number;
  items: number;
  vouchers: number;
  voucherItems: number;
  voucherEntries: number;
  dateRange: { from: string | null; to: string | null };
  /** Cheap sanity checks — voucher rows that would fail restore. */
  issues: string[];
}

export interface InspectionReport {
  ok: boolean;
  kind: "single" | "multi";
  format: "signed-envelope" | "legacy-bare";
  checksumOk: boolean | null; // null = legacy file, no checksum to verify
  schemaVersion: number;
  exportedAt: string | null;
  fileName: string;
  sizeBytes: number;
  companyCount: number;
  companies: CompanyPreview[];
  totals: {
    ledgers: number;
    items: number;
    vouchers: number;
  };
  warnings: string[];
  errors: string[];
  /** Raw parsed structure for downstream restore — the caller reuses this
   *  instead of re-parsing, so the file the user reviewed is exactly the
   *  file that gets restored. */
  raw:
    | { kind: "single"; data: CompanyBackup }
    | { kind: "multi"; data: MultiCompanyBackup };
}

const ARCHIVE_MAGIC: Array<{ label: string; bytes: number[] }> = [
  { label: "ZIP", bytes: [0x50, 0x4b] },
  { label: "RAR", bytes: [0x52, 0x61, 0x72] },
  { label: "7Z", bytes: [0x37, 0x7a] },
];

async function detectArchive(file: File): Promise<string | null> {
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    for (const sig of ARCHIVE_MAGIC) {
      if (sig.bytes.every((b, i) => head[i] === b)) return sig.label;
    }
  } catch { /* ignore */ }
  return null;
}

function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  // Voucher date is typically YYYY-MM-DD; ISO-parse is lenient enough.
  const t = Date.parse(v);
  return Number.isFinite(t) ? v.slice(0, 10) : null;
}

function summariseCompany(
  index: number,
  c: CompanyBackup,
): CompanyPreview {
  const company = (c.company ?? {}) as Record<string, unknown>;
  const name = String(company.name ?? "Unknown company");
  const gstin = (company.gstin as string | null | undefined) ?? null;
  const pan = (company.pan as string | null | undefined) ?? null;

  let minDate: string | null = null;
  let maxDate: string | null = null;
  const issues: string[] = [];
  let missingDate = 0;

  for (const v of c.vouchers ?? []) {
    const d = isoDate((v as Record<string, unknown>).date);
    if (!d) { missingDate++; continue; }
    if (minDate === null || d < minDate) minDate = d;
    if (maxDate === null || d > maxDate) maxDate = d;
  }
  if (missingDate > 0) {
    issues.push(`${missingDate} voucher(s) missing a valid date`);
  }
  // Structural sanity: voucher_items / voucher_entries should reference vouchers.
  const voucherIds = new Set(
    (c.vouchers ?? []).map((v) => String((v as Record<string, unknown>).id ?? "")),
  );
  let orphanItems = 0;
  for (const vi of c.voucher_items ?? []) {
    const vid = String((vi as Record<string, unknown>).voucher_id ?? "");
    if (vid && !voucherIds.has(vid)) orphanItems++;
  }
  if (orphanItems > 0) {
    issues.push(`${orphanItems} voucher line(s) reference a missing voucher`);
  }

  return {
    index,
    name,
    gstin: gstin ? String(gstin) : null,
    pan: pan ? String(pan) : null,
    ledgers: c.ledgers?.length ?? 0,
    items: c.items?.length ?? 0,
    vouchers: c.vouchers?.length ?? 0,
    voucherItems: c.voucher_items?.length ?? 0,
    voucherEntries: c.voucher_entries?.length ?? 0,
    dateRange: { from: minDate, to: maxDate },
    issues,
  };
}

export async function inspectBackupFile(file: File): Promise<InspectionReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const archive = await detectArchive(file);
  if (archive) {
    throw new Error(
      `This is a ${archive} archive, not a backup file. Extract the .laccbak / .json first.`,
    );
  }

  const text = await file.text();
  const parsed = await parseBackupFile(text); // throws with a friendly message

  const checksumOk =
    parsed.checksumOk === undefined ? null : parsed.checksumOk;
  const format: InspectionReport["format"] =
    parsed.checksumOk === undefined ? "legacy-bare" : "signed-envelope";
  if (format === "legacy-bare") {
    warnings.push(
      "Legacy backup format (no checksum). Content is readable but cannot be cryptographically verified.",
    );
  } else if (checksumOk === false) {
    errors.push(
      "Signed checksum does NOT match the file contents. The file may be corrupted, truncated, or edited after export.",
    );
  }

  let companies: CompanyPreview[] = [];
  let schemaVersion = 0;
  let exportedAt: string | null = null;

  if (parsed.kind === "single") {
    const c = parsed.data;
    schemaVersion = c.schema_version;
    exportedAt = c.exported_at ?? null;
    companies = [summariseCompany(0, c)];
  } else {
    const m = parsed.data;
    schemaVersion = m.schema_version;
    exportedAt = m.exported_at ?? null;
    companies = (m.companies ?? []).map((c, i) => summariseCompany(i, c));
    if (companies.length === 0) {
      errors.push("Multi-company backup contains zero companies.");
    }
  }

  // Aggregate structural issues into report-level warnings so the summary tile is honest.
  for (const c of companies) {
    for (const iss of c.issues) warnings.push(`${c.name}: ${iss}`);
  }

  const totals = companies.reduce(
    (acc, c) => ({
      ledgers: acc.ledgers + c.ledgers,
      items: acc.items + c.items,
      vouchers: acc.vouchers + c.vouchers,
    }),
    { ledgers: 0, items: 0, vouchers: 0 },
  );

  return {
    ok: errors.length === 0,
    kind: parsed.kind,
    format,
    checksumOk,
    schemaVersion,
    exportedAt,
    fileName: file.name,
    sizeBytes: file.size,
    companyCount: companies.length,
    companies,
    totals,
    warnings,
    errors,
    raw:
      parsed.kind === "single"
        ? { kind: "single", data: parsed.data }
        : { kind: "multi", data: parsed.data },
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
