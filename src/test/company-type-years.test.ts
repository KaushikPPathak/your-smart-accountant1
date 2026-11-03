import { beforeEach, describe, expect, it } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { readIncomeOnly, writeIncomeOnly, businessYearIds } from "@/lib/company-type";

const FY25 = "cty-fy25";
const FY26 = "cty-fy26";
const OTHER = "cty-other-business";

describe("income-only flag follows the business across financial years", () => {
  beforeEach(async () => {
    await db.cache_companies.clear();
    await db.cache_company_settings.clear();
    await db.cache_companies.bulkPut([
      { id: FY25, name: "Payal", financial_year_start: "2025-04-01" },
      { id: FY26, name: "Payal", financial_year_start: "2026-04-01", carried_from_company_id: FY25 },
      { id: OTHER, name: "Other business", financial_year_start: "2025-04-01" },
    ] as never);
  });

  it("the 2026-27 year inherits the flag set in 2025-26 when it has no setting of its own", async () => {
    await writeIncomeOnly(FY25, true);
    expect(await readIncomeOnly(FY26)).toBe(true);
  });

  it("a change made in one year is saved for every year of the same business", async () => {
    await writeIncomeOnly(FY26, true);
    expect(await readIncomeOnly(FY25)).toBe(true);
    await writeIncomeOnly(FY25, false);
    expect(await readIncomeOnly(FY26)).toBe(false);
  });

  it("another business is not affected", async () => {
    await writeIncomeOnly(FY25, true);
    expect(await readIncomeOnly(OTHER)).toBe(false);
    expect((await businessYearIds(OTHER)).sort()).toEqual([OTHER]);
  });

  it("a company with no setting and no earlier year is a normal company", async () => {
    expect(await readIncomeOnly(FY26)).toBe(false);
  });
});
