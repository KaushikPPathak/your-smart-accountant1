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

// Explicit database index to optimize the prefix-matching dropdown autocomplete logic 
// (e.g., WHERE hsn_code LIKE '9983%'). This keeps lookups under single-digit milliseconds.
const HSN_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_hsn_code ON hsn_master(hsn_code)
`;

let _ready: Promise<void> | null = null;

export function ensureHsnSchema(): Promise<void> {
  if (_ready) return _ready;
  _ready = (async () => {
    // Initialize the base table structure
    await safeBrainExec(HSN_MASTER_DDL);
    
    // Bind the optimization index to the table
    await safeBrainExec(HSN_INDEX_DDL);
    
    // Seed after schema is in place. Imported lazily to avoid a circular import
    // (seedHsnData re-exports ensureHsnSchema for its own bootstrap path).
    try {
      const { ensureHsnSeed } = await import("./seedHsnData");
      await ensureHsnSeed();
    } catch (error) {
      // Seed failures must never block the schema bootstrap.
      console.warn("HSN background seeding optimization bypassed safely:", error);
    }
  })();
  return _ready;
}
