import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { upsertEinvoiceLocal, getEinvoiceDetailLocal, listSalesVouchersLocal } from "@/lib/offline/einvoice-local";
import { logReminder } from "@/lib/reminders";

const CO = "ei-co";

describe("E-invoice and reminders (local)", () => {
  beforeEach(async () => {
    await Promise.all([
      db.cache_einvoice_details.clear(), db.cache_vouchers.clear(),
      db.cache_ledgers.clear(), db.cache_payment_reminders.clear(),
    ]);
  });

  it("a later save keeps the IRN when only the e-way bill is added", async () => {
    await upsertEinvoiceLocal({ voucherId: "V1", companyId: CO, irn: "IRN-123", ackNo: "A1", status: "generated" });
    await upsertEinvoiceLocal({ voucherId: "V1", companyId: CO, ewbNo: "EWB-9", vehicleNo: "GJ01AB1234" });
    const d = await getEinvoiceDetailLocal("V1");
    expect(d?.irn).toBe("IRN-123");
    expect(d?.ack_no).toBe("A1");
    expect(d?.ewb_no).toBe("EWB-9");
    expect(d?.vehicle_no).toBe("GJ01AB1234");
  });

  it("lists sales vouchers newest first with party and e-invoice status", async () => {
    await db.cache_ledgers.put({ id: "P1", company_id: CO, name: "Buyer Co", gstin: "24AAAAA0000A1Z5" });
    await db.cache_vouchers.bulkPut([
      { id: "S1", company_id: CO, voucher_type: "sales", voucher_number: "1", voucher_date: "2026-04-02", party_ledger_id: "P1" },
      { id: "S2", company_id: CO, voucher_type: "sales", voucher_number: "2", voucher_date: "2026-05-02", party_ledger_id: "P1" },
      { id: "R1", company_id: CO, voucher_type: "receipt", voucher_number: "3", voucher_date: "2026-05-03" },
      { id: "S3", company_id: CO, voucher_type: "sales", voucher_number: "4", voucher_date: "2026-06-01", is_deleted: true },
    ]);
    await upsertEinvoiceLocal({ voucherId: "S2", companyId: CO, irn: "IRN-X", status: "generated" });

    const rows = await listSalesVouchersLocal(CO);
    expect(rows.map((r) => r.id)).toEqual(["S2", "S1"]);
    expect(rows[0].ledgers.name).toBe("Buyer Co");
    expect(rows[0].einvoice_details.irn).toBe("IRN-X");
    expect(rows[1].einvoice_details).toBeNull();
  });

  it("logs a payment reminder locally", async () => {
    await logReminder({ companyId: CO, ledgerId: "P1", channel: "whatsapp", message: "Please pay", sentBy: "u1" });
    const rows = await db.cache_payment_reminders.where("company_id").equals(CO).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ledger_id: "P1", channel: "whatsapp", status: "sent" });
  });
});
