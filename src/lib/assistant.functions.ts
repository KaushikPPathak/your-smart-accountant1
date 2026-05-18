// AI Assistant server function — robust, accounting-aware.
// Uses Lovable AI Gateway via the AI SDK with read-only tools that query
// the authenticated user's company data via RLS-scoped Supabase client.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ASSISTANT_KB } from "./assistant-knowledge";

type DB = SupabaseClient<Database>;

const PL_INCOME = new Set(["income_direct", "income_indirect"]);
const PL_EXPENSE = new Set(["expense_direct", "expense_indirect"]);
const BS_ASSET = new Set([
  "sundry_debtor",
  "cash",
  "bank",
  "fixed_asset",
  "current_asset",
  "stock_in_hand",
]);
const BS_LIAB = new Set([
  "sundry_creditor",
  "current_liability",
  "loan_liability",
  "capital",
  "duties_taxes",
]);

const rupees = (paise: number) =>
  (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

async function ensureMember(supabase: DB, companyId: string, userId: string) {
  const { data, error } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("You don't have access to this company");
  return data.role as "admin" | "accountant" | "viewer";
}

async function computeBalances(
  supabase: DB,
  companyId: string,
  asOf: string,
  from?: string,
) {
  const { data: ledgers } = await supabase
    .from("ledgers")
    .select(
      "id, name, type, group_code, opening_balance_paise, opening_balance_is_debit",
    )
    .eq("company_id", companyId);

  let q = supabase
    .from("voucher_entries")
    .select(
      "ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)",
    )
    .eq("vouchers.company_id", companyId)
    .lte("vouchers.voucher_date", asOf);
  if (from) q = q.gte("vouchers.voucher_date", from);
  const { data: entries } = await q;

  const mv = new Map<string, number>();
  for (const e of (entries ?? []) as Array<{
    ledger_id: string;
    debit_paise: number;
    credit_paise: number;
  }>) {
    mv.set(e.ledger_id, (mv.get(e.ledger_id) ?? 0) + e.debit_paise - e.credit_paise);
  }
  return (ledgers ?? []).map((l) => {
    const ob = from
      ? 0
      : (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise;
    return {
      id: l.id,
      name: l.name,
      type: l.type,
      group_code: l.group_code,
      closing_paise: ob + (mv.get(l.id) ?? 0),
    };
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildTools(supabase: DB, companyId: string) {
  return {
    get_company_info: tool({
      description: "Get the active company's profile and settings.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data } = await supabase
          .from("companies")
          .select(
            "name, gstin, pan, state, state_code, financial_year_start, gst_registered, gst_filing_frequency, inventory_enabled, currency_code",
          )
          .eq("id", companyId)
          .maybeSingle();
        return data ?? { error: "Company not found" };
      },
    }),

    list_ledgers: tool({
      description:
        "List ledgers/parties. Optionally filter by name substring or ledger type (e.g. sundry_debtor, sundry_creditor, bank, cash).",
      inputSchema: z.object({
        search: z.string().optional(),
        type: z.string().optional(),
        limit: z.number().min(1).max(50).default(25),
      }),
      execute: async ({ search, type, limit }) => {
        let q = supabase
          .from("ledgers")
          .select("id, name, type, group_code, gstin, state, is_active")
          .eq("company_id", companyId)
          .limit(limit);
        if (search) q = q.ilike("name", `%${search}%`);
        if (type) q = q.eq("type", type as Database["public"]["Enums"]["ledger_type"]);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return { count: data?.length ?? 0, ledgers: data ?? [] };
      },
    }),

    get_ledger_balance: tool({
      description:
        "Get the closing balance for one ledger by name (fuzzy match) as of a date.",
      inputSchema: z.object({
        name: z.string(),
        as_of: z.string().optional().describe("ISO date YYYY-MM-DD; defaults to today"),
      }),
      execute: async ({ name, as_of }) => {
        const asOf = as_of || todayISO();
        const { data: matches } = await supabase
          .from("ledgers")
          .select("id, name, type")
          .eq("company_id", companyId)
          .ilike("name", `%${name}%`)
          .limit(5);
        if (!matches || matches.length === 0) return { error: `No ledger matching "${name}"` };
        const ledger = matches[0];
        const balances = await computeBalances(supabase, companyId, asOf);
        const row = balances.find((b) => b.id === ledger.id);
        const paise = row?.closing_paise ?? 0;
        return {
          ledger: ledger.name,
          type: ledger.type,
          as_of: asOf,
          balance_rupees: rupees(Math.abs(paise)),
          dr_cr: paise >= 0 ? "Dr" : "Cr",
          balance_paise: paise,
          other_matches: matches.slice(1).map((m) => m.name),
        };
      },
    }),

    get_trial_balance: tool({
      description: "Return trial balance totals and top N ledgers by absolute value.",
      inputSchema: z.object({
        as_of: z.string().optional(),
        top: z.number().min(5).max(50).default(20),
      }),
      execute: async ({ as_of, top }) => {
        const asOf = as_of || todayISO();
        const balances = await computeBalances(supabase, companyId, asOf);
        let totalDr = 0;
        let totalCr = 0;
        for (const b of balances) {
          if (b.closing_paise >= 0) totalDr += b.closing_paise;
          else totalCr += -b.closing_paise;
        }
        const rows = [...balances]
          .sort((a, b) => Math.abs(b.closing_paise) - Math.abs(a.closing_paise))
          .slice(0, top)
          .map((b) => ({
            name: b.name,
            type: b.type,
            amount: rupees(Math.abs(b.closing_paise)),
            dr_cr: b.closing_paise >= 0 ? "Dr" : "Cr",
          }));
        return {
          as_of: asOf,
          total_debit_rupees: rupees(totalDr),
          total_credit_rupees: rupees(totalCr),
          difference_rupees: rupees(Math.abs(totalDr - totalCr)),
          top_ledgers: rows,
        };
      },
    }),

    get_profit_loss: tool({
      description: "Profit & Loss summary for a period.",
      inputSchema: z.object({
        from: z.string().describe("ISO date YYYY-MM-DD"),
        to: z.string().describe("ISO date YYYY-MM-DD"),
      }),
      execute: async ({ from, to }) => {
        const balances = await computeBalances(supabase, companyId, to, from);
        let income = 0;
        let expense = 0;
        for (const b of balances) {
          if (PL_INCOME.has(b.type)) income += -b.closing_paise; // credit-natured
          else if (PL_EXPENSE.has(b.type)) expense += b.closing_paise;
        }
        return {
          period: `${from} → ${to}`,
          income_rupees: rupees(income),
          expense_rupees: rupees(expense),
          net_profit_rupees: rupees(income - expense),
          profit: income - expense >= 0,
        };
      },
    }),

    get_balance_sheet: tool({
      description: "Balance Sheet summary as of a date.",
      inputSchema: z.object({ as_of: z.string().optional() }),
      execute: async ({ as_of }) => {
        const asOf = as_of || todayISO();
        const balances = await computeBalances(supabase, companyId, asOf);
        let assets = 0;
        let liabilities = 0;
        let pl = 0;
        for (const b of balances) {
          if (BS_ASSET.has(b.type)) assets += b.closing_paise;
          else if (BS_LIAB.has(b.type)) liabilities += -b.closing_paise;
          else if (PL_INCOME.has(b.type)) pl += -b.closing_paise;
          else if (PL_EXPENSE.has(b.type)) pl -= b.closing_paise;
        }
        return {
          as_of: asOf,
          assets_rupees: rupees(assets),
          liabilities_rupees: rupees(liabilities),
          retained_pl_rupees: rupees(pl),
          difference_rupees: rupees(assets - liabilities - pl),
        };
      },
    }),

    get_outstanding: tool({
      description:
        "Outstanding receivables (from sundry debtors) or payables (sundry creditors).",
      inputSchema: z.object({
        side: z.enum(["receivables", "payables"]),
        top: z.number().min(5).max(30).default(15),
      }),
      execute: async ({ side, top }) => {
        const balances = await computeBalances(supabase, companyId, todayISO());
        const target = side === "receivables" ? "sundry_debtor" : "sundry_creditor";
        const rows = balances
          .filter((b) => b.type === target && b.closing_paise !== 0)
          .sort((a, b) => Math.abs(b.closing_paise) - Math.abs(a.closing_paise))
          .slice(0, top)
          .map((b) => ({
            party: b.name,
            amount: rupees(Math.abs(b.closing_paise)),
            dr_cr: b.closing_paise >= 0 ? "Dr" : "Cr",
          }));
        const total = rows.reduce(
          (s, _r, i) =>
            s +
            Math.abs(
              balances.filter((b) => b.type === target)[i]?.closing_paise ?? 0,
            ),
          0,
        );
        return {
          side,
          count: rows.length,
          total_rupees: rupees(total),
          parties: rows,
        };
      },
    }),

    list_recent_vouchers: tool({
      description: "List the most recent vouchers, optionally filtered by type.",
      inputSchema: z.object({
        voucher_type: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().min(1).max(50).default(15),
      }),
      execute: async ({ voucher_type, from, to, limit }) => {
        let q = supabase
          .from("vouchers")
          .select(
            "id, voucher_date, voucher_number, voucher_type, total_paise, narration, party_ledger_id",
          )
          .eq("company_id", companyId)
          .order("voucher_date", { ascending: false })
          .limit(limit);
        if (voucher_type)
          q = q.eq(
            "voucher_type",
            voucher_type as Database["public"]["Enums"]["voucher_type"],
          );
        if (from) q = q.gte("voucher_date", from);
        if (to) q = q.lte("voucher_date", to);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return {
          count: data?.length ?? 0,
          vouchers: (data ?? []).map((v) => ({
            date: v.voucher_date,
            no: v.voucher_number,
            type: v.voucher_type,
            amount: rupees(v.total_paise),
            narration: v.narration,
          })),
        };
      },
    }),

    get_stock_summary: tool({
      description: "Stock summary — items with on-hand quantity and value.",
      inputSchema: z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
      execute: async ({ search, limit }) => {
        let q = supabase
          .from("items")
          .select("id, name, unit, opening_stock_qty, opening_stock_rate_paise, hsn_code")
          .eq("company_id", companyId)
          .limit(limit);
        if (search) q = q.ilike("name", `%${search}%`);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return { items: data ?? [] };
      },
    }),

    search_help: tool({
      description:
        "Search the offline product knowledge base for how to do something in this app (settings, navigation, features).",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const q = query.toLowerCase();
        const hits = ASSISTANT_KB.map((e) => ({
          e,
          score:
            (e.title.toLowerCase().includes(q) ? 2 : 0) +
            e.keywords.reduce((s, k) => s + (q.includes(k) || k.includes(q) ? 1 : 0), 0),
        }))
          .filter((h) => h.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((h) => ({
            title: h.e.title,
            answer: h.e.answer,
            actions: h.e.actions ?? [],
          }));
        return { results: hits };
      },
    }),
  };
}

const ChatInput = z.object({
  companyId: z.string().uuid().nullable(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .min(1)
    .max(30),
});

export const assistantChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ChatInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      return {
        ok: false as const,
        error: "AI is not configured. Missing LOVABLE_API_KEY.",
      };
    }

    let companyName = "(no company selected)";
    if (data.companyId) {
      try {
        await ensureMember(supabase as DB, data.companyId, userId);
        const { data: c } = await supabase
          .from("companies")
          .select("name")
          .eq("id", data.companyId)
          .maybeSingle();
        if (c?.name) companyName = c.name;
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : "Access denied",
        };
      }
    }

    const tools = data.companyId
      ? buildTools(supabase as DB, data.companyId)
      : {
          search_help: tool({
            description: "Search the offline product knowledge base.",
            inputSchema: z.object({ query: z.string() }),
            execute: async ({ query }) => {
              const q = query.toLowerCase();
              return {
                results: ASSISTANT_KB.filter(
                  (e) =>
                    e.title.toLowerCase().includes(q) ||
                    e.keywords.some((k) => q.includes(k) || k.includes(q)),
                )
                  .slice(0, 3)
                  .map((e) => ({
                    title: e.title,
                    answer: e.answer,
                    actions: e.actions ?? [],
                  })),
              };
            },
          }),
        };

    const today = todayISO();
    const system = `You are Mate, an in-app accounting assistant for an Indian GST accounting application.

Active company: ${companyName} (id: ${data.companyId ?? "none"})
Today's date: ${today}

Guidelines:
- You are READ-ONLY. You can answer questions about books, balances, ledgers, parties, vouchers, GST, stock. You MUST NOT make up numbers — always call a tool to fetch real data before quoting figures.
- Always present money in Indian rupees with the "₹" symbol and the Dr/Cr indicator where applicable.
- If a question needs a date and none is given, use today (${today}) for "as of" balances, or the current financial year for period reports.
- For "how do I…" / settings / navigation questions, use the search_help tool and quote its answer briefly.
- If no company is active, politely tell the user to pick a company first for any data question.
- Keep responses concise and use markdown (bullets, **bold**, short tables) for readability.
- Never reveal raw IDs unless explicitly asked. Never expose other users' data.
- If a tool returns an error, explain in plain language and suggest the next step.`;

    const provider = createLovableAiGatewayProvider(key);
    const model = provider("google/gemini-3-flash-preview");

    try {
      const result = await generateText({
        model,
        system,
        messages: data.messages,
        tools,
        stopWhen: stepCountIs(50),
      });

      return {
        ok: true as const,
        text: result.text,
        steps: result.steps.length,
        toolCalls: result.steps.flatMap((s) =>
          (s.toolCalls ?? []).map((c) => ({
            name: c.toolName,
            input: JSON.stringify(c.input ?? {}),
          })),
        ),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[assistant] AI error:", msg);
      if (msg.includes("429"))
        return {
          ok: false as const,
          error: "AI is busy right now (rate limit). Please try again in a moment.",
        };
      if (msg.includes("402"))
        return {
          ok: false as const,
          error:
            "AI credits exhausted for this workspace. Add credits in Settings → Workspace → Usage.",
        };
      return { ok: false as const, error: `AI error: ${msg}` };
    }
  });
