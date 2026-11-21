import { onDataChange } from "./cache-events";
import { validateDateArgs } from "./ai-validation";
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
    name: "get_party_ledger",
    description:
      "Detailed statement/ledger of all transactions for a party, optionally within a date range.",
    argsHint: `{ "name": string, "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_cash_bank_total",
    description:
      "Sum of the closing balances of all cash and bank ledgers, optionally frozen at a date. Overdrawn banks count negative.",
    argsHint: `{ "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_sales_total",
    description:
      "Total of sales vouchers in a period, defaulting to the current financial year. Credit notes are not deducted.",
    argsHint: `{ "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_bank_anomalies",
    description:
      "Cash and bank ledgers whose latest posted month has an outflow at least 2x their earlier monthly average (and at least Rs 10,000).",
    argsHint: `{ "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_cash_runway",
    description:
      "Days of cash runway: current cash and bank position divided by the average monthly net burn of the three full months before the latest posting.",
    argsHint: `{ "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_credit_watch",
    description:
      "Customers whose receivable is above their credit limit (where set) or has balances older than 30 days. Opening balances count as overdue.",
    argsHint: `{ "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_customer_ranking",
    description:
      "Top 10 customers by sales revenue in a period (default current financial year) and top 10 by balance older than 30 days as on the period end.",
    argsHint: `{ "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_vendor_overdue",
    description:
      "Vendors with payables older than 30 days, and vendors with unadjusted advances or debit notes (excess paid over their bills).",
    argsHint: `{ "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_stock_movement",
    description:
      "Items on hand classified as fast-moving, normal, slow-moving or dead, by days since the last stock movement and the number of movements in the last 30 days, as on a date.",
    argsHint: `{ "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_item_stock",
    description:
      "Quantity and valuation of one stock item as on a date: opening stock plus movements, valued at the last purchase rate. Godowns are not recorded, so the figure covers all godowns.",
    argsHint: `{ "item": string, "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_returns_summary",
    description:
      "Sales returns (credit notes) and purchase returns (debit notes) in a period, default the current financial-year quarter, with value, count and each voucher's narration as the reason.",
    argsHint: `{ "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_monthly_trend",
    description:
      "Revenue (net credit to sales ledgers), expenses (net debit to direct and indirect expense ledgers) and net by month for a period (default current financial year), with month-on-month change.",
    argsHint: `{ "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_vendor_concentration",
    description:
      "Vendors ranked by gross purchase spend in a period, with each share and the cumulative share, up to the vendor that takes the total to 80%.",
    argsHint: `{ "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_duplicate_check",
    description:
      "Purchase bills from one vendor with the same bill number, the same payment amount paid to a vendor within 30 days, and purchase prices more than 25% above the vendor's previous rate for the item.",
    argsHint: `{ "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_vendor_spend_cycle",
    description:
      "For one vendor: purchase spend in a period (default six months to the latest posting), and the average days to pay, matching payments to the oldest bills (FIFO).",
    argsHint: `{ "vendor": "ledger name", "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
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
    name: "get_journal_book",
    description: "Detailed list of all Journal vouchers, optionally within a date range.",
    argsHint: `{ "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
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
      "Trial balance snapshot — every ledger with opening, debit, credit, closing, plus total Dr/Cr.",
    argsHint: `{ "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_party_summary",
    description:
      "Receivables (debtors) or payables (creditors) by party, largest first, with ageing buckets from bill dates.",
    argsHint: `{ "side": "receivable" | "payable", "asOn"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_profit_loss",
    description:
      "Profit and Loss account summary, grouped by direct/indirect income and expense.",
    argsHint: `{ "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" }`,
  },
  {
    name: "get_stock_summary",
    description:
      "Closing stock summary for all inventory items.",
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
  // In-memory cache is updated synchronously so callers are never delayed.
  _memCache.set(key, result);
  // IndexedDB persistence is fire-and-forget; failures are swallowed so no
  // unhandled rejection can escape.
  void (async () => {
    try {
      const db = await getToolCacheDB();
      await db.put("tool_results", { key, result, ts: Date.now() });
    } catch {
      /* ignore */
    }
  })();
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

/**
 * Adapter over the authoritative Accounting Query Engine.
 * The engine is the only calculator for party / cash / bank balances; results
 * are returned verbatim and never cached, so every answer reflects the current
 * books. Ambiguous or unknown ledgers return a clarification, never a number.
 */
async function execEngineBalance(
  kind: "party_balance" | "cash_balance" | "bank_balance",
  name: string | undefined,
  asOn: string | undefined,
): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const {
    runAccountingQuery,
    AMBIGUOUS_LEDGER_MESSAGE,
    LEDGER_NOT_FOUND_MESSAGE,
  } = await import("./accounting-query-engine");

  const res = await runAccountingQuery({ kind, name, asOn: asOn ?? null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);

  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  if (res.status === "ambiguous") {
    return {
      success: true,
      data: { clarification: AMBIGUOUS_LEDGER_MESSAGE, candidates: res.candidates, facts: {} },
      latencyMs,
    };
  }
  if (res.status === "not_found") {
    return { success: true, data: { clarification: LEDGER_NOT_FOUND_MESSAGE, facts: {} }, latencyMs };
  }

  return {
    success: true,
    data: {
      scope: `${res.ledgerName}${res.asOn ? ` as on ${res.asOn}` : ""} (${res.entryCount} entries)`,
      facts: {
        as_on_date: res.asOn,
        account_id: res.ledgerId,
        account_name: res.ledgerName,
        resolved_party_name: res.ledgerName,
        resolved_party_group: res.ledgerGroup,
        opening_balance_paise: res.openingPaise,
        total_debit_paise: res.debitPaise,
        total_credit_paise: res.creditPaise,
        closing_balance_paise: res.closingPaise,
        current_balance_paise: res.closingPaise,
        direction: res.direction,
        entry_count: res.entryCount,
      },
    },
    latencyMs,
  };
}

async function execGetPartyBalance(args: Record<string, unknown>): Promise<ToolResult> {
  const name = String(args.name ?? "").trim();
  const asOn = args.asOn ? String(args.asOn) : undefined;
  if (!name) return { success: false, error: "missing 'name'", latencyMs: 0 };
  return execEngineBalance("party_balance", name, asOn);
}

async function execGetPartyLedger(args: Record<string, unknown>): Promise<ToolResult> {
  const start = performance.now();
  const name = String(args.name ?? "").trim();
  const from = args.from ? String(args.from) : undefined;
  const to = args.to ? String(args.to) : undefined;
  if (!name) return { success: false, error: "missing 'name'", latencyMs: Math.round(performance.now() - start) };

  const cached = await getCached("get_party_ledger", args);
  if (cached) return { success: true, data: cached, cached: true, latencyMs: 0 };

  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const q = `ledger of ${name}${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}`;
  const routed = routeQuery(q);
  routed.intent = "party_ledger";
  const slice = await retrieveForQuery(routed, cid);
  const result = { scope: slice.scope, facts: slice.facts, entries: slice.data.entries };

  await setCached("get_party_ledger", args, result);
  return { success: true, data: result, latencyMs: Math.round(performance.now() - start) };
}

async function execGetProfitLoss(args: Record<string, unknown>): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const from = args.from ? String(args.from) : undefined;
  const to = args.to ? String(args.to) : undefined;

  const cached = await getCached("get_profit_loss", args);
  if (cached) return { success: true, data: cached, cached: true, latencyMs: 0 };

  const q = "profit and loss";
  const routed = routeQuery(q);
  routed.from = from;
  routed.to = to;
  routed.intent = "profit_loss";
  const slice = await retrieveForQuery(routed, cid);
  const result = { scope: slice.scope, facts: slice.facts, data: slice.data };

  await setCached("get_profit_loss", args, result);
  return { success: true, data: result, latencyMs: Math.round(performance.now() - start) };
}

async function execGetStockSummary(): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const cached = await getCached("get_stock_summary", {});
  if (cached) return { success: true, data: cached, cached: true, latencyMs: 0 };

  const q = "closing stock";
  const routed = routeQuery(q);
  routed.intent = "stock_query";
  const slice = await retrieveForQuery(routed, cid);
  const result = { scope: slice.scope, facts: slice.facts, data: slice.data };

  await setCached("get_stock_summary", {}, result);
  return { success: true, data: result, latencyMs: Math.round(performance.now() - start) };
}

async function execGetCashBalance(args: Record<string, unknown>): Promise<ToolResult> {
  const account = String(args.account ?? "cash").trim();
  const asOn = args.asOn ? String(args.asOn) : undefined;
  // Cash / bank balances go straight to the accounting engine — never through
  // party fuzzy matching.
  const isCash = !account || /^(cash|cash in hand|cash on hand|petty cash)$/i.test(account);
  return execEngineBalance(isCash ? "cash_balance" : "bank_balance", account, asOn);
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

/** Cash and bank total comes from the accounting engine, never recomputed here. */
async function execGetCashBankTotal(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runCashBankTotal } = await import("./accounting-query-engine");
  const res = await runCashBankTotal({ asOn: args.asOn ? String(args.asOn) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `Cash and bank as on ${res.asOn ?? "latest posting"} (${res.rows.length} ledgers)`,
      facts: { as_on_date: res.asOn, total_paise: res.totalPaise, ledger_count: res.rows.length },
      data: {
        rows: res.rows.map((r) => ({ name: r.name, kind: r.kind, closing_paise: r.closingPaise })),
        total_paise: res.totalPaise,
      },
    },
    latencyMs,
  };
}

/** Vendor spend and payment cycle come from the accounting engine, never recomputed here. */
async function execGetVendorSpendCycle(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const vendorName = args.vendor ? String(args.vendor) : "";
  if (!vendorName) {
    return {
      success: true,
      data: { scope: "Vendor spend", facts: { status: "no_name" }, data: { status: "no_name" } },
      latencyMs: Math.round(performance.now() - start),
    };
  }
  const { runVendorSpendCycle } = await import("./accounting-query-engine");
  const res = await runVendorSpendCycle({
    vendorName,
    from: args.from ? String(args.from) : null,
    to: args.to ? String(args.to) : null,
    companyId: cid,
  });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  if (res.status === "not_found") {
    return { success: true, data: { scope: "Vendor spend", facts: { status: "not_found" }, data: { status: "not_found", query: res.query } }, latencyMs };
  }
  if (res.status === "ambiguous") {
    return {
      success: true,
      data: { scope: "Vendor spend", facts: { status: "ambiguous" }, data: { status: "ambiguous", query: res.query, candidates: res.candidates } },
      latencyMs,
    };
  }
  return {
    success: true,
    data: {
      scope: `Spend with ${res.vendor} from ${res.from} to ${res.to}`,
      facts: { status: "resolved", vendor: res.vendor, from: res.from, to: res.to },
      data: {
        status: "resolved",
        vendor: res.vendor,
        from: res.from,
        to: res.to,
        spend_paise: res.spendPaise,
        bill_count: res.billCount,
        settled_paise: res.settledPaise,
        allocated_paise: res.allocatedPaise,
        fifo_paise: res.fifoPaise,
        average_cycle_days: res.averageCycleDays,
        unmatched_payments_paise: res.unmatchedPaymentsPaise,
        gross_purchases_paise: res.grossPurchasesPaise,
        purchase_returns_paise: res.purchaseReturnsPaise,
        debit_adjustments_paise: res.debitAdjustmentsPaise,
        net_purchases_paise: res.netPurchasesPaise,
        opening_settled_paise: res.openingSettledPaise,
        unusable_allocations: res.unusableAllocations,
        method: res.method,
      },
    },
    latencyMs,
  };
}

/** Vendor overdue comes from the accounting engine, never recomputed here. */
async function execGetVendorOverdue(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runVendorOverdue } = await import("./accounting-query-engine");
  const res = await runVendorOverdue({ asOn: args.asOn ? String(args.asOn) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `Vendor overdue as on ${res.asOn} (${res.checked} payable parties)`,
      facts: { as_on_date: res.asOn, checked: res.checked, flagged_count: res.flagged.length },
      data: {
        rows: res.flagged.map((r) => ({
          name: r.name,
          overdue_paise: r.overduePaise,
          outstanding_paise: r.outstandingPaise,
          advance_paise: r.advancePaise,
        })),
      },
    },
    latencyMs,
  };
}

/** Stock movement comes from the accounting engine, never recomputed here. */
async function execGetStockMovement(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runStockMovement } = await import("./accounting-query-engine");
  const res = await runStockMovement({ asOn: args.asOn ? String(args.asOn) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `Stock movement as on ${res.asOn}`,
      facts: { as_on: res.asOn, counted: res.counted },
      data: {
        rows: res.rows.map((r) => ({
          item: r.item,
          unit: r.unit,
          closing_qty: r.closingQty,
          last_movement_date: r.lastMovementDate,
          days_since_movement: r.daysSinceMovement,
          movements_last_30: r.movementsLast30,
          classification: r.classification,
        })),
      },
    },
    latencyMs,
  };
}

/** Item stock comes from the accounting engine, never recomputed here. */
async function execGetItemStock(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runItemStock } = await import("./accounting-query-engine");
  const res = await runItemStock({ itemName: String(args.item ?? ""), asOn: args.asOn ? String(args.asOn) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  if (res.status === "not_found") {
    return { success: true, data: { scope: `Item ${res.query}`, facts: { status: "not_found", query: res.query }, data: {} }, latencyMs };
  }
  if (res.status === "ambiguous") {
    return { success: true, data: { scope: `Item ${res.query}`, facts: { status: "ambiguous", query: res.query }, data: { candidates: res.candidates } }, latencyMs };
  }
  return {
    success: true,
    data: {
      scope: `Stock of ${res.item} as on ${res.asOn}`,
      facts: {
        status: "resolved",
        item: res.item,
        unit: res.unit,
        as_on: res.asOn,
        opening_qty: res.openingQty,
        movement_qty: res.movementQty,
        closing_qty: res.closingQty,
        valuation_rate_paise: res.valuationRatePaise,
        rate_source: res.rateSource,
        rate_date: res.rateDate,
        value_paise: res.valuePaise,
        godown_split: "not_available",
      },
      data: {},
    },
    latencyMs,
  };
}

/** Returns come from the accounting engine, never recomputed here. */
async function execGetReturnsSummary(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runReturnsSummary } = await import("./accounting-query-engine");
  const res = await runReturnsSummary({ from: args.from ? String(args.from) : null, to: args.to ? String(args.to) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  const mapRows = (b: { rows: { voucherNumber: string; date: string; party: string; amountPaise: number; reason: string | null }[] }) =>
    b.rows.map((r) => ({ voucher_number: r.voucherNumber, date: r.date, party: r.party, amount_paise: r.amountPaise, reason: r.reason }));
  return {
    success: true,
    data: {
      scope: `Returns, ${res.periodLabel}`,
      facts: {
        from: res.from,
        to: res.to,
        period_label: res.periodLabel,
        sales_return_total_paise: res.salesReturns.totalPaise,
        sales_return_count: res.salesReturns.count,
        purchase_return_total_paise: res.purchaseReturns.totalPaise,
        purchase_return_count: res.purchaseReturns.count,
      },
      data: {
        sales_returns: mapRows(res.salesReturns),
        purchase_returns: mapRows(res.purchaseReturns),
      },
    },
    latencyMs,
  };
}

/** Monthly trend comes from the accounting engine, never recomputed here. */
async function execGetMonthlyTrend(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runMonthlyTrend } = await import("./accounting-query-engine");
  const res = await runMonthlyTrend({ from: args.from ? String(args.from) : null, to: args.to ? String(args.to) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `Monthly revenue and expenses, ${res.from} to ${res.to}`,
      facts: { from: res.from, to: res.to, revenue_total_paise: res.revenueTotalPaise, expense_total_paise: res.expenseTotalPaise, month_count: res.rows.length },
      data: {
        rows: res.rows.map((r) => ({ month: r.month, revenue_paise: r.revenuePaise, expense_paise: r.expensePaise, net_paise: r.netPaise, revenue_change_pct: r.revenueChangePct, expense_change_pct: r.expenseChangePct })),
      },
    },
    latencyMs,
  };
}

/** Vendor concentration comes from the accounting engine, never recomputed here. */
async function execGetVendorConcentration(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runVendorConcentration } = await import("./accounting-query-engine");
  const res = await runVendorConcentration({ from: args.from ? String(args.from) : null, to: args.to ? String(args.to) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `Vendor concentration (${res.thresholdPct}% of purchase spend)`,
      facts: {
        total_paise: res.totalPaise,
        vendor_count: res.vendorCount,
        threshold_pct: res.thresholdPct,
        reached_threshold: res.reachedThreshold,
        from: res.from,
        to: res.to,
      },
      data: {
        rows: res.rows.map((r) => ({ vendor: r.vendor, spend_paise: r.spendPaise, share_pct: r.sharePct, cumulative_pct: r.cumulativePct })),
      },
    },
    latencyMs,
  };
}

/** Duplicate and price checks come from the accounting engine, never recomputed here. */
async function execGetDuplicateCheck(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runDuplicateCheck } = await import("./accounting-query-engine");
  const res = await runDuplicateCheck({ from: args.from ? String(args.from) : null, to: args.to ? String(args.to) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  const found = res.duplicateBills.length + res.repeatPayments.length + res.priceJumps.length;
  return {
    success: true,
    data: {
      scope: `Duplicate and price checks on ${res.purchaseCount} purchase bills`,
      facts: {
        purchase_count: res.purchaseCount,
        purchases_without_bill_no: res.purchasesWithoutBillNo,
        finding_count: found,
        price_jump_pct: res.thresholds.priceJumpPct,
        repeat_payment_window_days: res.thresholds.repeatPaymentWindowDays,
      },
      data: {
        duplicate_bills: res.duplicateBills.map((d) => ({ vendor: d.vendor, bill_no: d.billNo, voucher_ids: d.voucherIds, total_paise: d.totalPaise })),
        repeat_payments: res.repeatPayments.map((p) => ({ vendor: p.vendor, amount_paise: p.amountPaise, voucher_ids: p.voucherIds, dates: p.dates })),
        price_jumps: res.priceJumps.map((j) => ({ vendor: j.vendor, item: j.item, date: j.date, previous_rate_paise: j.previousRatePaise, rate_paise: j.ratePaise, change_pct: j.changePct })),
      },
    },
    latencyMs,
  };
}

/** Customer ranking comes from the accounting engine, never recomputed here. */
async function execGetCustomerRanking(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runCustomerRanking } = await import("./accounting-query-engine");
  const res = await runCustomerRanking({
    from: args.from ? String(args.from) : null,
    to: args.to ? String(args.to) : null,
    companyId: cid,
  });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `Top customers from ${res.from} to ${res.to}`,
      facts: { from: res.from, to: res.to, revenue_count: res.byRevenue.length, overdue_count: res.byOverdue.length },
      data: {
        by_revenue: res.byRevenue.map((r) => ({ name: r.name, revenue_paise: r.revenuePaise, vouchers: r.vouchers })),
        by_overdue: res.byOverdue.map((r) => ({ name: r.name, overdue_paise: r.overduePaise, outstanding_paise: r.outstandingPaise })),
      },
    },
    latencyMs,
  };
}

/** Credit watch comes from the accounting engine, never recomputed here. */
async function execGetCreditWatch(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runCreditWatch } = await import("./accounting-query-engine");
  const res = await runCreditWatch({ asOn: args.asOn ? String(args.asOn) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `Credit watch as on ${res.asOn} (${res.checked} receivable parties)`,
      facts: { as_on_date: res.asOn, checked: res.checked, flagged_count: res.flagged.length },
      data: {
        rows: res.flagged.map((r) => ({
          name: r.name,
          outstanding_paise: r.outstandingPaise,
          credit_limit_paise: r.creditLimitPaise,
          over_limit_paise: r.overLimitPaise,
          overdue_30_paise: r.overdue30Paise,
        })),
      },
    },
    latencyMs,
  };
}

/** Runway comes from the accounting engine, never recomputed here. */
async function execGetCashRunway(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runCashRunway } = await import("./accounting-query-engine");
  const res = await runCashRunway({ asOn: args.asOn ? String(args.asOn) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  if (res.status === "no_data") {
    return { success: true, data: { scope: "Cash runway", facts: { reason: "no_data" }, data: { reason: "no_data" } }, latencyMs };
  }
  if (res.status === "short_history") {
    return {
      success: true,
      data: {
        scope: "Cash runway",
        facts: { reason: "short_history", earliest_date: res.earliestDate },
        data: { reason: "short_history", earliest_date: res.earliestDate, needs_from: res.needsFrom },
      },
      latencyMs,
    };
  }
  const reason = res.reason;
  return {
    success: true,
    data: {
      scope: `Cash runway from ${res.windowFrom} to ${res.windowTo}`,
      facts: { reason, latest_date: res.latestDate, window_from: res.windowFrom, window_to: res.windowTo },
      data: {
        reason,
        latest_date: res.latestDate,
        window_from: res.windowFrom,
        window_to: res.windowTo,
        current_position_paise: res.currentPositionPaise,
        monthly_burn_paise: res.monthlyBurnPaise,
        runway_days: res.runwayDays,
      },
    },
    latencyMs,
  };
}

/** Outflow spikes come from the accounting engine, never recomputed here. */
async function execGetBankAnomalies(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runBankAnomalies } = await import("./accounting-query-engine");
  const res = await runBankAnomalies({ asOn: args.asOn ? String(args.asOn) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `Outflow spikes in ${res.checkedLedgers} cash and bank ledger(s)`,
      facts: { checked_ledgers: res.checkedLedgers, flagged_count: res.flagged.length },
      data: {
        rows: res.flagged.map((r) => ({
          name: r.ledgerName,
          kind: r.kind,
          month: r.month,
          outflow_paise: r.outflowPaise,
          baseline_paise: r.baselinePaise,
          baseline_months: r.baselineMonths,
          ratio: r.ratio,
        })),
      },
    },
    latencyMs,
  };
}

/** Sales total comes from the accounting engine, never recomputed here. */
async function execGetSalesTotal(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const { runSalesTotal } = await import("./accounting-query-engine");
  const res = await runSalesTotal({
    from: args.from ? String(args.from) : null,
    to: args.to ? String(args.to) : null,
    companyId: cid,
  });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `Sales from ${res.from} to ${res.to} (${res.count} vouchers)`,
      facts: { from: res.from, to: res.to, count: res.count, total_paise: res.totalPaise },
      data: { count: res.count, total_paise: res.totalPaise },
    },
    latencyMs,
  };
}

/**
 * Trial Balance comes from the authoritative Accounting Query Engine.
 * Rows and totals are returned verbatim — never cached, never recomputed by
 * the model. Without an as-on date the engine's current-FY-end rule applies.
 */
async function execGetPartySummary(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };
  const side = args.side === "payable" ? "payable" : "receivable";
  const { runPartySummary } = await import("./accounting-query-engine");
  const res = await runPartySummary({ side, asOn: args.asOn ? String(args.asOn) : null, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);
  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };
  return {
    success: true,
    data: {
      scope: `${side === "receivable" ? "Receivables" : "Payables"} as on ${res.asOn} (${res.rows.length} parties)`,
      facts: { as_on_date: res.asOn, side, total_outstanding_paise: res.totalOutstandingPaise, party_count: res.rows.length },
      data: {
        rows: res.rows.map((r) => ({
          name: r.name,
          outstanding_paise: r.outstandingPaise,
          advance_paise: r.advancePaise,
          buckets: r.buckets,
        })),
        total_buckets: res.totalBuckets,
      },
    },
    latencyMs,
  };
}

async function execGetTrialBalance(args: Record<string, unknown> = {}): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const asOn = args.asOn ? String(args.asOn) : null;
  const { runTrialBalance } = await import("./accounting-query-engine");
  const res = await runTrialBalance({ asOn, companyId: cid });
  const latencyMs = Math.round(performance.now() - start);

  if (res.status === "no_company") return { success: false, error: "no active company", latencyMs };
  if (res.status === "invalid_date") return { success: false, error: res.message, latencyMs };

  const rows = res.rows
    .filter((r) => r.closingPaise !== 0 || r.entryDebitPaise !== 0 || r.entryCreditPaise !== 0)
    .map((r) => ({
      name: r.ledgerName,
      group: r.ledgerGroup,
      opening_paise: r.openingPaise,
      debit_paise: r.debitPaise,
      credit_paise: r.creditPaise,
      closing_paise: r.closingPaise,
      direction: r.direction,
    }));

  return {
    success: true,
    data: {
      scope: `Trial balance as on ${res.asOn} (${rows.length} ledgers)`,
      data: { trial_balance: rows },
      facts: {
        as_on_date: res.asOn,
        ledger_count: rows.length,
        total_debit_paise: res.totalDebitPaise,
        total_credit_paise: res.totalCreditPaise,
        balanced: res.balanced,
      },
    },
    latencyMs,
  };
}

async function execGetJournalBook(args: Record<string, unknown>): Promise<ToolResult> {
  const start = performance.now();
  const cid = await activeCompanyId();
  if (!cid) return { success: false, error: "no active company", latencyMs: Math.round(performance.now() - start) };

  const from = args.from ? String(args.from) : undefined;
  const to = args.to ? String(args.to) : undefined;

  const cached = await getCached("get_journal_book", args);
  if (cached) return { success: true, data: cached, cached: true, latencyMs: 0 };

  const all = (await readVouchers(cid, { from, to })) as any[];
  const journals = all.filter((v) => String(v.voucher_type) === "journal");
  const ledgers = (await readLedgers(cid)) as any[];
  const lById = new Map(ledgers.map((l) => [String(l.id), l.name]));

  const result = {
    count: journals.length,
    vouchers: journals.slice(0, 100).map((v) => ({
      id: v.id,
      number: v.voucher_number,
      date: v.voucher_date,
      party: v.party_ledger_id ? (lById.get(String(v.party_ledger_id)) ?? null) : null,
      total_paise: v.total_paise,
    })),
  };

  await setCached("get_journal_book", args, result);
  return { success: true, data: result, latencyMs: Math.round(performance.now() - start) };
}

// ═════════════════════════════════════════════════════════════════════════════

//  MAIN EXECUTE GATE
// ═════════════════════════════════════════════════════════════════════════════

/** Drops every cached tool answer, in memory and in IndexedDB. */
export function clearToolCache(): void {
  _memCache.clear();
  void (async () => {
    try {
      const db = await getToolCacheDB();
      await db.clear("tool_results");
    } catch {
      /* ignore */
    }
  })();
}

// Books changed (voucher, master or year-end write): cached answers are no longer trustworthy.
onDataChange(() => clearToolCache());

export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const argError = validateDateArgs(args);
  if (argError) return { success: false, error: argError, latencyMs: 0 };
  switch (name) {
    case "get_party_balance":
      return execGetPartyBalance(args);
    case "get_party_ledger":
      return execGetPartyLedger(args);
    case "get_cash_balance":
      return execGetCashBalance(args);
    case "list_vouchers":
      return execListVouchers(args);
    case "get_voucher":
      return execGetVoucher(args);
    case "get_trial_balance":
      return execGetTrialBalance(args);
    case "get_party_summary":
      return execGetPartySummary(args);
    case "get_cash_bank_total":
      return execGetCashBankTotal(args);
    case "get_sales_total":
      return execGetSalesTotal(args);
    case "get_bank_anomalies":
      return execGetBankAnomalies(args);
    case "get_cash_runway":
      return execGetCashRunway(args);
    case "get_credit_watch":
      return execGetCreditWatch(args);
    case "get_customer_ranking":
      return execGetCustomerRanking(args);
    case "get_vendor_overdue":
      return execGetVendorOverdue(args);
    case "get_duplicate_check":
      return execGetDuplicateCheck(args);
    case "get_vendor_concentration":
      return execGetVendorConcentration(args);
    case "get_monthly_trend":
      return execGetMonthlyTrend(args);
    case "get_returns_summary":
      return execGetReturnsSummary(args);
    case "get_item_stock":
      return execGetItemStock(args);
    case "get_stock_movement":
      return execGetStockMovement(args);
    case "get_vendor_spend_cycle":
      return execGetVendorSpendCycle(args);
    case "get_journal_book":
      return execGetJournalBook(args);
    case "get_profit_loss":

      return execGetProfitLoss(args);
    case "get_stock_summary":
      return execGetStockSummary();
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
