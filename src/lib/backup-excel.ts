/**
 * Human-readable Excel companion to a company JSON backup. The JSON stays the
 * restore source; this workbook is only for reading and checking the data.
 * It reads the backup payload and never changes it.
 */
import { writeSpreadsheet, type SheetCell, type WriteSheet } from "./spreadsheet";
import type { CompanyBackup } from "./backup";

function cell(v: unknown): SheetCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return JSON.stringify(v);
}

/** One sheet from a list of records: header = every key seen, in first-seen order. */
function recordsSheet(name: string, records: Record<string, unknown>[]): WriteSheet {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const rows: SheetCell[][] = [keys];
  for (const r of records) rows.push(keys.map((k) => cell(r[k])));
  return { name, rows };
}

export async function buildBackupWorkbook(backup: CompanyBackup): Promise<ArrayBuffer> {
  const company = (backup.company ?? {}) as Record<string, unknown>;
  const summary: SheetCell[][] = [
    ["Item", "Value"],
    ["Company", cell(company.name ?? "")],
    ["Exported at", backup.exported_at],
    ["Backup schema version", backup.schema_version],
    ["Ledgers", backup.ledgers.length],
    ["Items", backup.items.length],
    ["Vouchers", backup.vouchers.length],
    ["Voucher item lines", backup.voucher_items.length],
    ["Voucher entry lines", backup.voucher_entries.length],
    ["Note", "This Excel file is a readable copy. Restore uses the JSON backup."],
  ];
  const sheets: WriteSheet[] = [
    { name: "Summary", rows: summary },
    recordsSheet("Ledgers", backup.ledgers),
    recordsSheet("Items", backup.items),
    recordsSheet("Vouchers", backup.vouchers),
    recordsSheet("Voucher items", backup.voucher_items),
    recordsSheet("Voucher entries", backup.voucher_entries),
  ];
  return writeSpreadsheet(sheets);
}
