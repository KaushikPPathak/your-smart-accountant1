// Tally / Busy import for the offline (local-only) build.
//
// Reads a Tally ledger-statement XML export (LVACCTITLE / DSPVCHDATE format,
// 100 MB+ supported by streaming), turns it into ledgers and two-sided
// vouchers, and writes them straight into the local Dexie cache, so they show
// in every report. Nothing is sent to a server.
//
// Not covered yet: Busy files, CSV/Excel/ZIP inputs, the standard
// <TALLYMESSAGE> voucher XML, stock items, and undo of an import.
import { type Database } from "@/integrations/supabase/types";
import { newId, getDbInstance } from "@/lib/utils/sys-utils";
import { emitDataChange } from "@/lib/ai/cache-events";
import {
  guessGroupCode, defaultLedgerTypeForGroup, type AccountSide,
} from "@/lib/account-groups";
import {
  parseDspStream, parseDspText, looksLikeDspExport, type DspBlock,
} from "@/lib/tally/dsp-ledger-xml";

export type LedgerType = Database["public"]["Enums"]["ledger_type"];
export type VoucherType = Database["public"]["Enums"]["voucher_type"];

export interface LedgerRecord {
  name: string;
  type: LedgerType;
  group?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  /** Opening balance in rupees. Positive = debit, negative = credit. */
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

export interface VoucherEntry {
  ledger: string;
  /** Rupees debited to this ledger (0 when credited). */
  debit: number;
  /** Rupees credited to this ledger (0 when debited). */
  credit: number;
}

export interface VoucherRecord {
  vtype: VoucherType;
  date: string;
  voucher_no: string;
  party?: string;
  total: number;
  narration?: string;
  original_voucher_id?: string;
  /** Two-sided postings, debit total equal to credit total. */
  entries?: VoucherEntry[];
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
  summary: any;
  source?: string;
  label?: string;
  file_name?: string;
  ledgers_created?: number;
  items_created?: number;
  vouchers_created?: number;
}

export interface LedgerMappingRow {
  external_name: string;
  local_ledger_id?: string;
  group_code?: string;
  ledger_type?: LedgerType;
  source_name?: string;
}

export interface FuzzySuggestion {
  name: string;
  score: number;
  id: string;
  index: number;
  source?: string;
  match?: any;
}

const lc = (s: string) => (s || "").toLowerCase().trim();
const cleanName = (s: string) => (s || "").replace(/\s+/g, " ").trim();
const paise = (rupees: number) => Math.round(Math.abs(rupees) * 100);

export function normalizeName(s: string) { return lc(s); }
export function similarity(a: string, b: string) { return a === b ? 1 : 0; }

const VOUCHER_TYPE_BY_TALLY: Record<string, VoucherType> = {
  sale: "sales", sales: "sales",
  purc: "purchase", purchase: "purchase",
  rcpt: "receipt", receipt: "receipt",
  pymt: "payment", payment: "payment",
  jrnl: "journal", journal: "journal",
  contra: "contra",
  "c/note": "credit_note", "credit note": "credit_note",
  "d/note": "debit_note", "debit note": "debit_note",
};

export function mapTallyVoucherType(text: string): VoucherType {
  return VOUCHER_TYPE_BY_TALLY[lc(text)] ?? "journal";
}

export function estimateBand(sizeBytes: number) {
  if (sizeBytes > 50 * 1024 * 1024) return { band: "large" as const, label: "Large", warn: true };
  if (sizeBytes > 5 * 1024 * 1024) return { band: "medium" as const, label: "Medium", warn: false };
  return { band: "small" as const, label: "Small", warn: false };
}

/**
 * Read the file. Tally ledger-statement XML is streamed block by block; each
 * account statement becomes one row. Other formats are not supported yet.
 */
export async function parseFileOrZip(file: File, _options?: unknown): Promise<ParsedRow[]> {
  const name = (file.name || "").toLowerCase();
  if (!name.endsWith(".xml")) {
    throw new Error(
      "Only Tally XML is supported right now. Export the ledger / day book as XML (Tally: Display → Ledger Vouchers → Alt+E → XML).",
    );
  }
  const head = await file.slice(0, 4096).text();
  if (!looksLikeDspExport(head)) {
    throw new Error(
      "This XML is not a Tally ledger statement export (no <LVACCTITLE> blocks). Re-export it from Tally as XML (Ledger Vouchers).",
    );
  }
  const rows: ParsedRow[] = [];
  await parseDspStream(file.stream(), (block) => {
    rows.push({ kind: "tally_block", block });
  });
  if (rows.length === 0) throw new Error("No ledger statements were found in this file.");
  return rows;
}

export const UNMATCHED_LEDGER = "TALLY UNMATCHED ENTRIES";

interface StatementEntry {
  owner: string;   // ledger whose statement lists this line
  counter: string;
  date: string;
  type: string;
  number: string;
  magnitude: number;
  side: "Dr" | "Cr"; // side of the owner
  used: boolean;
}

const pairKey = (owner: string, counter: string, date: string, type: string, number: string, magnitude: number, side: string) =>
  [owner, counter, date, type, number, magnitude.toFixed(2), side].join("|");

/**
 * Turn the statements into two-sided vouchers.
 *
 * Each ledger's own statement is the source for its balance, so every line of
 * every statement is posted on that ledger's side. A voucher listed in two
 * statements is written once, as a pair. A line whose other side is not found
 * in the other ledger's statement is posted on the visible side, and its
 * missing side goes to TALLY UNMATCHED ENTRIES so that totals still balance.
 * Those vouchers are counted in `unknown` and should be checked in Tally.
 */
export async function classifyAndMap(
  rows: ParsedRow[],
  onProgress?: ProgressCb,
  _settings?: unknown,
): Promise<{ ledgers: LedgerRecord[]; items: ItemRecord[]; vouchers: VoucherRecord[]; unknown: number }> {
  const blocks: DspBlock[] = rows.map((r) => r.block as DspBlock);
  const ledgerNames = new Map<string, string>(); // key -> display name
  const openingRaw = new Map<string, number>();  // key -> opening, Tally sign (negative = debit)
  const statementKeys = new Set<string>();        // ledgers that have their own statement
  const keyOf = (name: string) => lc(cleanName(name));
  const remember = (name: string) => {
    const clean = cleanName(name);
    const key = keyOf(clean);
    if (clean && !ledgerNames.has(key)) ledgerNames.set(key, clean);
    return key;
  };

  // 1. Collect statement lines and openings.
  const lines: StatementEntry[] = [];
  const index = new Map<string, StatementEntry[]>();
  blocks.forEach((block, i) => {
    if (onProgress && i % 50 === 0) onProgress(i, blocks.length, "Reading statements");
    const ownKey = remember(block.ledger);
    statementKeys.add(ownKey);
    if (block.opening !== undefined) {
      openingRaw.set(ownKey, (openingRaw.get(ownKey) ?? 0) + block.opening);
    }
    for (const e of block.entries) {
      if (!e.counter || e.amount === 0) continue;
      const counterKey = remember(e.counter);
      const magnitude = Math.abs(e.amount);
      const side: "Dr" | "Cr" = e.amount < 0 ? "Dr" : "Cr";
      const entry: StatementEntry = {
        owner: ownKey, counter: counterKey, date: e.date, type: lc(e.type),
        number: cleanName(e.number), magnitude, side, used: false,
      };
      lines.push(entry);
      const k = pairKey(ownKey, counterKey, entry.date, entry.type, entry.number, magnitude, side);
      const bucket = index.get(k);
      if (bucket) bucket.push(entry); else index.set(k, [entry]);
    }
  });

  // 2. Pair lines into vouchers.
  const vouchers: VoucherRecord[] = [];
  let unmatched = 0;
  const opposite = (side: "Dr" | "Cr") => (side === "Dr" ? "Cr" : "Dr");
  const debitCredit = (side: "Dr" | "Cr", amount: number) =>
    side === "Dr" ? { debit: amount, credit: 0 } : { debit: 0, credit: amount };
  const toVoucher = (
    entryA: { ledger: string; side: "Dr" | "Cr" },
    entryB: { ledger: string; side: "Dr" | "Cr" },
    amount: number,
    line: StatementEntry,
  ): VoucherRecord => {
    const a = debitCredit(entryA.side, amount);
    const b = debitCredit(entryB.side, amount);
    return {
      vtype: mapTallyVoucherType(line.type),
      date: line.date,
      voucher_no: line.number,
      party: entryA.ledger,
      total: amount,
      entries: [
        { ledger: entryA.ledger, ...a },
        { ledger: entryB.ledger, ...b },
      ],
    };
  };

  lines.forEach((line, i) => {
    if (onProgress && i % 2000 === 0) onProgress(i, lines.length, "Pairing vouchers");
    if (line.used) return;
    line.used = true;
    const ownerName = ledgerNames.get(line.owner) ?? line.owner;
    const counterName = ledgerNames.get(line.counter) ?? line.counter;

    if (!statementKeys.has(line.counter)) {
      // The other ledger has no statement in this file, so nothing to check against.
      vouchers.push(toVoucher({ ledger: ownerName, side: line.side }, { ledger: counterName, side: opposite(line.side) }, line.magnitude, line));
      return;
    }

    const partnerKey = pairKey(line.counter, line.owner, line.date, line.type, line.number, line.magnitude, opposite(line.side));
    const partner = (index.get(partnerKey) ?? []).find((x) => !x.used);
    if (partner) {
      partner.used = true;
      vouchers.push(toVoucher({ ledger: ownerName, side: line.side }, { ledger: counterName, side: opposite(line.side) }, line.magnitude, line));
      return;
    }

    unmatched++;
    vouchers.push(toVoucher({ ledger: ownerName, side: line.side }, { ledger: UNMATCHED_LEDGER, side: opposite(line.side) }, line.magnitude, line));
  });

  // 3. Movement per ledger across the vouchers.
  const netDebit = new Map<string, number>();
  for (const [key, raw] of openingRaw) netDebit.set(key, -raw);
  for (const v of vouchers) {
    for (const line of v.entries ?? []) {
      const key = line.ledger === UNMATCHED_LEDGER ? UNMATCHED_LEDGER : keyOf(line.ledger);
      netDebit.set(key, (netDebit.get(key) ?? 0) + line.debit - line.credit);
    }
  }

  // 4. Ledger masters.
  const ledgers: LedgerRecord[] = [];
  for (const [key, name] of ledgerNames) {
    const net = netDebit.get(key) ?? 0;
    const side: AccountSide = net >= 0 ? "Dr" : "Cr";
    const groupCode = guessGroupCode(name, side);
    ledgers.push({
      name,
      group_code: groupCode,
      group: groupCode,
      type: defaultLedgerTypeForGroup(groupCode) as LedgerType,
      opening: -(openingRaw.get(key) ?? 0),
    });
  }
  if (unmatched > 0) {
    const net = netDebit.get(UNMATCHED_LEDGER) ?? 0;
    const groupCode = net >= 0 ? "CURRENT_ASSETS" : "CURRENT_LIABILITIES";
    ledgers.push({
      name: UNMATCHED_LEDGER,
      group_code: groupCode,
      group: groupCode,
      type: defaultLedgerTypeForGroup(groupCode) as LedgerType,
      opening: 0,
    });
  }

  return { ledgers, items: [], vouchers, unknown: unmatched };
}

/** Write ledgers into the local cache. Ledgers already present by name are skipped. */
export async function postLedgers(
  companyId: string,
  rows: LedgerRecord[],
  onProgress?: ProgressCb,
  _batchId?: string,
): Promise<PostResultEx> {
  const db = await getDbInstance();
  const existing: Array<{ name: string; is_deleted?: boolean }> = await db.cache_ledgers
    .where("company_id").equals(companyId).toArray();
  const have = new Set(existing.filter((r) => !r.is_deleted).map((r) => lc(r.name)));
  const result: PostResultEx = { created: 0, updated: 0, skipped: 0, failed: [] };
  const now = new Date().toISOString();
  const fresh: Record<string, unknown>[] = [];

  rows.forEach((row, i) => {
    if (onProgress && i % 200 === 0) onProgress(i, rows.length, "Saving ledgers");
    const name = cleanName(row.name);
    if (!name) { result.failed.push({ name: "(blank)", reason: "Ledger name is empty" }); return; }
    if (have.has(lc(name))) { result.skipped++; return; }
    have.add(lc(name));
    const opening = row.opening ?? 0;
    fresh.push({
      id: newId(),
      company_id: companyId,
      name,
      type: row.type,
      group_code: row.group_code ?? row.group ?? null,
      subgroup_id: null,
      opening_balance_paise: paise(opening),
      opening_balance_is_debit: opening >= 0,
      is_deleted: false,
      is_synced: true,
      created_at: now,
      updated_at: now,
    });
  });

  if (fresh.length > 0) await db.cache_ledgers.bulkPut(fresh);
  result.created = fresh.length;
  if (onProgress) onProgress(rows.length, rows.length, "Ledgers saved");
  if (fresh.length > 0) emitDataChange(companyId, "ledger");
  return result;
}

export async function postItems(
  _companyId: string,
  _rows: ItemRecord[],
  _onProgress?: ProgressCb,
  _batchId?: string,
): Promise<PostResultEx> {
  // Stock items are not imported from Ledger Vouchers exports yet.
  return { created: 0, updated: 0, skipped: 0, failed: [] };
}

const VOUCHER_BATCH = 300;

/**
 * Write vouchers and their entries into the local cache. Vouchers whose type
 * and number already exist for the date are skipped. Vouchers whose ledgers
 * are missing, or whose debits and credits differ, are reported as failed.
 */
export async function postVouchers(
  companyId: string,
  rows: VoucherRecord[],
  onProgress?: ProgressCb,
  _batchId?: string,
): Promise<PostResultEx> {
  const db = await getDbInstance();
  const ledgerRows: Array<{ id: string; name: string; is_deleted?: boolean }> = await db.cache_ledgers
    .where("company_id").equals(companyId).toArray();
  const ledgerId = new Map<string, string>();
  for (const l of ledgerRows) if (!l.is_deleted) ledgerId.set(lc(l.name), l.id);

  // Numbers repeat in Tally exports (several receipts can share a number on one
  // day), so a voucher is only treated as already imported when type, number,
  // date and amount all match a stored voucher. Matches are counted, so two
  // identical stored vouchers allow two identical incoming vouchers.
  const existingVouchers: Array<{ voucher_type: string; voucher_number: string; voucher_date: string; total_paise?: number; is_deleted?: boolean }> =
    await db.cache_vouchers.where("company_id").equals(companyId).toArray();
  const storedCount = new Map<string, number>();
  for (const v of existingVouchers) {
    if (v.is_deleted || !v.voucher_number) continue;
    const k = `${v.voucher_type}|${v.voucher_number}|${v.voucher_date}|${v.total_paise ?? 0}`;
    storedCount.set(k, (storedCount.get(k) ?? 0) + 1);
  }

  const result: PostResultEx = { created: 0, updated: 0, skipped: 0, failed: [] };
  const now = new Date().toISOString();
  let pending: { vouchers: Record<string, unknown>[]; entries: Record<string, unknown>[] } = { vouchers: [], entries: [] };

  const flush = async () => {
    if (pending.vouchers.length === 0) return;
    await db.transaction("rw", db.cache_vouchers, db.cache_voucher_entries, async () => {
      await db.cache_vouchers.bulkPut(pending.vouchers);
      await db.cache_voucher_entries.bulkPut(pending.entries);
    });
    result.created += pending.vouchers.length;
    pending = { vouchers: [], entries: [] };
  };

  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];
    if (onProgress && i % 100 === 0) onProgress(i, rows.length, "Saving vouchers");
    const label = `${v.vtype} ${v.voucher_no || "(no no.)"} ${v.date}`;

    const lines = v.entries ?? [];
    if (lines.length < 2) { result.failed.push({ name: label, reason: "Voucher has fewer than two entries" }); continue; }
    const missing = lines.find((l) => !ledgerId.has(lc(l.ledger)));
    if (missing) { result.failed.push({ name: label, reason: `Ledger not found: ${missing.ledger}` }); continue; }
    const debitPaise = lines.reduce((s, l) => s + paise(l.debit), 0);
    const creditPaise = lines.reduce((s, l) => s + paise(l.credit), 0);
    if (debitPaise !== creditPaise) {
      result.failed.push({ name: label, reason: "Debits and credits differ" });
      continue;
    }
    if (v.voucher_no) {
      const k = `${v.vtype}|${v.voucher_no}|${v.date}|${debitPaise}`;
      const left = storedCount.get(k) ?? 0;
      if (left > 0) {
        storedCount.set(k, left - 1);
        result.skipped++;
        continue;
      }
    }

    const voucherId = newId();
    pending.vouchers.push({
      id: voucherId,
      company_id: companyId,
      voucher_type: v.vtype,
      voucher_number: v.voucher_no || "",
      voucher_date: v.date,
      party_ledger_id: null,
      reference_no: null,
      narration: v.narration ?? null,
      is_interstate: false,
      subtotal_paise: debitPaise,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      round_off_paise: 0,
      total_paise: debitPaise,
      is_deleted: false,
      is_synced: true,
      created_at: now,
      updated_at: now,
    });
    lines.forEach((l, idx) => {
      pending.entries.push({
        id: newId(),
        voucher_id: voucherId,
        company_id: companyId,
        ledger_id: ledgerId.get(lc(l.ledger)),
        debit_paise: paise(l.debit),
        credit_paise: paise(l.credit),
        narration: null,
        line_no: idx + 1,
        updated_at: now,
      });
    });

    if (pending.vouchers.length >= VOUCHER_BATCH) await flush();
  }
  await flush();

  if (onProgress) onProgress(rows.length, rows.length, "Vouchers saved");
  if (result.created > 0) emitDataChange(companyId, "voucher");
  return result;
}

export async function createImportBatch(_companyId: string, _info: unknown): Promise<string> {
  return newId();
}

export async function finalizeImportBatch(_id: string, _summary: unknown): Promise<any> {
  return {};
}

export async function fetchLedgerMappings(_companyId: string): Promise<Map<string, LedgerMappingRow>> {
  return new Map();
}

export async function saveLedgerMappings(_companyId: string, _mappings: unknown): Promise<{ saved: number }> {
  return { saved: 0 };
}

export function applyMappingsToLedgers(ledgers: LedgerRecord[], _mappings: Map<string, LedgerMappingRow>) {
  return ledgers;
}

export async function listImportBatches(_companyId: string): Promise<ImportBatchRow[]> {
  return [];
}

export async function deleteImportBatch(_id: string): Promise<any> {
  return {};
}

export async function bulkDeleteVouchers(_companyId: string, _type: VoucherType, _range?: unknown): Promise<any> {
  // Undo of an import is not implemented yet.
  return 0;
}

export function buildFuzzySuggestions(_ledgers: LedgerRecord[], _mappings: Map<string, LedgerMappingRow>, _threshold: number): FuzzySuggestion[] {
  return [];
}

export function applyFuzzySuggestions(ledgers: LedgerRecord[], _suggestions: FuzzySuggestion[]) {
  return ledgers;
}

export async function yieldToUI() { await new Promise((r) => setTimeout(r, 0)); }

/** Parse a whole XML string into statements (used by tests and small files). */
export function parseTallyStatementsText(xml: string): DspBlock[] {
  return parseDspText(xml);
}
