// Auto-posting invariant tests.
//
// buildItemVoucherPostings decides which debit/credit rows land on which
// system ledger for every sales/purchase/credit-note/debit-note voucher.
// A bug here silently corrupts the P&L, GST ledgers, and party balances.
// These tests mock the DB lookup (returns a stable synthetic id per name)
// and then assert:
//   - Dr = Cr on every generated posting
//   - the right ledger names are used per voucher kind
//   - ITC capitalisation behaves correctly (ineligible → GST folded in)
//   - round-off is posted on the correct side
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stable per-name id so we can assert "the party ledger got the total, the
// sales ledger got the subtotal", etc.
const nameById = new Map<string, string>();
const idByName = new Map<string, string>();
function idFor(name: string): string {
  const key = name.toLowerCase();
  const existing = idByName.get(key);
  if (existing) return existing;
  const id = `led-${idByName.size + 1}-${key.replace(/\s+/g, "_")}`;
  idByName.set(key, id);
  nameById.set(id, name);
  return id;
}

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from() {
        // A chainable stub that terminates on maybeSingle()/single() and
        // returns a synthetic ledger id derived from the ilike/insert name.
        let capturedName: string | null = null;
        const chain: Record<string, unknown> = {};
        const passthrough = () => chain;
        chain.select = passthrough;
        chain.eq = passthrough;
        chain.limit = passthrough;
        chain.ilike = (_col: string, name: string) => { capturedName = name; return chain; };
        chain.insert = (row: { name: string }) => {
          capturedName = row?.name ?? null;
          return chain;
        };
        chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
        chain.single = () => Promise.resolve({
          data: { id: capturedName ? idFor(capturedName) : "led-anon" },
          error: null,
        });
        return chain;
      },
    },
  };
});

import { buildItemVoucherPostings, type PostingTotals } from "@/lib/voucher-postings";

const PARTY = "party-led";

function balanced(entries: { debit_paise: number; credit_paise: number }[]) {
  const dr = entries.reduce((s, e) => s + e.debit_paise, 0);
  const cr = entries.reduce((s, e) => s + e.credit_paise, 0);
  return { dr, cr, ok: dr === cr };
}

function totals(sub = 10000, cgst = 900, sgst = 900, igst = 0, round = 0): PostingTotals {
  return {
    subtotal_paise: sub,
    cgst_paise: cgst,
    sgst_paise: sgst,
    igst_paise: igst,
    total_paise: sub + cgst + sgst + igst + round,
    round_off_paise: round,
  };
}

describe("buildItemVoucherPostings — invariants", () => {
  beforeEach(() => {
    nameById.clear();
    idByName.clear();
    // These tests exercise the cloud path via the supabase mock above; opt
    // out of local-only mode (the default) so lookups don't go to an empty
    // IndexedDB and mint random UUIDs.
    localStorage.setItem("ym_local_only_mode", "0");
  });

  it("intra-state sales: party Dr = subtotal+CGST+SGST Cr, balanced", async () => {
    const t = totals();
    const entries = await buildItemVoucherPostings("co", "sales", PARTY, t);
    const b = balanced(entries);
    expect(b.ok).toBe(true);
    expect(b.dr).toBe(t.total_paise);
    // Party gets the total on debit side
    const party = entries.find((e) => e.ledger_id === PARTY)!;
    expect(party.debit_paise).toBe(t.total_paise);
    expect(party.credit_paise).toBe(0);
    // Sales A/c is credited for the subtotal
    const sales = entries.find((e) => e.ledger_id === idFor("Sales A/c"))!;
    expect(sales.credit_paise).toBe(t.subtotal_paise);
  });

  it("inter-state sales: uses Output IGST, no CGST/SGST", async () => {
    const t = totals(10000, 0, 0, 1800);
    const entries = await buildItemVoucherPostings("co", "sales", PARTY, t);
    expect(balanced(entries).ok).toBe(true);
    expect(entries.some((e) => e.ledger_id === idFor("Output IGST"))).toBe(true);
    expect(entries.some((e) => e.ledger_id === idFor("Output CGST"))).toBe(false);
    expect(entries.some((e) => e.ledger_id === idFor("Output SGST"))).toBe(false);
  });

  it("purchase (inputs, eligible): Input CGST/SGST debited, party credited, balanced", async () => {
    const t = totals();
    const entries = await buildItemVoucherPostings("co", "purchase", PARTY, t, { itcClass: "inputs", itcEligible: true });
    const b = balanced(entries);
    expect(b.ok).toBe(true);
    const party = entries.find((e) => e.ledger_id === PARTY)!;
    expect(party.credit_paise).toBe(t.total_paise);
    expect(entries.some((e) => e.ledger_id === idFor("Purchase A/c") && e.debit_paise === t.subtotal_paise)).toBe(true);
    expect(entries.some((e) => e.ledger_id === idFor("Input CGST") && e.debit_paise === t.cgst_paise)).toBe(true);
  });

  it("purchase (ineligible ITC): GST is CAPITALISED into Purchase A/c, no Input GST posted", async () => {
    const t = totals();
    const entries = await buildItemVoucherPostings("co", "purchase", PARTY, t, { itcClass: "ineligible" });
    expect(balanced(entries).ok).toBe(true);
    const purchase = entries.find((e) => e.ledger_id === idFor("Purchase A/c"))!;
    expect(purchase.debit_paise).toBe(t.subtotal_paise + t.cgst_paise + t.sgst_paise + t.igst_paise);
    expect(entries.some((e) => e.ledger_id === idFor("Input CGST"))).toBe(false);
    expect(entries.some((e) => e.ledger_id === idFor("Input SGST"))).toBe(false);
  });

  it("purchase (capital_goods with per-item detail): per-item fixed-asset ledgers created, no pooled account", async () => {
    const t = totals(20000, 1800, 1800);
    const entries = await buildItemVoucherPostings("co", "purchase", PARTY, t, {
      itcClass: "capital_goods",
      itcEligible: true,
      capitalItems: [
        { name: "AC Machine", taxable_paise: 15000, cgst_paise: 1350, sgst_paise: 1350, igst_paise: 0 },
        { name: "Fan",        taxable_paise: 5000,  cgst_paise: 450,  sgst_paise: 450,  igst_paise: 0 },
      ],
    });
    expect(balanced(entries).ok).toBe(true);
    // Two per-item asset ledgers
    expect(entries.some((e) => e.ledger_id === idFor("AC Machine") && e.debit_paise === 15000)).toBe(true);
    expect(entries.some((e) => e.ledger_id === idFor("Fan")        && e.debit_paise === 5000)).toBe(true);
    // No pooled "Capital Goods A/c"
    expect(entries.some((e) => e.ledger_id === idFor("Capital Goods A/c"))).toBe(false);
  });

  it("credit note: Sales Return debited, party credited, balanced", async () => {
    const t = totals();
    const entries = await buildItemVoucherPostings("co", "credit_note", PARTY, t);
    expect(balanced(entries).ok).toBe(true);
    expect(entries.some((e) => e.ledger_id === idFor("Sales Return A/c") && e.debit_paise === t.subtotal_paise)).toBe(true);
    expect(entries.find((e) => e.ledger_id === PARTY)!.credit_paise).toBe(t.total_paise);
  });

  it("debit note (purchase return): party debited, Purchase Return credited, balanced", async () => {
    const t = totals();
    const entries = await buildItemVoucherPostings("co", "debit_note", PARTY, t, { itcClass: "inputs", itcEligible: true });
    expect(balanced(entries).ok).toBe(true);
    expect(entries.find((e) => e.ledger_id === PARTY)!.debit_paise).toBe(t.total_paise);
    expect(entries.some((e) => e.ledger_id === idFor("Purchase Return A/c"))).toBe(true);
  });

  it("round-off keeps books balanced (positive and negative)", async () => {
    const pos = await buildItemVoucherPostings("co", "sales", PARTY, totals(10000, 900, 900, 0, 1));
    expect(balanced(pos).ok).toBe(true);
    expect(pos.some((e) => e.ledger_id === idFor("Round Off") && e.credit_paise === 1)).toBe(true);

    const neg = await buildItemVoucherPostings("co", "sales", PARTY, totals(10000, 900, 900, 0, -1));
    expect(balanced(neg).ok).toBe(true);
    expect(neg.some((e) => e.ledger_id === idFor("Round Off") && e.debit_paise === 1)).toBe(true);
  });
});
