import { beforeAll, describe, expect, it } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { readLocalBookDataset } from "@/lib/offline/cache-read";

const COMPANY = "book-read-company";

beforeAll(async () => {
  await offlineDb.cache_ledgers.bulkPut([
    { id: "book-cash", company_id: COMPANY, name: "Cash", type: "cash", opening_balance_paise: 5000, opening_balance_is_debit: true },
    { id: "book-bank", company_id: COMPANY, name: "Bank", type: "bank" },
    { id: "book-party", company_id: COMPANY, name: "Party", type: "sundry_debtors" },
  ]);
  await offlineDb.cache_vouchers.bulkPut([
    { id: "book-v1", company_id: COMPANY, voucher_date: "2026-04-10", voucher_number: "1", voucher_type: "journal" },
    { id: "book-v2", company_id: COMPANY, voucher_date: "2026-05-10", voucher_number: "2", voucher_type: "receipt" },
  ]);
  await offlineDb.cache_voucher_entries.bulkPut([
    { id: "book-e1", company_id: COMPANY, voucher_id: "book-v1", ledger_id: "book-cash", debit_paise: 10000, credit_paise: 0 },
    { id: "book-e2", company_id: COMPANY, voucher_id: "book-v1", ledger_id: "book-party", debit_paise: 0, credit_paise: 10000 },
    { id: "book-e3", company_id: COMPANY, voucher_id: "book-v2", ledger_id: "book-bank", debit_paise: 20000, credit_paise: 0 },
    { id: "book-e4", company_id: COMPANY, voucher_id: "book-v2", ledger_id: "book-party", debit_paise: 0, credit_paise: 20000 },
  ]);
});

describe("local book dataset", () => {
  it("returns linked vouchers, ledger rows and counterpart entries in one read", async () => {
    const dataset = await readLocalBookDataset(COMPANY);

    expect(dataset.ledgers.map((ledger) => ledger.id).sort()).toEqual([
      "book-bank",
      "book-cash",
      "book-party",
    ]);
    expect(dataset.entries).toHaveLength(4);
    expect(dataset.entries.find((entry) => entry.id === "book-e1")?.vouchers).toMatchObject({
      id: "book-v1",
      voucher_date: "2026-04-10",
      voucher_type: "journal",
    });
    expect(dataset.entries.filter((entry) => entry.voucher_id === "book-v1")).toHaveLength(2);
  });
});