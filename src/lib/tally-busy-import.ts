import { supabase } from "@/integrations/supabase/client";
import { type Database } from "@/integrations/supabase/types";

export type LedgerType = Database["public"]["Enums"]["ledger_type"];
export type VoucherType = Database["public"]["Enums"]["voucher_type"];

export interface LedgerRecord { 
  name: string; 
  type: LedgerType; 
  group?: string; 
  phone?: string; 
  email?: string;
  gstin?: string;
  opening?: number;
  group_code?: string;
}

export interface ItemRecord { 
  name: string; 
  unit?: string; 
  hsn?: string; 
  rate?: number;
  gst_rate?: number;
  opening_qty?: number;
  opening_rate?: number;
  sale_price?: number;
}

export interface VoucherRecord { 
  vtype: VoucherType; 
  date: string; 
  voucher_no: string; 
  party?: string; 
  total: number; 
  narration?: string;
  original_voucher_id?: string;
}

export interface ParsedRow { [key: string]: any }
export interface PostResult { created: number; updated: number; skipped: number }
export interface PostResultEx extends PostResult { failed: { name: string; reason: string }[] }
export type ProgressCb = (done: number, total: number, label?: string) => void;

export type EncodingChoice = "utf8" | "utf16le" | "win1252";

export interface ImportSettings {
  encoding: EncodingChoice;
  previewLimit: number;
  chunkSize: number;
  skipDuplicates: boolean;
  autoCreateMasters: boolean;
  stripNuls?: boolean;
}

export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  encoding: "utf8",
  previewLimit: 100,
  chunkSize: 1000,
  skipDuplicates: true,
  autoCreateMasters: true,
  stripNuls: false,
};

export interface ImportBatchRow {
  id: string;
  company_id: string;
  created_at: string;
  kind: string;
  status: string;
  summary: {
    ledgers?: number;
    items?: number;
    vouchers?: number;
    ledgers_created?: number;
    items_created?: number;
    vouchers_created?: number;
  };
  source?: string;
  label?: string;
  file_name?: string;
}

export interface LedgerMappingRow {
  external_name: string;
  local_ledger_id?: string;
  group_code?: string;
  ledger_type?: LedgerType;
}

export interface FuzzySuggestion {
  name: string;
  score: number;
  id: string;
  index?: number;
  source?: string;
  match?: string;
}

const lc = (s: string) => (s || "").toLowerCase().trim();

export function normalizeName(s: string) { return lc(s); }
export function similarity(a: string, b: string) { return a === b ? 1 : 0; }

export async function parseFileOrZip(file: File, options?: any): Promise<ParsedRow[]> { return []; }
export function estimateBand(sizeBytes: number) { return { band: "medium" as const, label: "Medium", warn: false }; }
export async function classifyAndMap(rows: ParsedRow[], onProgress?: ProgressCb, settings?: any): Promise<{ ledgers: LedgerRecord[]; items: ItemRecord[]; vouchers: VoucherRecord[]; unknown: number }> {
  return { ledgers: [], items: [], vouchers: [], unknown: 0 };
}

export async function postLedgers(companyId: string, rows: LedgerRecord[], onProgress?: ProgressCb, batchId?: string): Promise<PostResultEx> {
  return { created: 0, updated: 0, skipped: 0, failed: [] };
}

export async function postItems(companyId: string, rows: ItemRecord[], onProgress?: ProgressCb, batchId?: string): Promise<PostResultEx> {
  return { created: 0, updated: 0, skipped: 0, failed: [] };
}

export async function postVouchers(companyId: string, rows: VoucherRecord[], onProgress?: ProgressCb, batchId?: string): Promise<PostResultEx> {
  return { created: 0, updated: 0, skipped: 0, failed: [] };
}

export async function createImportBatch(companyId: string, info: any): Promise<string> { return "batch-id"; }
export async function finalizeImportBatch(id: string, summary: any) {}
export async function fetchLedgerMappings(companyId: string): Promise<{ saved: LedgerMappingRow[] }> { return { saved: [] }; }
export async function saveLedgerMappings(companyId: string, mappings: any) { return { saved: [] }; }
export function applyMappingsToLedgers(ledgers: LedgerRecord[], mappings: any[]) { return ledgers; }
export async function listImportBatches(companyId: string): Promise<ImportBatchRow[]> { return []; }
export async function deleteImportBatch(id: string) {}
export async function bulkDeleteVouchers(companyId: string, type: VoucherType, range?: any) { return 0; }
export function buildFuzzySuggestions(names: string[], target: string[]): FuzzySuggestion[] { return []; }
export function applyFuzzySuggestions(mappings: any, suggestions: any) { return mappings; }
export async function yieldToUI() { await new Promise(r => setTimeout(r, 0)); }
