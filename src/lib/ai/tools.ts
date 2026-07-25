// Client-side tool registry for the AI assistant.
//
// Tier 3: instead of guessing intent up-front and shipping one fixed slice,
// we expose a handful of typed tools the model can call to fetch exactly
// what it needs. The tool loop runs entirely on-device against IndexedDB —
// no server round-trips, no data ever leaves the machine except the
// scrubbed tool result the model needs to reason.
//
// Transport is a plain text convention so it works over both the local
// WebLLM and the cloud edge function without either needing native
// function-call support:
//
//     [[TOOL_CALL {"name":"get_party_balance","args":{"name":"Madhuben","asOn":"2026-03-31"}}]]
//
// The client parses that block, runs the tool, and feeds the result back
// as a user message so the model can finish its answer.

import { routeQuery } from "./query-router";
import { retrieveForQuery } from "./retrievers";
import { readCompanies, readLedgers, readVouchers } from "@/lib/offline/cache-read";

export interface ToolDescriptor {
  name: string;
  description: string;
  /** Human-readable schema snippet used in the system prompt. */
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
    "TOOLS AVAILABLE — you may call any of these instead of answering from the",
    "attached slice. Emit EXACTLY one JSON block on its own line in this form:",
    "",
    '  [[TOOL_CALL {"name":"<tool>","args":{...}}]]',
    "",
    "Stop generating after the block — the client will run the tool and",
    "reply with the result. You may then call another tool or write the",
    "final answer. Never invent tool names or arguments.",
    "",
  ];
  for (const t of TOOL_CATALOG) {
    lines.push(`- ${t.name}${t.argsHint} — ${t.description}`);
  }
  return lines.join("\n");
}

const TOOL_CALL_RE = /\[\[TOOL_CALL\s+(\{[\s\S]*?\})\s*\]\]/;

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
  /** The raw block, so callers can trim it out of the visible answer. */
  raw: string;
}

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

// ---------- Executors -----------------------------------------------------

async function activeCompanyId(): Promise<string | null> {
  if (typeof window !== "undefined") {
    try {
      const id = localStorage.getItem("ym_active_company_id");
      if (id) return id;
    } catch { /* ignore */ }
  }
  const cs = (await readCompanies()) as any[];
  return cs[0]?.id ? String(cs[0].id) : null;
}

async function execGetPartyBalance(args: Record<string, unknown>) {
  const name = String(args.name ?? "").trim();
  const asOn = args.asOn ? String(args.asOn) : undefined;
  if (!name) return { error: "missing 'name'" };
  const cid = await activeCompanyId();
  if (!cid) return { error: "no active company" };
  const q = `balance of ${name}${asOn ? ` as on ${asOn}` : ""}`;
  const routed = routeQuery(q);
  const slice = await retrieveForQuery(routed, cid);
  return { scope: slice.scope, facts: slice.facts, vouchers: (slice.data.vouchers as any[])?.slice(0, 10) };
}

async function execGetCashBalance(args: Record<string, unknown>) {
  const account = String(args.account ?? "cash").trim();
  const asOn = args.asOn ? String(args.asOn) : undefined;
  const cid = await activeCompanyId();
  if (!cid) return { error: "no active company" };
  // Reuse the party path — the ledger picker already handles Cash / bank names.
  const q = `balance of ${account}${asOn ? ` as on ${asOn}` : ""}`;
  const routed = routeQuery(q);
  routed.intent = "party_balance";
  const slice = await retrieveForQuery(routed, cid);
  return { scope: slice.scope, facts: slice.facts };
}

async function execListVouchers(args: Record<string, unknown>) {
  const cid = await activeCompanyId();
  if (!cid) return { error: "no active company" };
  const from = args.from ? String(args.from) : undefined;
  const to = args.to ? String(args.to) : undefined;
  const kind = args.kind ? String(args.kind) : undefined;
  const limit = Math.min(Number(args.limit ?? 50), 200);
  const all = (await readVouchers(cid, { from, to })) as any[];
  const filtered = kind ? all.filter((v) => String(v.voucher_type) === kind) : all;
  const ledgers = kind ? (await readLedgers(cid)) as any[] : [];
  const lById = new Map(ledgers.map((l) => [String(l.id), l.name]));
  return {
    count: filtered.length,
    vouchers: filtered.slice(0, limit).map((v) => ({
      id: v.id,
      number: v.voucher_number,
      date: v.voucher_date,
      kind: v.voucher_type,
      total_paise: v.total_paise,
      party: v.party_ledger_id ? lById.get(String(v.party_ledger_id)) ?? null : null,
    })),
  };
}

async function execGetVoucher(args: Record<string, unknown>) {
  const number = String(args.number ?? "").trim();
  if (!number) return { error: "missing 'number'" };
  const cid = await activeCompanyId();
  if (!cid) return { error: "no active company" };
  const routed = routeQuery(`voucher ${number}`);
  routed.voucherNumber = number;
  routed.intent = "voucher_lookup";
  const slice = await retrieveForQuery(routed, cid);
  return { scope: slice.scope, data: slice.data, facts: slice.facts };
}

async function execGetTrialBalance() {
  const cid = await activeCompanyId();
  if (!cid) return { error: "no active company" };
  const routed = routeQuery("trial balance");
  routed.intent = "trial_balance";
  const slice = await retrieveForQuery(routed, cid);
  return { scope: slice.scope, data: slice.data, facts: slice.facts };
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_party_balance": return execGetPartyBalance(args);
    case "get_cash_balance": return execGetCashBalance(args);
    case "list_vouchers": return execListVouchers(args);
    case "get_voucher": return execGetVoucher(args);
    case "get_trial_balance": return execGetTrialBalance();
    default: return { error: `unknown tool: ${name}` };
  }
}
