// Idempotent schema bootstrap for the local HSN master table.
// Runs once per session; safe to call repeatedly (CREATE TABLE IF NOT EXISTS).

import { safeBrainExec } from "@/brain/SqliteBrain";

const HSN_MASTER_DDL = `
CREATE TABLE IF NOT EXISTS hsn_master (
  hsn_code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  cgst_rate REAL DEFAULT 0.0,
  sgst_rate REAL DEFAULT 0.0,
  igst_rate REAL DEFAULT 0.0,
  is_exempt INTEGER DEFAULT 0
)`;

let _ready: Promise<void> | null = null;

export function ensureHsnSchema(): Promise<void> {
  if (_ready) return _ready;
  _ready = (async () => {
    await safeBrainExec(HSN_MASTER_DDL);
  })();
  return _ready;
}
