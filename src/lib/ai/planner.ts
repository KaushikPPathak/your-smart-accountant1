// Multi-step planner — decomposes a compound query into ordered tool calls.
//
// The intent router (query-router.ts) is great for single-intent questions
// like "cash balance today". It falls apart on compound questions such as
// "compare Madhuben and Hasmukhbhai balances as on 31/03/2026" or
// "what did we sell to Zaveri last month and what's their outstanding?".
//
// This planner runs entirely locally — no LLM tokens spent on planning.
// It splits the query on connector words, routes each fragment through
// the existing intent router, and returns a Plan of Steps. The caller
// (AssistantChat) executes each step via executeTool() and stitches the
// results together into a single answer.
//
// Design tenets:
//  • Deterministic. Same question in, same plan out.
//  • Safe. If we can't confidently split, we return a one-step plan so
//    the assistant falls back to the normal single-intent path.
//  • Cheap. Zero network, zero model calls at planning time.

import { routeQuery, type IntentType } from "./query-router";
import { executeTool } from "./tools";

export interface PlanStep {
  id: string;
  fragment: string;               // the sub-question this step answers
  intent: IntentType;            // routed intent for the fragment
  tool: string | null;            // tool to invoke (null → fall back to retriever)
  args: Record<string, unknown>;
}

export interface Plan {
  original: string;
  steps: PlanStep[];
  /** Human-readable rationale, shown in the assistant's "thinking" trace. */
  rationale: string;
}

export interface PlanStepResult {
  step: PlanStep;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// Connectors that reliably separate two independent asks in one sentence.
// We keep the list small and boring — false splits are worse than misses.
const SPLIT_RE = /\s+(?:and also|and then|and|,|;|also|then|compared with|vs\.?|versus)\s+/i;

// "compare A and B" needs the same tool run twice with different entities.
const COMPARE_RE = /^\s*(?:compare|difference between|diff of)\s+(.+?)\s+(?:and|vs\.?|versus|with)\s+(.+?)\s*$/i;

function extractEntity(fragment: string): string | null {
  // very light extractor: proper-noun-ish trailing phrase
  const m = fragment.match(/(?:of|for|with)\s+([A-Za-z][\w .&'-]{2,})\??$/i);
  return m ? m[1].trim() : null;
}

function toolForIntent(intent: IntentType): string | null {
  switch (intent) {
    case "party_balance":     return "get_party_balance";
    case "cash_balance":      return "get_cash_balance";
    case "bank_balance":      return "get_cash_balance";
    case "voucher_lookup":    return "get_voucher";
    case "trial_balance":     return "get_trial_balance";
    default:                  return null;
  }
}


function argsForFragment(intent: IntentType, fragment: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const entity = extractEntity(fragment);
  const asOn = fragment.match(/\b(\d{2}\/\d{2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (asOn) args.asOn = normaliseDate(asOn);

  if (intent === "party_balance" && entity) args.name = entity;
  if (intent === "cash_balance" || intent === "bank_balance") {
    if (/bank/i.test(fragment) && entity) args.account = entity;
    else args.account = "cash";
  }

  if (intent === "voucher_lookup") {
    const num = fragment.match(/#?\s*([A-Z0-9\-/]{2,})/i)?.[1];
    if (num) args.number = num;
  }
  return args;
}


function normaliseDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return raw;
  const [, d, mo, y] = m;
  const yyyy = y.length === 2 ? `20${y}` : y;
  return `${yyyy}-${mo}-${d}`;
}

/**
 * Build a plan from a natural-language query. Always returns at least one
 * step — even a single-intent question gets wrapped so the executor path
 * is uniform.
 */
export function buildPlan(query: string): Plan {
  const q = query.trim();

  // "compare A and B" pattern → two parallel party lookups
  const cmp = q.match(COMPARE_RE);
  if (cmp) {
    const [, a, b] = cmp;
    const mk = (frag: string, i: number): PlanStep => {
      const intent = routeQuery(frag).intent;
      const tool = toolForIntent(intent);
      return {
        id: `s${i}`,
        fragment: frag,
        intent,
        tool,
        args: intent === "party_balance" ? { name: frag } : argsForFragment(intent, frag),
      };
    };
    return {
      original: q,
      steps: [mk(a, 1), mk(b, 2)],
      rationale: `Comparison detected — running the same lookup for "${a}" and "${b}" then diffing the results.`,
    };
  }

  // Generic connector split (max 3 fragments to keep answers focused)
  const parts = q.split(SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  const fragments = parts.length >= 2 ? parts.slice(0, 3) : [q];

  const steps: PlanStep[] = fragments.map((frag, i) => {
    const intent = routeQuery(frag).intent;
    const tool = toolForIntent(intent);
    return { id: `s${i + 1}`, fragment: frag, intent, tool, args: argsForFragment(intent, frag) };
  });

  const rationale = steps.length === 1
    ? `Single-intent question routed to ${steps[0].intent}.`
    : `Compound question split into ${steps.length} sub-questions: ${steps.map((s) => s.intent).join(" → ")}.`;

  return { original: q, steps, rationale };
}

/**
 * Execute a plan step-by-step. Steps run sequentially so later steps can,
 * in a future revision, reference earlier results. For now they're
 * independent; the sequential contract just keeps IndexedDB reads polite.
 */
export async function executePlan(plan: Plan): Promise<PlanStepResult[]> {
  const out: PlanStepResult[] = [];
  for (const step of plan.steps) {
    if (!step.tool) {
      out.push({ step, ok: false, error: "no-tool-for-intent" });
      continue;
    }
    try {
      const result = await executeTool(step.tool, step.args);
      out.push({ step, ok: true, result });
    } catch (e) {
      out.push({ step, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** Convenience: plan + execute in one call. */
export async function runPlan(query: string): Promise<{ plan: Plan; results: PlanStepResult[] }> {
  const plan = buildPlan(query);
  const results = await executePlan(plan);
  return { plan, results };
}
