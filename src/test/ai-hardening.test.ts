import { beforeEach, describe, expect, it } from "vitest";
import { routeQuery } from "@/lib/ai/query-router";
import { runAccountingQuery, runTrialBalance } from "@/lib/ai/accounting-query-engine";
import { clearToolCache, executeTool } from "@/lib/ai/tools";
import { resolveBankAlias, findBankInText, BANK_ALIAS_PATTERN } from "@/lib/ai/bank-aliases";
import { coerceDateArg, normalizeStoredDate, validateDateArgs } from "@/lib/ai/ai-validation";
import { offlineDb } from "@/lib/offline/db";

const CO = "co-ai-hardening";

describe("as-on dates from tool arguments are checked", () => {
  it("accepts real calendar dates and missing values only", () => {
    expect(coerceDateArg("2025-03-31")).toEqual({ ok: true, value: "2025-03-31" });
    expect(coerceDateArg(null)).toEqual({ ok: true, value: null });
    expect(coerceDateArg("last month").ok).toBe(false);
    expect(coerceDateArg("2025-02-30").ok).toBe(false);
    expect(coerceDateArg("2025-4-5").ok).toBe(false);
  });

  it("the trial balance and ledger engines refuse a malformed as-on date", async () => {
    await expect(runTrialBalance({ asOn: "last month" })).resolves.toMatchObject({ status: "invalid_date" });
    await expect(
      runAccountingQuery({ kind: "cash_balance", asOn: "2025-13-01", companyId: CO }),
    ).resolves.toMatchObject({ status: "invalid_date" });
  });

  it("the tool layer returns an error for a malformed date argument before running anything", async () => {
    expect(validateDateArgs({ asOn: "last month" })).toMatch(/asOn must be a real date/);
    expect(validateDateArgs({ asOn: "2025-03-31", from: "2025-04-01" })).toBeNull();
    const res = await executeTool("get_trial_balance", { asOn: "last month" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/YYYY-MM-DD/);
  });
});

describe("stored voucher dates are normalised", () => {
  it("pads unpadded ISO dates and drops impossible ones", () => {
    expect(normalizeStoredDate("2025-4-5")).toBe("2025-04-05");
    expect(normalizeStoredDate("2025-04-05T10:30:00Z")).toBe("2025-04-05");
    expect(normalizeStoredDate("2025-02-30")).toBe("");
    expect(normalizeStoredDate(undefined)).toBe("");
  });
});

describe("one bank alias list", () => {
  it("resolves short names and full names to the same canonical bank", () => {
    expect(resolveBankAlias("kotak")).toBe("Kotak Mahindra Bank Ltd");
    expect(resolveBankAlias("Kotak Mahindra Bank Ltd")).toBe("Kotak Mahindra Bank Ltd");
    expect(resolveBankAlias("INDUSIND BANK")).toBe("INDUSIND BANK");
    expect(resolveBankAlias("ubi")).toBe("Union Bank of India");
    expect(resolveBankAlias("bom")).toBe("Bank of Maharashtra");
  });

  it("finds the longest bank name in text and never matches bare yes or union", () => {
    expect(findBankInText("bank of baroda statement")).toBe("Bank of Baroda");
    expect(findBankInText("Union Bank of India balance")).toBe("Union Bank of India");
    expect(findBankInText("Yes, show bank balance")).toBeUndefined();
    expect(findBankInText("union leader balance")).toBeUndefined();
    expect(new RegExp(`\\b${BANK_ALIAS_PATTERN}\\b`, "i").test("yes")).toBe(false);
  });
});

describe("router", () => {
  it("does not treat ordinary English 'yes' or 'union' as a bank", () => {
    expect(routeQuery("Yes, show bank balance").entity?.accountName).toBeUndefined();
    expect(routeQuery("union leader balance").intent).not.toBe("bank_balance");
  });

  it("still resolves explicit bank names", () => {
    expect(routeQuery("yes bank balance").entity?.accountName).toBe("YES Bank");
    expect(routeQuery("sbi balance").entity?.accountName).toBe("State Bank of India");
  });

  it("does not read a year or financial year as an amount", () => {
    expect(routeQuery("balance of Kiran Traders 2025").entity?.amount).toBeUndefined();
    expect(routeQuery("balance of Kiran Traders FY 2025-26").entity?.amount).toBeUndefined();
    expect(routeQuery("balance of Kiran Traders rs 2025").entity?.amount).toBe(2025);
    expect(routeQuery("balance of Kiran Traders 5000").entity?.amount).toBe(5000);
  });

  it("latestKind is only a date mode, never a voucher type", () => {
    const r = routeQuery("balance of Kiran Traders sales");
    expect(r.entity?.voucherType).toBe("sales");
    expect(["latest", "year_end"]).toContain(r.latestKind);
  });
});

describe("tool answer cache", () => {
  it("clearToolCache can be called at any time without error", () => {
    expect(() => clearToolCache()).not.toThrow();
  });
});

describe("stored dates in a real trial balance", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_active_company_id", CO);
    await Promise.all([
      offlineDb.cache_ledgers.clear(),
      offlineDb.cache_vouchers.clear(),
      offlineDb.cache_voucher_entries.clear(),
    ]);
    const now = new Date().toISOString();
    await offlineDb.cache_ledgers.bulkPut([
      { id: "led-cash", company_id: CO, name: "Cash-in-Hand", group_name: "Cash-in-Hand", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
      { id: "led-sales", company_id: CO, name: "Sales Account", group_name: "Sales Accounts", opening_balance_paise: 0, opening_balance_is_debit: true, updated_at: now },
    ] as never[]);
    // One unpadded legacy date ("2025-4-5") and one padded date, both inside the April period.
    await offlineDb.cache_vouchers.bulkPut([
      { id: "v1", company_id: CO, voucher_type: "receipt", voucher_number: "1", voucher_date: "2025-4-5", updated_at: now },
      { id: "v2", company_id: CO, voucher_type: "receipt", voucher_number: "2", voucher_date: "2025-04-10", updated_at: now },
    ] as never[]);
    await offlineDb.cache_voucher_entries.bulkPut([
      { id: "v1-e1", voucher_id: "v1", ledger_id: "led-cash", company_id: CO, debit_paise: 100000, credit_paise: 0 },
      { id: "v1-e2", voucher_id: "v1", ledger_id: "led-sales", company_id: CO, debit_paise: 0, credit_paise: 100000 },
      { id: "v2-e1", voucher_id: "v2", ledger_id: "led-cash", company_id: CO, debit_paise: 200000, credit_paise: 0 },
      { id: "v2-e2", voucher_id: "v2", ledger_id: "led-sales", company_id: CO, debit_paise: 0, credit_paise: 200000 },
    ] as never[]);
  });

  it("includes the unpadded legacy voucher in the cash balance as of 30 April", async () => {
    const res = await runAccountingQuery({ kind: "cash_balance", asOn: "2025-04-30", companyId: CO });
    expect(res).toMatchObject({ status: "resolved", debitPaise: 300000, entryCount: 2 });
  });

  it("excludes vouchers after the as-on date", async () => {
    const res = await runAccountingQuery({ kind: "cash_balance", asOn: "2025-04-07", companyId: CO });
    expect(res).toMatchObject({ status: "resolved", debitPaise: 100000, entryCount: 1 });
  });
});
