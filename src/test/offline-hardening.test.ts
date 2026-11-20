import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { normalizeVoucher } from "@/lib/offline/cache-normalizers";
import { commitStatement } from "@/lib/bank/local-store";
import { getEwbContextLocal } from "@/lib/offline/einvoice-local";

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "22222222-2222-4222-8222-222222222222";
const BANK = "33333333-3333-4333-8333-333333333333";

const line = (over: Record<string, unknown> = {}) => ({
  txn_date: "2026-04-05",
  description: "NEFT RAVI",
  reference: "",
  debit_paise: 50000,
  credit_paise: 0,
  balance_paise: 0,
  ...over,
});

beforeEach(async () => {
  await offlineDb.cache_bank_statement_lines.clear();
  await offlineDb.cache_bank_statements.clear();
  await offlineDb.cache_vouchers.clear();
  await offlineDb.cache_companies.clear();
});

describe("a deleted voucher is deleted for every reader", () => {
  it("treats a voucher with deleted_at as deleted even if is_deleted was never set", () => {
    expect((normalizeVoucher({ id: "v1", deleted_at: "2026-05-01T00:00:00Z" } as any) as any)?.is_deleted).toBe(true);
    expect((normalizeVoucher({ id: "v2" } as any) as any)?.is_deleted).toBe(false);
    expect((normalizeVoucher({ id: "v3", is_deleted: true } as any) as any)?.is_deleted).toBe(true);
  });
});

describe("bank statement import skips lines already imported", () => {
  it("imports only the new lines and reports how many were skipped", async () => {
    await commitStatement(CO_A, BANK, "jan.csv", [line()], []);
    const res = await commitStatement(CO_A, BANK, "jan-again.csv", [line(), line({ txn_date: "2026-04-06", description: "UPI" })], []);
    expect(res.skipped).toBe(1);
    const lines = await offlineDb.cache_bank_statement_lines.toArray();
    expect(lines.filter((l) => l.txn_date === "2026-04-06")).toHaveLength(1);
    expect(lines.filter((l) => l.description === "NEFT RAVI")).toHaveLength(1);
  });

  it("keeps a genuine repeat inside one statement (two identical charges)", async () => {
    await commitStatement(CO_A, BANK, "a.csv", [line({ description: "CHARGES" })], []);
    // The file now has two identical CHARGES lines; one is already stored, so one new line should import.
    const res = await commitStatement(CO_A, BANK, "b.csv", [line({ description: "CHARGES" }), line({ description: "CHARGES" })], []);
    expect(res.skipped).toBe(1);
    const charges = (await offlineDb.cache_bank_statement_lines.toArray()).filter((l) => l.description === "CHARGES");
    expect(charges).toHaveLength(2);
  });

  it("refuses a statement whose every line is already imported", async () => {
    await commitStatement(CO_A, BANK, "a.csv", [line()], []);
    await expect(commitStatement(CO_A, BANK, "a-again.csv", [line()], [])).rejects.toThrow(/already imported/);
  });

  it("does not treat the same line in another bank account as a duplicate", async () => {
    await commitStatement(CO_A, BANK, "a.csv", [line()], []);
    const res = await commitStatement(CO_A, "44444444-4444-4444-8444-444444444444", "a.csv", [line()], []);
    expect(res.skipped).toBe(0);
  });
});

describe("e-way bill context only uses a voucher from the company asked for", () => {
  it("returns no voucher when the id belongs to another company", async () => {
    await offlineDb.cache_companies.put({ id: CO_A, name: "A Traders", gstin: "24AAAAA0000A1Z5" });
    await offlineDb.cache_vouchers.put({ id: "v-b", company_id: CO_B, party_ledger_id: null, place_of_supply_code: "27" });
    const ctx = await getEwbContextLocal(CO_A, "v-b");
    expect(ctx.company?.name).toBe("A Traders");
    expect(ctx.voucher).toBeNull();
  });

  it("returns the voucher when it belongs to the company asked for", async () => {
    await offlineDb.cache_companies.put({ id: CO_A, name: "A Traders", gstin: "24AAAAA0000A1Z5" });
    await offlineDb.cache_vouchers.put({ id: "v-a", company_id: CO_A, party_ledger_id: null, place_of_supply_code: "24" });
    const ctx = await getEwbContextLocal(CO_A, "v-a");
    expect(ctx.voucher?.place_of_supply_code).toBe("24");
  });
});
