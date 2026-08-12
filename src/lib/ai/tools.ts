// src/lib/ai/tools.ts
// Client-side tool registry for the AI assistant.
// Tier 3: typed tools the model can call to fetch exactly what it needs.
// The tool loop runs entirely on-device against IndexedDB — no server round-trips.
// Transport uses a plain text convention so it works over both local WebLLM
// and cloud edge functions without native function-call support.

import { routeQuery, normalizeVoiceInput } from "./query-router";
import { retrieveForQuery } from "./retrievers";
import { readCompanies, readLedgers, readVouchers } from "@/lib/offline/cache-read";
import { openDB, DBSchema, IDBPDatabase } from "idb";

// ═════════════════════════════════════════════════════════════════════════════
//  TOOL CATALOG
// ═════════════════════════════════════════════════════════════════════════════

export interface ToolDescriptor {
  name: string;
  description: string;
  argsHint: string;
}

export const TOOL_CATALOG: ToolDescriptor[] = [
  {
    name: "get_party_balance",
    description:
      "Closing balance and mode split (cash vs bank) for a party ledger, optionally frozen at a date.",
    argsHint: `{ "name": string, "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_cash_balance",
    description:
      "Closing balance of the Cash ledger or a named bank account, optionally frozen at a date.",
    argsHint: `{ "account"?: "cash" | string /* bank name */, "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "list_vouchers",
    description:
      "Vouchers in a date range, optionally filtered by kind. Returns id, number, date, party, total.",
    argsHint: `{ "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD", "kind"?: "sales"|"purchase"|"receipt"|"payment"|"journal", "limit"?: number }`,
  },
  {
    name: "get_voucher",
    description:
      "Full detail of a single voucher: header, entries with ledger names, items with HSN/qty/rate.",
    argsHint: `{ "number": string }`,
  },
  {
    name: "get_trial_balance",
    description:
      "Trial balance snapshot — every ledger with opening, debit, credit, closing.",
    argsHint: `{}`,
  },
];

/** System-prompt fragment describing the tool contract to the model. */
export function toolCatalogPrompt(): string {
  const lines = [
    "TOOLS AVAILABLE — you may call any of these instead of answering from memory.",
    "Emit EXACTLY one JSON block on its own line in this form:",
    "",
    '  [[TOOL_CALL {"name":"<tool>","args":{...}}]]',
    "",
    "Stop generating after the block — the client will run the tool and reply with the result.",
    "You may then call another tool or write the final answer.",
    "Never invent tool names or arguments.",
    "",
  ];
  for (const t of TOOL_CATALOG) {
    lines.push(`- ${t.name}${t.argsHint} — ${t.description}`);
  }
  return lines.join("\n");
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOOL CALL PARSING
// ═════════════════════════════════════════════════════════════════════════════

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
  raw: string;
}

const TOOL_CALL_RE = /\[\[TOOL_CALL\s+(\{[\s\S]*?\})\s*\]\]/;

export function parseToolCall(text: string): ParsedToolCall | null {
  const m = text.match(TOOL_CALL_RE);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (!parsed || typeof parsed !== "object") return null;
    const name = String(parsed.name ?? "");
    const args = (parsed.args ?? {}) as Record<string, unknown>;
    if (!name) return null;
    return { name, args, raw: m[0] };
  } catch {
    return null;
  }
}

export function stripToolCall(text: string): string {
  return text.replace(TOOL_CALL_RE, "").trim();
}

// ═════════════════════════════════════════════════════════════════════════════
//  INDEXEDDB SCHEMA (for tool results caching)
// ═════════════════════════════════════════════════════════════════════════════

interface ToolCacheDB extends DBSchema {
  tool_results: {
    key: string;
    value: {
      key: string;
      result: unknown;
      ts: number;
    };
  };
}

let _dbPromise: Promise<IDBPDatabase<ToolCacheDB>> | null = null;

function getToolCacheDB(): Promise<IDBPDatabase<ToolCacheDB>> {
  if (!_dbPromise) {
    _dbPromise = openDB<ToolCacheDB>("ai-tool-cache", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("tool_results")) {
          db.createObjectStore("tool_results", { keyPath: "key" });
        }
      },
    });
  }
  return _dbPromise;
}

// In-memory LRU for sub-millisecond repeat hits
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  constructor(private maxSize: number) {}
  get(key: K): V | undefined {
    const val = this.cache.get(key);
    if (val !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, val);
    }
    return val;
  }
  set(key: K, value: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value as K;
      this.cache.delete(first);
    }
    this.cache.set(key, value);
  }
  clear(): void {
    this.cache.clear();
  }
}

const _memCache = new LRUCache<string, unknown>(50);

function cacheKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args)}`;
}

async function getCached<T>(name: string, args: Record<string, unknown>): Promise<T | undefined> {
  const key = cacheKey(name, args);
  const mem = _memCache.get(key) as T | undefined;
  if (mem !== undefined) return mem;

  try {
    const db = await getToolCacheDB();
    const row = await db.get("tool_results", key);
    if (row && Date.now() - row.ts < 30_000) {
      // 30-second TTL
      _memCache.set(key, row.result);
      return row.result as T;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

async function setCached(name: string, args: Record<string, unknown>, result: unknown): Promise<void> {
  const key = cacheKey(name, args);
  _memCache.set(key, result);
  try {
    const db = await getToolCacheDB();
    await db.put("tool_results", { key, result, ts: Date.now() });
  } catch {
    /* ignore */
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOOL RESULT TYPE
// ═════════════════════════════════════════════════════════════════════════════

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
  latencyMs: number;
}

// ═════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════════════════

async function activeCompanyId(): Promise<string | null> {
  if (typeof window !== "undefined") {
    try {
      const id = localStorage.getItem("ym_active_company_id");
      if (id) return id;
    } catch {
      /* ignore */
    }
  }
  const cs = (await readCompanies()) as any[];
  return cs[0]?.id ? String(cs[0].id) : null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOOL EXECUTORS
// ═════════════════════════════════════════════════════════════════════════════

async function execGetPartyBalance(args: Record<string, unknown>): Promise<ToolResult> {
  const start = performance.now();
  const name = String(args.name ?? "").trim();
  const asOn = args.asOn ? String(args.asOn) : undefined;
  if (!name) return { success: false, error: "missing 'name'", latencyMs: Math.round(performance.now() - start) };

  const cached = await getCached("get_party_balance", args);
  if (cached) return { success: true, data: cached, cached: true, latencyMs: 0 };

  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const q = `balance of ${name}${asOn ? ` as on ${asOn}` : ""}`;
  const routed = routeQuery(q);
  const slice = await retrieveForQuery(routed, cid);
  const result = { scope: slice.scope, facts: slice.facts, vouchers: (slice.data.vouchers as any[])?.slice(0, 10) };

  await setCached("get_party_balance", args, result);
  return { success: true, data: result, latencyMs: Math.round(performance.now() - start) };
}

async function execGetCashBalance(args: Record<string, unknown>): Promise<ToolResult> {
  const start = performance.now();
  const account = String(args.account ?? "cash").trim();
  const asOn = args.asOn ? String(args.asOn) : undefined;

  const cached = await getCached("get_cash_balance", args);
  if (cached) return { success: true, data: cached, cached: true, latencyMs: 0 };

  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const q = `balance of ${account}${asOn ? ` as on ${asOn}` : ""}`;
  const routed = routeQuery(q);
  routed.intent = "party_balance";
  const slice = await retrieveForQuery(routed, cid);
  const result = { scope: slice.scope, facts: slice.facts };

  await setCached("get_cash_balance", args, result);
  return { success: true, data: result, latencyMs: Math.round(performance.now() - start) };
}

async function execListVouchers(args: Record<string, unknown>): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const from = args.from ? String(args.from) : undefined;
  const to = args.to ? String(args.to) : undefined;
  const kind = args.kind ? String(args.kind) : undefined;
  const limit = Math.min(Number(args.limit ?? 50), 200);

  const cached = await getCached("list_vouchers", args);
  if (cached) return { success: true, data: cached, cached: true, latencyMs: 0 };

  const all = (await readVouchers(cid, { from, to })) as any[];
  const filtered = kind ? all.filter((v) => String(v.voucher_type) === kind) : all;
  const ledgers = kind ? ((await readLedgers(cid)) as any[]) : [];
  const lById = new Map(ledgers.map((l) => [String(l.id), l.name]));

  const result = {
    count: filtered.length,
    vouchers: filtered.slice(0, limit).map((v) => ({
      id: v.id,
      number: v.voucher_number,
      date: v.voucher_date,
      kind: v.voucher_type,
      total_paise: v.total_paise,
      party: v.party_ledger_id ? (lById.get(String(v.party_ledger_id)) ?? null) : null,
    })),
  };

  await setCached("list_vouchers", args, result);
  return { success: true, data: result, latencyMs: Math.round(performance.now() - start) };
}

async function execGetVoucher(args: Record<string, unknown>): Promise<ToolResult> {
  const start = performance.now();
  const number = String(args.number ?? "").trim();
  if (!number) return { success: false, error: "missing 'number'", latencyMs: Math.round(performance.now() - start) };

  const cached = await getCached("get_voucher", args);
  if (cached) return { success: true, data: cached, cached: true, latencyMs: 0 };

  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const routed = routeQuery(`voucher ${number}`);
  (routed as any).voucherNumber = number;
  routed.intent = "voucher_lookup";
  const slice = await retrieveForQuery(routed, cid);
  const result = { scope: slice.scope, data: slice.data, facts: slice.facts };

  await setCached("get_voucher", args, result);
  return { success: true, data: result, latencyMs: Math.round(performance.now() - start) };
}

async function execGetTrialBalance(): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const cached = await getCached("get_trial_balance", {});
  if (cached) return { success: true, data: cached, cached: true, latencyMs: 0 };

  const routed = routeQuery("trial balance");
  routed.intent = "trial_balance";
  const slice = await retrieveForQuery(routed, cid);
  const result = { scope: slice.scope, data: slice.data, facts: slice.facts };

  await setCached("get_trial_balance", {}, result);
  return { success: true, data: result, latencyMs: Math.round(performance.now() - start) };
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN EXECUTE GATE
// ═════════════════════════════════════════════════════════════════════════════

export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case "get_party_balance":
      return execGetPartyBalance(args);
    case "get_cash_balance":
      return execGetCashBalance(args);
    case "list_vouchers":
      return execListVouchers(args);
    case "get_voucher":
      return execGetVoucher(args);
    case "get_trial_balance":
      return execGetTrialBalance();
    default:
      return { success: false, error: `unknown tool: ${name}`, latencyMs: 0 };
  }
}

/** Run a tool call block end-to-end: parse → execute → return result. */
export async function runToolCallBlock(text: string): Promise<{ result: ToolResult; strippedText: string } | null> {
  const parsed = parseToolCall(text);
  if (!parsed) return null;
  const result = await executeTool(parsed.name, parsed.args);
  return { result, strippedText: stripToolCall(text) };
}

// ═════════════════════════════════════════════════════════════════════════════
//  CACHE INVALIDATION
// ═════════════════════════════════════════════════════════════════════════════

export function invalidateToolCache(pattern?: string): void {
  _memCache.clear();
  // IndexedDB cache clear is async; fire and forget
  getToolCacheDB()
    .then(async (db) => {
      if (!pattern) {
        await db.clear("tool_results");
      } else {
        const all = await db.getAll("tool_results");
        const toDelete = all.filter((r) => r.key.includes(pattern)).map((r) => r.key);
        for (const key of toDelete) await db.delete("tool_results", key);
      }
    })
    .catch(() => undefined);
}

// ═════════════════════════════════════════════════════════════════════════════
//  VOICE HELPERS
// ═════════════════════════════════════════════════════════════════════════════

export { normalizeVoiceInput };
