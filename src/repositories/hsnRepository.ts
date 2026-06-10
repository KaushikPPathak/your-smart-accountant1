// Typed repository for the local SQLite hsn_master table.
// All queries use parameterised SQL — never string-concat user input.

import { safeBrainSelect, safeBrainExec } from "@/brain/SqliteBrain";
import { ensureHsnSchema } from "@/lib/hsn/initHsnSchema";

export interface HsnRecord {
  hsn_code: string;
  description: string;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
  is_exempt: boolean;
}

interface RawHsnRow {
  hsn_code: string;
  description: string;
  cgst_rate: number | null;
  sgst_rate: number | null;
  igst_rate: number | null;
  is_exempt: number | null;
}

function toRecord(r: RawHsnRow): HsnRecord {
  return {
    hsn_code: r.hsn_code,
    description: r.description,
    cgst_rate: Number(r.cgst_rate ?? 0),
    sgst_rate: Number(r.sgst_rate ?? 0),
    igst_rate: Number(r.igst_rate ?? 0),
    is_exempt: Number(r.is_exempt ?? 0) === 1,
  };
}

export async function findHsnByCode(code: string): Promise<HsnRecord | null> {
  if (!code) return null;
  await ensureHsnSchema();
  const rows = await safeBrainSelect<RawHsnRow>(
    `SELECT hsn_code, description, cgst_rate, sgst_rate, igst_rate, is_exempt
     FROM hsn_master WHERE hsn_code = ? LIMIT 1`,
    [code.trim()],
  );
  return rows.length ? toRecord(rows[0]) : null;
}

export async function searchHsn(prefix: string, limit = 20): Promise<HsnRecord[]> {
  await ensureHsnSchema();
  const rows = await safeBrainSelect<RawHsnRow>(
    `SELECT hsn_code, description, cgst_rate, sgst_rate, igst_rate, is_exempt
     FROM hsn_master WHERE hsn_code LIKE ? ORDER BY hsn_code LIMIT ?`,
    [`${prefix}%`, limit],
  );
  return rows.map(toRecord);
}

export async function upsertHsn(rec: HsnRecord): Promise<{ ok: boolean; error?: string }> {
  await ensureHsnSchema();
  return safeBrainExec(
    `INSERT INTO hsn_master (hsn_code, description, cgst_rate, sgst_rate, igst_rate, is_exempt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(hsn_code) DO UPDATE SET
       description = excluded.description,
       cgst_rate = excluded.cgst_rate,
       sgst_rate = excluded.sgst_rate,
       igst_rate = excluded.igst_rate,
       is_exempt = excluded.is_exempt`,
    [
      rec.hsn_code.trim(),
      rec.description,
      rec.cgst_rate,
      rec.sgst_rate,
      rec.igst_rate,
      rec.is_exempt ? 1 : 0,
    ],
  );
}
