import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { ageBills, partyBalancesLocal, type PartyBalance } from "@/lib/offline/party-aging";

const CO = "pa-co";
const ASOF = "2026-03-31";

const bal = (partyId: string, paise: number): [string, PartyBalance] => [
  partyId,
  { partyId, name: partyId, msme: false, paise },
];

describe("ageBills", () => {
  it("applies unbilled receipts to the oldest bills so the total equals the ledger balance", () => {
    const bills = [
      { id: "A", partyId: "P", date: "2025-04-17", dueDate: null, totalPaise: 150000000, allocatedPaise: 0 },
      { id: "B", partyId: "P", date: "2025-08-01", dueDate: null, totalPaise: 100000000, allocatedPaise: 0 },
      { id: "C", partyId: "P", date: "2026-01-10", dueDate: null, totalPaise: 50000000, allocatedPaise: 0 },
    ];
    const r = ageBills(bills, new Map([bal("P", 84059700)]), ASOF);
    const total = r.aged.reduce((s, a) => s + a.pendingPaise, 0);
    expect(total).toBe(84059700);
    expect(r.aged.find((a) => a.id === "A")).toBeUndefined();
    expect(r.aged.find((a) => a.id === "B")?.pendingPaise).toBe(34059700);
    expect(r.aged.find((a) => a.id === "C")?.pendingPaise).toBe(50000000);
    expect(r.unbilled.size).toBe(0);
  });

  it("keeps a balance larger than the bills as unbilled", () => {
    const bills = [{ id: "A", partyId: "P", date: "2026-03-01", dueDate: null, totalPaise: 10000, allocatedPaise: 0 }];
    const r = ageBills(bills, new Map([bal("P", 15000)]), ASOF);
    expect(r.aged.reduce((s, a) => s + a.pendingPaise, 0)).toBe(10000);
    expect(r.unbilled.get("P")).toBe(5000);
  });

  it("clears bills of a party whose balance is zero or in credit", () => {
    const bills = [{ id: "A", partyId: "P", date: "2026-03-01", dueDate: null, totalPaise: 10000, allocatedPaise: 0 }];
    const r = ageBills(bills, new Map(), ASOF);
    expect(r.aged).toHaveLength(0);
  });

  it("uses the due date for ageing and respects explicit allocations", () => {
    const bills = [{ id: "A", partyId: "P", date: "2026-01-01", dueDate: "2026-01-31", totalPaise: 10000, allocatedPaise: 4000 }];
    const r = ageBills(bills, new Map([bal("P", 6000)]), ASOF);
    expect(r.aged[0].pendingPaise).toBe(6000);
    expect(r.aged[0].days).toBe(59);
    expect(r.aged[0].bucket).toBe(1);
  });
});

describe("partyBalancesLocal", () => {
  beforeEach(async () => {
    await Promise.all([db.cache_ledgers.clear(), db.cache_vouchers.clear(), db.cache_voucher_entries.clear()]);
    await db.cache_ledgers.bulkPut([
      { id: "D1", company_id: CO, name: "Debtor", type: "sundry_debtor", is_active: true, opening_balance_paise: 0, opening_balance_is_debit: true },
      { id: "C1", company_id: CO, name: "Creditor", type: "sundry_creditor", is_active: true, opening_balance_paise: 500, opening_balance_is_debit: false },
      { id: "SALES", company_id: CO, name: "Sales", type: "sales", is_active: true, opening_balance_paise: 0, opening_balance_is_debit: true },
    ]);
    await db.cache_vouchers.bulkPut([
      { id: "V1", company_id: CO, voucher_number: "S/1", voucher_type: "sales", voucher_date: "2026-01-01" },
      { id: "V2", company_id: CO, voucher_number: "R/1", voucher_type: "receipt", voucher_date: "2026-02-01" },
      { id: "V3", company_id: CO, voucher_number: "S/2", voucher_type: "sales", voucher_date: "2026-05-01" },
    ]);
    await db.cache_voucher_entries.bulkPut([
      { id: "e1", voucher_id: "V1", company_id: CO, ledger_id: "D1", debit_paise: 1000, credit_paise: 0 },
      { id: "e2", voucher_id: "V1", company_id: CO, ledger_id: "SALES", debit_paise: 0, credit_paise: 1000 },
      { id: "e3", voucher_id: "V2", company_id: CO, ledger_id: "D1", debit_paise: 0, credit_paise: 300 },
      { id: "e4", voucher_id: "V2", company_id: CO, ledger_id: "SALES", debit_paise: 300, credit_paise: 0 },
      { id: "e5", voucher_id: "V3", company_id: CO, ledger_id: "D1", debit_paise: 5000, credit_paise: 0 },
    ]);
  });

  it("nets receipts against the debtor balance as of the report date", async () => {
    const m = await partyBalancesLocal(CO, ASOF, "sundry_debtor");
    expect(m.get("D1")?.paise).toBe(700);
    expect(m.has("C1")).toBe(false);
  });

  it("returns creditor balances as positive amounts owed", async () => {
    const m = await partyBalancesLocal(CO, ASOF, "sundry_creditor");
    expect(m.get("C1")?.paise).toBe(500);
  });
});
