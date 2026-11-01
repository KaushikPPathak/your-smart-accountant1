import { describe, expect, it } from "vitest";
import { getExportDetailsLocal, upsertExportDetailsLocal } from "@/lib/offline/export-details-local";

describe("export invoice details (local)", () => {
  it("saves and reads back the details for a voucher, replacing on save", async () => {
    expect(await getExportDetailsLocal("EX-1")).toBeNull();
    await upsertExportDetailsLocal("EX-1", { company_id: "c", currency_code: "USD", fx_rate: 83.5, lut_date: "2026-04-01" });
    await upsertExportDetailsLocal("EX-1", { company_id: "c", currency_code: "EUR", fx_rate: 90 });

    const row = await getExportDetailsLocal("EX-1");
    expect(row).toMatchObject({ voucher_id: "EX-1", currency_code: "EUR", fx_rate: 90 });
    expect(row?.lut_date).toBeUndefined();
  });
});
