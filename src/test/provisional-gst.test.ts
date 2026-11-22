import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lock: null as unknown,
  vouchers: [] as any[],
  imports: [] as any[],
}));

vi.mock("@/lib/period-locks", () => ({ fetchLockFor: async () => state.lock }));
vi.mock("@/lib/gst-returns", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    fetchVouchers: async (_c: string, _f: string, _t: string, types: string[]) =>
      types.includes("sales") ? state.vouchers : [],
    fetchCompanyMeta: async () => ({ gstin: "09AAAAA0000A1Z5", name: "Test", state_code: "09" }),
    fetchInwardSummary: async () => [],
    fetchItcReversal: async () => [],
  };
});
vi.mock("@/lib/gst-itc-inputs", () => ({ loadItcClassInputs: async () => ({ purchaseBuckets: new Map(), journalItc: [] }) }));
vi.mock("@/lib/gstr2b-local-store", () => ({ loadAllImportLines: async () => state.imports }));

import { provisionalNetGst } from "@/lib/gst/provisional-gst";

beforeEach(() => {
  state.lock = null;
  state.vouchers = [];
  state.imports = [];
});

describe("provisionalNetGst (6.1)", () => {
  it("refuses a locked period", async () => {
    state.lock = { period: "052026" };
    const r = await provisionalNetGst({ companyId: "c1", month: "2026-05" });
    expect(r.status).toBe("refused");
    expect(r.reason).toMatch(/locked/);
    expect(r.screenPath).toBe("/app/reports/gstr3b");
  });

  it("refuses when vouchers have no supply type", async () => {
    state.vouchers = [{ id: "v1", supply_nature: null, subtotal_paise: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, total_paise: 0, voucher_items: [] }];
    const r = await provisionalNetGst({ companyId: "c1", month: "2026-05" });
    expect(r.status).toBe("refused");
    expect(r.reason).toMatch(/no supply type/);
  });

  it("refuses when books and GSTR-2B differ beyond tolerance", async () => {
    state.imports = [{ gstr2b_period: "052026", import_period: "052026", itc_eligible: true, igst_paise: 100000, cgst_paise: 0, sgst_paise: 0 }];
    const r = await provisionalNetGst({ companyId: "c1", month: "2026-05" });
    expect(r.status).toBe("refused");
    expect(r.reason).toMatch(/beyond the company's tolerance/);
  });

  it("answers provisionally, stating the reconciliation status, when no GSTR-2B is imported", async () => {
    const r = await provisionalNetGst({ companyId: "c1", month: "2026-05" });
    expect(r.status).toBe("provisional");
    expect(r.reconciliation.state).toBe("not_imported");
    expect(r.netPayableRupees?.total).toBe(0);
    expect(r.period.label).toBeTruthy();
  });

  it("rejects a malformed month without touching the books", async () => {
    const r = await provisionalNetGst({ companyId: "c1", month: "May 2026" });
    expect(r.status).toBe("refused");
  });
});
