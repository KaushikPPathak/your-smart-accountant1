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

    // ---------- WRITE TOOLS (always confirm-first) ----------
    create_ledger: tool({
      description:
        "Create a new ledger / party master. ALWAYS call with confirm=false first to show the user a preview, then only call again with confirm=true after the user explicitly says yes.",
      inputSchema: z.object({
        name: z.string().min(1).max(120),
        type: z.enum([
          "sundry_debtor",
          "sundry_creditor",
          "bank",
          "cash",
          "expense_direct",
          "expense_indirect",
          "income_direct",
          "income_indirect",
          "fixed_asset",
          "current_asset",
          "current_liability",
          "loan_liability",
          "capital",
          "duties_taxes",
          "stock_in_hand",
        ]),
        opening_balance_rupees: z.number().optional().default(0),
        opening_is_debit: z.boolean().optional().default(true),
        gstin: z.string().optional(),
        state: z.string().optional(),
        confirm: z.boolean().default(false),
      }),
      execute: async (input) => {
        const { data: dup } = await supabase
          .from("ledgers")
          .select("id, name")
          .eq("company_id", companyId)
          .ilike("name", input.name)
          .maybeSingle();
        if (dup) return { error: `A ledger named "${dup.name}" already exists.` };

        const preview = {
          action: "create_ledger" as const,
          name: input.name,
          type: input.type,
          opening_balance_rupees: input.opening_balance_rupees ?? 0,
          opening_is_debit: input.opening_is_debit ?? true,
          gstin: input.gstin ?? null,
          state: input.state ?? null,
        };
        if (!input.confirm) return { preview, requires_confirmation: true };

        const { data, error } = await supabase
          .from("ledgers")
          .insert({
            company_id: companyId,
            name: input.name,
            type: input.type as Database["public"]["Enums"]["ledger_type"],
            opening_balance_paise: Math.round((input.opening_balance_rupees ?? 0) * 100),
            opening_balance_is_debit: input.opening_is_debit ?? true,
            gstin: input.gstin ?? null,
            state: input.state ?? null,
          })
          .select("id, name")
          .single();
        if (error) return { error: error.message };
        return { ok: true, created: data };
      },
    }),

    create_journal_voucher: tool({
      description:
        "Create a manual Journal (double-entry) voucher. Lines must balance — sum of debits = sum of credits. Each line references a ledger by name (fuzzy match). ALWAYS call with confirm=false first; only call again with confirm=true after the user explicitly says yes.",
      inputSchema: z.object({
        date: z.string().describe("ISO YYYY-MM-DD"),
        narration: z.string().max(500).optional(),
        lines: z
          .array(
            z.object({
              ledger_name: z.string(),
              debit_rupees: z.number().optional().default(0),
              credit_rupees: z.number().optional().default(0),
            }),
          )
          .min(2)
          .max(20),
        confirm: z.boolean().default(false),
      }),
      execute: async (input) => {
        return await createGenericVoucher(supabase, companyId, {
          voucher_type: "journal",
          date: input.date,
          narration: input.narration,
          lines: input.lines,
          confirm: input.confirm,
        });
      },
    }),

    create_payment_voucher: tool({
      description:
        "Create a Payment voucher (money paid OUT from cash/bank). The 'from_account' is your cash/bank ledger; 'paid_to' is the party or expense ledger being debited. ALWAYS confirm=false first.",
      inputSchema: z.object({
        date: z.string().describe("ISO YYYY-MM-DD"),
        paid_to_ledger_name: z.string(),
        from_account_name: z.string().describe("Cash or bank ledger name"),
        amount_rupees: z.number().positive(),
        narration: z.string().max(500).optional(),
        confirm: z.boolean().default(false),
      }),
      execute: async (input) => {
        return await createGenericVoucher(supabase, companyId, {
          voucher_type: "payment",
          date: input.date,
          narration: input.narration,
          lines: [
            { ledger_name: input.paid_to_ledger_name, debit_rupees: input.amount_rupees, credit_rupees: 0 },
            { ledger_name: input.from_account_name, debit_rupees: 0, credit_rupees: input.amount_rupees },
          ],
          confirm: input.confirm,
        });
      },
    }),

    create_receipt_voucher: tool({
      description:
        "Create a Receipt voucher (money received IN to cash/bank). 'to_account' is your cash/bank ledger; 'received_from' is the party or income ledger being credited. ALWAYS confirm=false first.",
      inputSchema: z.object({
        date: z.string().describe("ISO YYYY-MM-DD"),
        received_from_ledger_name: z.string(),
        to_account_name: z.string().describe("Cash or bank ledger name"),
        amount_rupees: z.number().positive(),
        narration: z.string().max(500).optional(),
        confirm: z.boolean().default(false),
      }),
      execute: async (input) => {
        return await createGenericVoucher(supabase, companyId, {
          voucher_type: "receipt",
          date: input.date,
          narration: input.narration,
          lines: [
            { ledger_name: input.to_account_name, debit_rupees: input.amount_rupees, credit_rupees: 0 },
            { ledger_name: input.received_from_ledger_name, debit_rupees: 0, credit_rupees: input.amount_rupees },
          ],
          confirm: input.confirm,
        });
      },
    }),

    // ---------- CONTRA (bank/cash transfer) ----------
    create_contra_voucher: tool({
      description:
        "Create a Contra voucher — money moved between two cash/bank accounts (e.g. cash deposit to bank, bank-to-bank transfer). ALWAYS call confirm=false first to preview, then confirm=true after the user explicitly says yes.",
      inputSchema: z.object({
        date: z.string().describe("ISO YYYY-MM-DD"),
        from_account_name: z.string().describe("Source cash/bank ledger (credited)"),
        to_account_name: z.string().describe("Destination cash/bank ledger (debited)"),
        amount_rupees: z.number().positive(),
        narration: z.string().max(500).optional(),
        confirm: z.boolean().default(false),
      }),
      execute: async (input) => {
        return await createGenericVoucher(supabase, companyId, {
          voucher_type: "contra",
          date: input.date,
          narration: input.narration,
          lines: [
            { ledger_name: input.to_account_name, debit_rupees: input.amount_rupees, credit_rupees: 0 },
            { ledger_name: input.from_account_name, debit_rupees: 0, credit_rupees: input.amount_rupees },
          ],
          confirm: input.confirm,
        });
      },
    }),

    // ---------- ITEM MASTER ----------
    create_item: tool({
      description:
        "Create a new inventory item master. Use this when the user mentions an item that doesn't exist yet. Tax-free items use gst_rate=0. ALWAYS call confirm=false first to preview, then confirm=true after the user says yes.",
      inputSchema: z.object({
        name: z.string().min(1).max(120),
        unit: z.string().min(1).max(10).default("NOS"),
        gst_rate: z.number().min(0).max(28).default(0),
        hsn_code: z.string().max(10).optional(),
        purchase_price_rupees: z.number().nonnegative().optional(),
        sale_price_rupees: z.number().nonnegative().optional(),
        confirm: z.boolean().default(false),
      }),
      execute: async (input) => {
        const { data: dup } = await supabase
          .from("items")
          .select("id, name")
          .eq("company_id", companyId)
          .ilike("name", input.name)
          .maybeSingle();
        if (dup) return { ok: true, existing: dup, note: `Item "${dup.name}" already exists.` };
        const preview = {
          action: "create_item" as const,
          name: input.name,
          unit: input.unit,
          gst_rate: input.gst_rate,
          hsn_code: input.hsn_code ?? null,
          purchase_price_rupees: input.purchase_price_rupees ?? null,
          sale_price_rupees: input.sale_price_rupees ?? null,
        };
        if (!input.confirm) return { preview, requires_confirmation: true };
        const { data, error } = await supabase
          .from("items")
          .insert({
            company_id: companyId,
            name: input.name,
            unit: input.unit,
            gst_rate: input.gst_rate,
            hsn_code: input.hsn_code ?? null,
            purchase_price_paise: input.purchase_price_rupees != null ? Math.round(input.purchase_price_rupees * 100) : 0,
            sale_price_paise: input.sale_price_rupees != null ? Math.round(input.sale_price_rupees * 100) : 0,
          })
          .select("id, name")
          .single();
        if (error) return { error: error.message };
        return { ok: true, created: data };
      },
    }),

    // ---------- ITEM VOUCHERS (sales / purchase / credit_note / debit_note) ----------
    create_item_voucher: tool({
      description:
        "Create a Sales, Purchase, Credit Note or Debit Note voucher with one or more items. Resolves the party ledger and items by fuzzy match. Auto-creates the party (pass party_type) and items (pass unit/gst_rate/hsn_code on the line). Computes CGST/SGST (intra-state) or IGST (inter-state). Use posting_account_name + posting_account_type to override the default Sales/Purchase A/c — e.g. 'Computers'/fixed_asset for capital-goods purchase, 'Sales - Exempt'/income_direct for exempt sales, 'Sales - Exports'/income_direct for zero-rated exports. ALWAYS call confirm=false first; only call confirm=true after the user explicitly says yes.",
      inputSchema: z.object({
        voucher_type: z.enum(["sales", "purchase", "credit_note", "debit_note"]),
        date: z.string().describe("ISO YYYY-MM-DD"),
        party_name: z.string().describe("Customer / supplier ledger name"),
        party_type: z
          .enum(["sundry_debtor", "sundry_creditor"])
          .optional()
          .describe("If provided and the party doesn't exist, auto-create it with this type."),
        party_state: z.string().optional(),
        party_state_code: z.string().optional(),
        party_gstin: z.string().optional(),
        reference_no: z.string().max(60).optional(),
        narration: z.string().max(500).optional(),
        posting_account_name: z
          .string()
          .optional()
          .describe(
            "Override the default Sales A/c / Purchase A/c. Use for capital goods (e.g. 'Computers'), exempt or export sales.",
          ),
        posting_account_type: z
          .enum([
            "fixed_asset",
            "current_asset",
            "income_direct",
            "income_indirect",
            "expense_direct",
            "expense_indirect",
          ])
          .optional()
          .describe("Group for the override posting account."),
        items: z
          .array(
            z.object({
              item_name: z.string(),
              qty: z.number().positive(),
              rate_rupees: z.number().nonnegative(),
              discount_rupees: z.number().nonnegative().optional().default(0),
              gst_rate_override: z.number().min(0).max(28).optional(),
              unit: z.string().max(10).optional(),
              hsn_code: z.string().max(10).optional(),
              gst_rate: z.number().min(0).max(28).optional(),
            }),
          )
          .min(1)
          .max(50),
        confirm: z.boolean().default(false),
      }),
      execute: async (input) => {
        return await createItemVoucher(supabase, companyId, input);
      },
    }),

    // ---------- GST EXPENSE / CAPITAL-GOODS (no inventory) ----------
    create_expense_voucher: tool({
      description:
        "Create a GST expense or capital-goods voucher WITHOUT inventory (rent, telephone, professional fees, audit fees, a laptop bought from a non-stocked supplier, etc.). Auto-creates the expense/asset ledger and the Input CGST/SGST/IGST ledgers. Posts: Dr Expense/Asset (taxable) + Dr Input CGST+SGST or Input IGST, Cr Cash/Bank (cash/bank mode) OR Cr Party (credit mode). ledger_type=fixed_asset for capital goods, expense_indirect for overheads, expense_direct for direct costs. ALWAYS call confirm=false first.",
      inputSchema: z.object({
        date: z.string().describe("ISO YYYY-MM-DD"),
        expense_ledger_name: z.string().describe("e.g. 'Rent A/c', 'Telephone Expenses', 'Computers'"),
        ledger_type: z.enum([
          "expense_direct",
          "expense_indirect",
          "fixed_asset",
          "current_asset",
        ]),
        amount_rupees: z.number().positive().describe("Taxable amount BEFORE GST."),
        gst_rate: z.number().min(0).max(28).default(0),
        payment_mode: z.enum(["cash", "bank", "credit"]),
        cash_or_bank_ledger_name: z.string().optional().describe("Required for cash/bank mode."),
        party_name: z.string().optional().describe("Supplier ledger; required for credit mode."),
        party_state_code: z.string().optional(),
        party_gstin: z.string().optional(),
        reference_no: z.string().max(60).optional(),
        narration: z.string().max(500).optional(),
        confirm: z.boolean().default(false),
      }),
      execute: async (input) => {
        return await createExpenseVoucher(supabase, companyId, input);
      },
    }),

    // ---------- MANUFACTURING JOURNAL ----------
    create_manufacturing_voucher: tool({
      description:
        "Create a Manufacturing Journal — consumes one or more raw-material items and produces one or more finished-goods items. Stock of consumed items is reduced; stock of produced items is increased at the total consumption value (split pro-rata by output qty). Posts Dr Finished Goods / Cr Raw Materials in the ledger. ALWAYS confirm=false first.",
      inputSchema: z.object({
        date: z.string().describe("ISO YYYY-MM-DD"),
        narration: z.string().max(500).optional(),
        consumption: z
          .array(z.object({ item_name: z.string(), qty: z.number().positive(), rate_rupees: z.number().nonnegative() }))
          .min(1)
          .max(50),
        finished: z
          .array(z.object({ item_name: z.string(), qty: z.number().positive() }))
          .min(1)
          .max(20),
        confirm: z.boolean().default(false),
      }),
      execute: async (input) => {
        return await createManufacturingVoucher(supabase, companyId, input);
      },
    }),
  };
}

// ---------- Server-side posting helpers (mirror src/lib/voucher-postings.ts) ----------
async function getOrCreateSysLedger(
  supabase: DB,
  companyId: string,
  name: string,
  type: Database["public"]["Enums"]["ledger_type"],
): Promise<string> {
  const { data: existing } = await supabase
    .from("ledgers")
    .select("id")
    .eq("company_id", companyId)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await supabase
    .from("ledgers")
    .insert({ company_id: companyId, name, type })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create ledger "${name}": ${error.message}`);
  return data.id;
}

async function resolveLedger(
  supabase: DB,
  companyId: string,
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const { data: matches } = await supabase
    .from("ledgers")
    .select("id, name")
    .eq("company_id", companyId)
    .ilike("name", `%${name}%`)
    .limit(5);
  if (!matches || matches.length === 0)
    return { error: `No ledger matching "${name}". Create it first via create_ledger.` };
  const exact = matches.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  if (matches.length === 1) return matches[0];
  return {
    error: `Multiple ledgers match "${name}": ${matches.map((m) => m.name).join(", ")}. Use the exact name.`,
  };
}

async function resolveItem(
  supabase: DB,
  companyId: string,
  name: string,
): Promise<
  | { id: string; name: string; unit: string; gst_rate: number; sale_price_paise: number; purchase_price_paise: number }
  | { error: string }
> {
  const { data: matches } = await supabase
    .from("items")
    .select("id, name, unit, gst_rate, sale_price_paise, purchase_price_paise")
    .eq("company_id", companyId)
    .ilike("name", `%${name}%`)
    .limit(5);
  if (!matches || matches.length === 0)
    return { error: `No item matching "${name}". Create it from Items master first.` };
  const exact = matches.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  if (matches.length === 1) return matches[0];
  return { error: `Multiple items match "${name}": ${matches.map((m) => m.name).join(", ")}. Use the exact name.` };
}

async function createItemVoucher(
  supabase: DB,
  companyId: string,
  input: {
    voucher_type: "sales" | "purchase" | "credit_note" | "debit_note";
    date: string;
    party_name: string;
    party_type?: "sundry_debtor" | "sundry_creditor";
    party_state?: string;
    party_state_code?: string;
    party_gstin?: string;
    reference_no?: string;
    narration?: string;
    posting_account_name?: string;
    posting_account_type?:
      | "fixed_asset"
      | "current_asset"
      | "income_direct"
      | "income_indirect"
      | "expense_direct"
      | "expense_indirect";
    items: Array<{
      item_name: string;
      qty: number;
      rate_rupees: number;
      discount_rupees?: number;
      gst_rate_override?: number;
      unit?: string;
      hsn_code?: string;
      gst_rate?: number;
    }>;
    confirm: boolean;
  },
) {
  // Resolve party + company state for interstate detection. Auto-create the
  // party ledger if missing and the caller provided a party_type hint.
  let party: { id: string; name: string };
  const partyResolved = await resolveLedger(supabase, companyId, input.party_name);
  if ("error" in partyResolved) {
    const defaultType: "sundry_debtor" | "sundry_creditor" =
      input.party_type ??
      (input.voucher_type === "sales" || input.voucher_type === "credit_note"
        ? "sundry_debtor"
        : "sundry_creditor");
    const { data: newParty, error: pErr } = await supabase
      .from("ledgers")
      .insert({
        company_id: companyId,
        name: input.party_name,
        type: defaultType as Database["public"]["Enums"]["ledger_type"],
        state: input.party_state ?? null,
        state_code: input.party_state_code ?? null,
        gstin: input.party_gstin ?? null,
      })
      .select("id, name")
      .single();
    if (pErr || !newParty) return { error: `Could not create party "${input.party_name}": ${pErr?.message ?? "unknown"}` };
    party = newParty;
  } else {
    party = partyResolved;
  }
  const { data: partyRow } = await supabase
    .from("ledgers")
    .select("state_code, state")
    .eq("id", party.id)
    .maybeSingle();
  const { data: companyRow } = await supabase
    .from("companies")
    .select("state_code, gst_registered")
    .eq("id", companyId)
    .maybeSingle();
  const interstate =
    !!partyRow?.state_code && !!companyRow?.state_code && partyRow.state_code !== companyRow.state_code;
  const gstApplies = companyRow?.gst_registered === true;

  // Resolve items + compute line totals
  const lines: Array<{
    item_id: string;
    item_name: string;
    qty: number;
    rate_paise: number;
    discount_paise: number;
    amount_paise: number;
    taxable_paise: number;
    gst_rate: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    total_paise: number;
  }> = [];
  for (const ln of input.items) {
    let it:
      | { id: string; name: string; unit: string; gst_rate: number; sale_price_paise: number; purchase_price_paise: number }
      | { error: string } = await resolveItem(supabase, companyId, ln.item_name);
    if ("error" in it) {
      // Auto-create the item when the caller provided enough master info.
      if (ln.unit || ln.hsn_code || ln.gst_rate != null) {
        const { data: created, error: cErr } = await supabase
          .from("items")
          .insert({
            company_id: companyId,
            name: ln.item_name,
            unit: ln.unit ?? "NOS",
            gst_rate: ln.gst_rate ?? 0,
            hsn_code: ln.hsn_code ?? null,
            purchase_price_paise:
              input.voucher_type === "purchase" || input.voucher_type === "debit_note"
                ? Math.round(ln.rate_rupees * 100)
                : 0,
            sale_price_paise:
              input.voucher_type === "sales" || input.voucher_type === "credit_note"
                ? Math.round(ln.rate_rupees * 100)
                : 0,
          })
          .select("id, name, unit, gst_rate, sale_price_paise, purchase_price_paise")
          .single();
        if (cErr || !created) return { error: `Could not auto-create item "${ln.item_name}": ${cErr?.message ?? "unknown"}` };
        it = created;
      } else {
        return {
          error:
            it.error +
            ` Provide unit, gst_rate and (optionally) hsn_code on the line to auto-create it.`,
        };
      }
    }
    const rate_paise = Math.round(ln.rate_rupees * 100);
    const qty = ln.qty;
    const discount_paise = Math.round((ln.discount_rupees ?? 0) * 100);
    const amount_paise = Math.round(qty * rate_paise);
    const taxable_paise = Math.max(0, amount_paise - discount_paise);
    const gst_rate = gstApplies ? (ln.gst_rate_override ?? it.gst_rate ?? 0) : 0;
    const gstTotal = Math.round((taxable_paise * gst_rate) / 100);
    const cgst_paise = !interstate && gst_rate > 0 ? Math.round(gstTotal / 2) : 0;
    const sgst_paise = !interstate && gst_rate > 0 ? gstTotal - cgst_paise : 0;
    const igst_paise = interstate && gst_rate > 0 ? gstTotal : 0;
    const total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise;
    lines.push({
      item_id: it.id,
      item_name: it.name,
      qty,
      rate_paise,
      discount_paise,
      amount_paise,
      taxable_paise,
      gst_rate,
      cgst_paise,
      sgst_paise,
      igst_paise,
      total_paise,
    });
  }

  const subtotal_paise = lines.reduce((s, l) => s + l.taxable_paise, 0);
  const cgst_paise = lines.reduce((s, l) => s + l.cgst_paise, 0);
  const sgst_paise = lines.reduce((s, l) => s + l.sgst_paise, 0);
  const igst_paise = lines.reduce((s, l) => s + l.igst_paise, 0);
  const total_paise = subtotal_paise + cgst_paise + sgst_paise + igst_paise;

  const preview = {
    action: "create_item_voucher" as const,
    voucher_type: input.voucher_type,
    date: input.date,
    party: party.name,
    interstate,
    reference_no: input.reference_no ?? null,
    narration: input.narration ?? null,
    lines: lines.map((l) => ({
      item: l.item_name,
      qty: l.qty,
      rate: rupees(l.rate_paise),
      taxable: rupees(l.taxable_paise),
      gst_rate: `${l.gst_rate}%`,
      tax: rupees(l.cgst_paise + l.sgst_paise + l.igst_paise),
      line_total: rupees(l.total_paise),
    })),
    subtotal_rupees: rupees(subtotal_paise),
    cgst_rupees: rupees(cgst_paise),
    sgst_rupees: rupees(sgst_paise),
    igst_rupees: rupees(igst_paise),
    total_rupees: rupees(total_paise),
  };
  if (!input.confirm) return { preview, requires_confirmation: true };

  // Insert voucher
  const { data: vno, error: rpcErr } = await supabase.rpc("next_voucher_number", {
    _company_id: companyId,
    _type: input.voucher_type as Database["public"]["Enums"]["voucher_type"],
  });
  if (rpcErr || !vno) return { error: rpcErr?.message ?? "Could not generate voucher number" };
  const { data: auth } = await supabase.auth.getUser();
  const created_by = auth.user?.id;
  if (!created_by) return { error: "Not authenticated" };

  const { data: v, error: vErr } = await supabase
    .from("vouchers")
    .insert({
      company_id: companyId,
      created_by,
      voucher_type: input.voucher_type as Database["public"]["Enums"]["voucher_type"],
      voucher_number: vno as string,
      voucher_date: input.date,
      party_ledger_id: party.id,
      reference_no: input.reference_no ?? null,
      narration: input.narration ?? null,
      is_interstate: interstate,
      subtotal_paise,
      cgst_paise,
      sgst_paise,
      igst_paise,
      total_paise,
    })
    .select("id, voucher_number")
    .single();
  if (vErr || !v) return { error: vErr?.message ?? "Failed to create voucher" };

  const { error: iErr } = await supabase.from("voucher_items").insert(
    lines.map((l, i) => ({
      voucher_id: v.id,
      item_id: l.item_id,
      line_no: i + 1,
      qty: l.qty,
      rate_paise: l.rate_paise,
      discount_paise: l.discount_paise,
      amount_paise: l.amount_paise,
      taxable_paise: l.taxable_paise,
      gst_rate: l.gst_rate,
      cgst_paise: l.cgst_paise,
      sgst_paise: l.sgst_paise,
      igst_paise: l.igst_paise,
    })),
  );
  if (iErr) {
    await supabase.from("vouchers").delete().eq("id", v.id);
    return { error: `Item insert failed: ${iErr.message}` };
  }

  // Build double-entry postings
  const isSalesSide = input.voucher_type === "sales" || input.voucher_type === "credit_note";
  const baseName =
    input.voucher_type === "sales"
      ? "Sales A/c"
      : input.voucher_type === "purchase"
        ? "Purchase A/c"
        : input.voucher_type === "credit_note"
          ? "Sales Return A/c"
          : "Purchase Return A/c";
  const baseType: Database["public"]["Enums"]["ledger_type"] = isSalesSide ? "income_direct" : "expense_direct";
  const baseId = await getOrCreateSysLedger(supabase, companyId, baseName, baseType);
  const cgstId =
    cgst_paise > 0
      ? await getOrCreateSysLedger(
          supabase,
          companyId,
          isSalesSide ? "Output CGST" : "Input CGST",
          "duties_taxes",
        )
      : null;
  const sgstId =
    sgst_paise > 0
      ? await getOrCreateSysLedger(
          supabase,
          companyId,
          isSalesSide ? "Output SGST" : "Input SGST",
          "duties_taxes",
        )
      : null;
  const igstId =
    igst_paise > 0
      ? await getOrCreateSysLedger(
          supabase,
          companyId,
          isSalesSide ? "Output IGST" : "Input IGST",
          "duties_taxes",
        )
      : null;

  const entries: Array<{ ledger_id: string; debit_paise: number; credit_paise: number; line_no: number }> = [];
  let lineNo = 1;
  if (input.voucher_type === "sales") {
    entries.push({ ledger_id: party.id, debit_paise: total_paise, credit_paise: 0, line_no: lineNo++ });
    entries.push({ ledger_id: baseId, debit_paise: 0, credit_paise: subtotal_paise, line_no: lineNo++ });
    if (cgstId) entries.push({ ledger_id: cgstId, debit_paise: 0, credit_paise: cgst_paise, line_no: lineNo++ });
    if (sgstId) entries.push({ ledger_id: sgstId, debit_paise: 0, credit_paise: sgst_paise, line_no: lineNo++ });
    if (igstId) entries.push({ ledger_id: igstId, debit_paise: 0, credit_paise: igst_paise, line_no: lineNo++ });
  } else if (input.voucher_type === "purchase") {
    entries.push({ ledger_id: baseId, debit_paise: subtotal_paise, credit_paise: 0, line_no: lineNo++ });
    if (cgstId) entries.push({ ledger_id: cgstId, debit_paise: cgst_paise, credit_paise: 0, line_no: lineNo++ });
    if (sgstId) entries.push({ ledger_id: sgstId, debit_paise: sgst_paise, credit_paise: 0, line_no: lineNo++ });
    if (igstId) entries.push({ ledger_id: igstId, debit_paise: igst_paise, credit_paise: 0, line_no: lineNo++ });
    entries.push({ ledger_id: party.id, debit_paise: 0, credit_paise: total_paise, line_no: lineNo++ });
  } else if (input.voucher_type === "credit_note") {
    entries.push({ ledger_id: baseId, debit_paise: subtotal_paise, credit_paise: 0, line_no: lineNo++ });
    if (cgstId) entries.push({ ledger_id: cgstId, debit_paise: cgst_paise, credit_paise: 0, line_no: lineNo++ });
    if (sgstId) entries.push({ ledger_id: sgstId, debit_paise: sgst_paise, credit_paise: 0, line_no: lineNo++ });
    if (igstId) entries.push({ ledger_id: igstId, debit_paise: igst_paise, credit_paise: 0, line_no: lineNo++ });
    entries.push({ ledger_id: party.id, debit_paise: 0, credit_paise: total_paise, line_no: lineNo++ });
  } else {
    entries.push({ ledger_id: party.id, debit_paise: total_paise, credit_paise: 0, line_no: lineNo++ });
    entries.push({ ledger_id: baseId, debit_paise: 0, credit_paise: subtotal_paise, line_no: lineNo++ });
    if (cgstId) entries.push({ ledger_id: cgstId, debit_paise: 0, credit_paise: cgst_paise, line_no: lineNo++ });
    if (sgstId) entries.push({ ledger_id: sgstId, debit_paise: 0, credit_paise: sgst_paise, line_no: lineNo++ });
    if (igstId) entries.push({ ledger_id: igstId, debit_paise: 0, credit_paise: igst_paise, line_no: lineNo++ });
  }
  const { error: eErr } = await supabase.from("voucher_entries").insert(
    entries.map((e) => ({ ...e, voucher_id: v.id })),
  );
  if (eErr) {
    await supabase.from("vouchers").delete().eq("id", v.id);
    return { error: `Posting failed: ${eErr.message}` };
  }

  return { ok: true, voucher_number: v.voucher_number, voucher_id: v.id, total_rupees: rupees(total_paise) };
}

async function createManufacturingVoucher(
  supabase: DB,
  companyId: string,
  input: {
    date: string;
    narration?: string;
    consumption: Array<{ item_name: string; qty: number; rate_rupees: number }>;
    finished: Array<{ item_name: string; qty: number }>;
    confirm: boolean;
  },
) {
  const consumed: Array<{ item_id: string; name: string; qty: number; rate_paise: number; value_paise: number }> = [];
  for (const c of input.consumption) {
    const it = await resolveItem(supabase, companyId, c.item_name);
    if ("error" in it) return { error: it.error };
    const rate_paise = Math.round(c.rate_rupees * 100);
    consumed.push({
      item_id: it.id,
      name: it.name,
      qty: c.qty,
      rate_paise,
      value_paise: Math.round(c.qty * rate_paise),
    });
  }
  const totalConsumption = consumed.reduce((s, c) => s + c.value_paise, 0);
  const totalFinishedQty = input.finished.reduce((s, f) => s + f.qty, 0);
  if (totalFinishedQty <= 0) return { error: "Finished goods total qty must be > 0" };

  const finished: Array<{ item_id: string; name: string; qty: number; rate_paise: number; value_paise: number }> = [];
  for (const f of input.finished) {
    const it = await resolveItem(supabase, companyId, f.item_name);
    if ("error" in it) return { error: it.error };
    const value_paise = Math.round((f.qty / totalFinishedQty) * totalConsumption);
    finished.push({
      item_id: it.id,
      name: it.name,
      qty: f.qty,
      rate_paise: f.qty > 0 ? Math.round(value_paise / f.qty) : 0,
      value_paise,
    });
  }

  const preview = {
    action: "create_manufacturing_voucher" as const,
    date: input.date,
    narration: input.narration ?? null,
    consumption: consumed.map((c) => ({
      item: c.name,
      qty: c.qty,
      rate: rupees(c.rate_paise),
      value: rupees(c.value_paise),
    })),
    finished: finished.map((f) => ({
      item: f.name,
      qty: f.qty,
      effective_rate: rupees(f.rate_paise),
      value: rupees(f.value_paise),
    })),
    total_consumption_rupees: rupees(totalConsumption),
  };
  if (!input.confirm) return { preview, requires_confirmation: true };

  const { data: vno, error: rpcErr } = await supabase.rpc("next_voucher_number", {
    _company_id: companyId,
    _type: "manufacturing" as Database["public"]["Enums"]["voucher_type"],
  });
  if (rpcErr || !vno) return { error: rpcErr?.message ?? "Could not generate voucher number" };
  const { data: auth } = await supabase.auth.getUser();
  const created_by = auth.user?.id;
  if (!created_by) return { error: "Not authenticated" };

  const { data: v, error: vErr } = await supabase
    .from("vouchers")
    .insert({
      company_id: companyId,
      created_by,
      voucher_type: "manufacturing" as Database["public"]["Enums"]["voucher_type"],
      voucher_number: vno as string,
      voucher_date: input.date,
      narration: input.narration ?? null,
      subtotal_paise: totalConsumption,
      total_paise: totalConsumption,
    })
    .select("id, voucher_number")
    .single();
  if (vErr || !v) return { error: vErr?.message ?? "Failed to create voucher" };

  // Consumption rows are negative qty, finished are positive — mirror ManufacturingVoucherForm convention.
  const itemRows = [
    ...consumed.map((c, i) => ({
      voucher_id: v.id,
      item_id: c.item_id,
      line_no: i + 1,
      qty: -c.qty,
      rate_paise: c.rate_paise,
      amount_paise: -c.value_paise,
      taxable_paise: -c.value_paise,
      gst_rate: 0,
    })),
    ...finished.map((f, i) => ({
      voucher_id: v.id,
      item_id: f.item_id,
      line_no: consumed.length + i + 1,
      qty: f.qty,
      rate_paise: f.rate_paise,
      amount_paise: f.value_paise,
      taxable_paise: f.value_paise,
      gst_rate: 0,
    })),
  ];
  const { error: iErr } = await supabase.from("voucher_items").insert(itemRows);
  if (iErr) {
    await supabase.from("vouchers").delete().eq("id", v.id);
    return { error: `Item insert failed: ${iErr.message}` };
  }

  // Ledger: Dr Finished Goods / Cr Raw Materials (both under STOCK_IN_HAND)
  const fgId = await getOrCreateSysLedger(supabase, companyId, "Finished Goods", "stock_in_hand");
  const rmId = await getOrCreateSysLedger(supabase, companyId, "Raw Materials", "stock_in_hand");
  const { error: eErr } = await supabase.from("voucher_entries").insert([
    { voucher_id: v.id, ledger_id: fgId, debit_paise: totalConsumption, credit_paise: 0, line_no: 1 },
    { voucher_id: v.id, ledger_id: rmId, debit_paise: 0, credit_paise: totalConsumption, line_no: 2 },
  ]);
  if (eErr) {
    await supabase.from("vouchers").delete().eq("id", v.id);
    return { error: `Posting failed: ${eErr.message}` };
  }
  return { ok: true, voucher_number: v.voucher_number, voucher_id: v.id, total_rupees: rupees(totalConsumption) };
}

// Shared helper: resolve ledgers by fuzzy name and either preview or insert the voucher.
async function createGenericVoucher(
  supabase: DB,
  companyId: string,
  args: {
    voucher_type: "journal" | "payment" | "receipt" | "contra";
    date: string;
    narration?: string;
    lines: Array<{ ledger_name: string; debit_rupees?: number; credit_rupees?: number }>;
    confirm: boolean;
  },
) {
  // Resolve ledgers
  const resolved: Array<{
    ledger_id: string;
    ledger_name: string;
    debit_paise: number;
    credit_paise: number;
  }> = [];
  for (const ln of args.lines) {
    const dr = Math.round((ln.debit_rupees ?? 0) * 100);
    const cr = Math.round((ln.credit_rupees ?? 0) * 100);
    if (dr <= 0 && cr <= 0) return { error: `Line for "${ln.ledger_name}" has no amount.` };
    if (dr > 0 && cr > 0) return { error: `Line for "${ln.ledger_name}" cannot be both Dr and Cr.` };
    const { data: matches } = await supabase
      .from("ledgers")
      .select("id, name")
      .eq("company_id", companyId)
      .ilike("name", `%${ln.ledger_name}%`)
      .limit(2);
    if (!matches || matches.length === 0) {
      return {
        error: `No ledger matching "${ln.ledger_name}". Create it first using create_ledger.`,
      };
    }
    if (matches.length > 1) {
      const exact = matches.find((m) => m.name.toLowerCase() === ln.ledger_name.toLowerCase());
      if (!exact) {
        return {
          error: `Multiple ledgers match "${ln.ledger_name}": ${matches.map((m) => m.name).join(", ")}. Use the exact name.`,
        };
      }
      resolved.push({ ledger_id: exact.id, ledger_name: exact.name, debit_paise: dr, credit_paise: cr });
    } else {
      resolved.push({ ledger_id: matches[0].id, ledger_name: matches[0].name, debit_paise: dr, credit_paise: cr });
    }
  }

  const totalDr = resolved.reduce((s, r) => s + r.debit_paise, 0);
  const totalCr = resolved.reduce((s, r) => s + r.credit_paise, 0);
  if (totalDr !== totalCr) {
    return {
      error: `Voucher does not balance: Dr ₹${rupees(totalDr)} vs Cr ₹${rupees(totalCr)}.`,
    };
  }

  const preview = {
    action: "create_voucher" as const,
    voucher_type: args.voucher_type,
    date: args.date,
    narration: args.narration ?? null,
    total_rupees: rupees(totalDr),
    lines: resolved.map((r) => ({
      ledger: r.ledger_name,
      dr: r.debit_paise > 0 ? rupees(r.debit_paise) : "",
      cr: r.credit_paise > 0 ? rupees(r.credit_paise) : "",
    })),
  };
  if (!args.confirm) return { preview, requires_confirmation: true };

  // Get next voucher number via RPC
  const { data: vno, error: rpcErr } = await supabase.rpc("next_voucher_number", {
    _company_id: companyId,
    _type: args.voucher_type as Database["public"]["Enums"]["voucher_type"],
  });
  if (rpcErr || !vno) return { error: rpcErr?.message ?? "Could not generate voucher number" };

  const { data: auth } = await supabase.auth.getUser();
  const created_by = auth.user?.id;
  if (!created_by) return { error: "Not authenticated" };

  const { data: v, error: vErr } = await supabase
    .from("vouchers")
    .insert({
      company_id: companyId,
      voucher_type: args.voucher_type as Database["public"]["Enums"]["voucher_type"],
      voucher_date: args.date,
      voucher_number: vno as string,
      narration: args.narration ?? null,
      subtotal_paise: totalDr,
      total_paise: totalDr,
      created_by,
    })
    .select("id, voucher_number")
    .single();
  if (vErr || !v) return { error: vErr?.message ?? "Failed to create voucher" };

  const { error: eErr } = await supabase.from("voucher_entries").insert(
    resolved.map((r, i) => ({
      voucher_id: v.id,
      ledger_id: r.ledger_id,
      debit_paise: r.debit_paise,
      credit_paise: r.credit_paise,
      line_no: i + 1,
    })),
  );
  if (eErr) {
    await supabase.from("vouchers").delete().eq("id", v.id);
    return { error: `Posting failed: ${eErr.message}` };
  }
  return { ok: true, voucher_number: v.voucher_number, voucher_id: v.id };
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
    let role: "admin" | "accountant" | "viewer" = "viewer";
    if (data.companyId) {
      try {
        role = await ensureMember(supabase as DB, data.companyId, userId);
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
    const canWrite = role === "admin" || role === "accountant";

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
    const system = `You are Mate, an in-app accounting assistant for an Indian GST accounting application. You are FULLY ACCOUNTABLE for turning the user's plain-language transaction requests into correctly posted vouchers.

Active company: ${companyName} (id: ${data.companyId ?? "none"})
Today's date: ${today}
Your role here: ${role}${canWrite ? " (you may PROPOSE write actions)" : " (READ-ONLY — do NOT call any create_* tool)"}

READ rules:
- For READ questions, always call a tool — never make up numbers.
- Present money in Indian rupees with "₹" and Dr/Cr where applicable.
- If a date isn't given, use today (${today}) for "as of" balances, or the current FY for period reports.
- For "how do I…" / settings questions, use search_help and quote it briefly.
- If no company is active, ask the user to pick one before any data action.

TRANSACTION TOOLKIT (use the most specific tool for what the user asked):
- create_ledger — new party / expense / income / bank / cash ledger
- create_item — new inventory item master
- create_contra_voucher — money transfer between two cash/bank accounts
- create_payment_voucher — money paid OUT (cash/bank → party or expense)
- create_receipt_voucher — money received IN (party or income → cash/bank)
- create_journal_voucher — any other manual double-entry adjustment
- create_item_voucher — Sales, Purchase, Credit Note, Debit Note with items, qty, rate, GST
- create_manufacturing_voucher — raw-material consumption + finished-goods production

MISSING MASTERS — auto-create in the same step, do NOT punt back to the user:
- If the party doesn't exist, pass party_type on create_item_voucher (sundry_creditor for purchase/debit_note, sundry_debtor for sales/credit_note). Also pass party_state / party_state_code / party_gstin if the user mentioned them.
- If an item doesn't exist, pass unit, gst_rate and hsn_code (if known) on that line of create_item_voucher — the tool will create the item master automatically. Tax-free = gst_rate 0.
- Only fall back to a separate create_item / create_ledger call (with the confirm-first preview flow) when the user is creating masters in isolation, not as part of a voucher.
- NEVER tell the user to "open Items" or "go to Ledgers" first — you are accountable for completing the transaction end-to-end.

MANDATORY WORKFLOW for every transaction request:
1. Pick the single most appropriate tool. Never use a journal when a specific tool exists.
2. Fill in missing fields with sensible defaults: date = today, narration = a one-line purpose, interstate auto-detected from the party's state.
3. If a referenced party or item is missing, auto-create it inline via the voucher tool's party_type / line.unit+gst_rate+hsn_code fields. Do NOT ask the user to open masters. Only fall back to a standalone create_ledger/create_item call when the user is explicitly managing masters.
4. Call the chosen create_* tool with confirm=false. It returns a structured preview.
5. Render the preview to the user as a clean markdown table (Date, Party, Lines with Dr/Cr or qty×rate, GST split, Total, Narration) and ask them to reply **"yes"** to post or **"no"** to cancel.
6. ONLY after the user replies with an unambiguous yes / confirm / post / go-ahead, call the SAME tool again with confirm=true and otherwise IDENTICAL arguments.
7. After posting, reply with the voucher number, total, and a one-line confirmation. Do NOT post twice.

Quality rules:
- A journal must balance (Dr = Cr) to the paise.
- For item vouchers, GST is computed automatically — do NOT add it to the rate.
- For manufacturing, finished-goods value is auto-split pro-rata by output qty across the total consumption value; do not pass rates for finished goods.
- If a tool returns { error }, surface it in plain language and suggest the precise next step (create the missing ledger, fix the date, use exact name, etc.). Never silently retry with made-up data.
- If a period is locked, surface the database error verbatim and suggest a Credit/Debit Note in the current period.
- Keep narrations short (party name or one-line purpose).

Other:
- Use markdown (bullets, **bold**, short tables) for readability.
- Never reveal raw IDs unless explicitly asked. Never expose other users' data.`;

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
