import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { runEntryVoucherCreate } from "@/lib/offline/voucher-executors";
import { listOpenBills, listSourceDocs, loadDocLines } from "@/lib/doc-linking";

const CO = "link-co";
const PARTY = "party-1";
const CASH = "cash-1";
const ITEM = "item-1";
const STAMP = "2026-07-07T00:00:00.000Z";

async function reset() {
  await Promise.all([
    offlineDb.cache_ledgers.clear(),
    offlineDb.cache_items.clear(),
    offlineDb.cache_vouchers.clear(),
    offlineDb.cache_voucher_entries.clear(),
    offlineDb.cache_voucher_items.clear(),
    offlineDb.cache_bill_allocations.clear(),
    offlineDb.meta.clear(),
  ]);
  await offlineDb.cache_ledgers.bulkPut([
    { id: CASH, company_id: CO, name: "Cash", type: "cash", updated_at: STAMP, is_deleted: false, is_active: true },
    { id: PARTY, company_id: CO, name: "Customer A", type: "sundry_debtor", updated_at: STAMP, is_deleted: false, is_active: true },
  ]);
  await offlineDb.cache_items.put({ id: ITEM, company_id: CO, name: "Item A", unit: "NOS", gst_rate: 0, updated_at: STAMP, is_deleted: false, is_active: true });
}

function voucher(id: string, type: string, number: string, total: number, extra: Record<string, unknown> = {}) {
  return {
    id, company_id: CO, voucher_type: type, voucher_number: number,
    voucher_date: "2026-04-05", party_ledger_id: PARTY,
    subtotal_paise: total, total_paise: total,
    is_deleted: false, created_at: STAMP, updated_at: STAMP, ...extra,
  };
}

describe("sales-cycle document linking", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_local_only_mode", "1");
    await reset();
  });

  it("offers pending quotations to a sales order and hides consumed ones", async () => {
    await offlineDb.cache_vouchers.bulkPut([
      voucher("q1", "quotation", "Q/1", 100000),
      voucher("q2", "quotation", "Q/2", 200000),
      voucher("so1", "sales_order", "SO/1", 200000, { original_voucher_id: "q2" }),
    ]);
    const docs = await listSourceDocs(CO, "sales_order", PARTY);
    expect(docs.map((d) => d.voucher_number)).toEqual(["Q/1"]);
  });

  it("lets a sales invoice pull orders and challans, and carries the lines", async () => {
    await offlineDb.cache_vouchers.put(voucher("so1", "sales_order", "SO/1", 118000));
    await offlineDb.cache_voucher_items.put({
      id: "li1", voucher_id: "so1", company_id: CO, item_id: ITEM, line_no: 1,
      description: "Item A", qty: 2, rate_paise: 50000, discount_paise: 0,
      amount_paise: 100000, taxable_paise: 100000, gst_rate: 18, updated_at: STAMP,
    });
    const docs = await listSourceDocs(CO, "sales", PARTY);
    expect(docs.map((d) => d.id)).toContain("so1");
    const lines = await loadDocLines("so1");
    expect(lines).toEqual([
      { item_id: ITEM, description: "Item A", qty: "2", rate: "500.00", discount: "0.00", gst_rate: "18" },
    ]);
  });
});

describe("bill-wise outstanding", () => {
  beforeEach(async () => {
    localStorage.setItem("ym_local_only_mode", "1");
    await reset();
  });

  it("nets a receipt's allocation off the open bill", async () => {
    await offlineDb.cache_vouchers.put(voucher("inv1", "sales", "INV/1", 100000));

    let bills = await listOpenBills(CO, PARTY, "sundry_debtor");
    expect(bills).toHaveLength(1);
    expect(bills[0].pending_paise).toBe(100000);

    await runEntryVoucherCreate({
      companyId: CO,
      voucherType: "receipt",
      voucherDate: "2026-04-10",
      partyLedgerId: PARTY,
      refNo: "",
      narration: "",
      total: 40000,
      entries: [
        { ledger_id: CASH, debit_paise: 40000, credit_paise: 0, narration: null, line_no: 1 },
        { ledger_id: PARTY, debit_paise: 0, credit_paise: 40000, narration: null, line_no: 2 },
      ],
      allocations: [{ invoice_voucher_id: "inv1", ledger_id: PARTY, amount_paise: 40000 }],
    });

    const allocs = await offlineDb.cache_bill_allocations.toArray();
    expect(allocs).toHaveLength(1);
    expect(allocs[0].amount_paise).toBe(40000);

    bills = await listOpenBills(CO, PARTY, "sundry_debtor");
    expect(bills[0].pending_paise).toBe(60000);
  });
});
