import { describe, expect, it } from "vitest";
import { ageOutstanding, bucketFor } from "@/lib/ai/aging";

describe("bucketFor", () => {
  it("places days into the four buckets", () => {
    expect(bucketFor(0)).toBe("d0_30");
    expect(bucketFor(30)).toBe("d0_30");
    expect(bucketFor(31)).toBe("d31_60");
    expect(bucketFor(61)).toBe("d61_90");
    expect(bucketFor(91)).toBe("d90p");
  });
});

describe("ageOutstanding (receivables)", () => {
  it("ages open bills and settles the oldest first", () => {
    const r = ageOutstanding("receivable", 0, [
      { date: "2026-01-10", debitPaise: 100_000, creditPaise: 0 }, // 100 days before 20 Apr
      { date: "2026-03-20", debitPaise: 50_000, creditPaise: 0 }, // 31 days
      { date: "2026-04-10", debitPaise: 20_000, creditPaise: 0 }, // 10 days
      { date: "2026-04-15", debitPaise: 0, creditPaise: 120_000 }, // settles the January bill, 20,000 left over
    ], "2026-04-20");
    // The 120,000 receipt clears the January bill (100,000) and 20,000 of the March bill,
    // so March keeps 30,000 and April keeps 20,000.
    expect(r.outstandingPaise).toBe(30_000 + 20_000);
    expect(r.advancePaise).toBe(0);
    expect(r.buckets).toEqual({ opening: 0, d0_30: 20_000, d31_60: 30_000, d61_90: 0, d90p: 0 });
  });

  it("an advance is shown separately, not as a bill", () => {
    const r = ageOutstanding("receivable", 0, [
      { date: "2026-04-01", debitPaise: 10_000, creditPaise: 0 },
      { date: "2026-04-02", debitPaise: 0, creditPaise: 15_000 },
    ], "2026-04-30");
    expect(r.outstandingPaise).toBe(0);
    expect(r.advancePaise).toBe(5_000);
  });

  it("an opening debit is the opening bucket", () => {
    const r = ageOutstanding("receivable", 30_000, [], "2026-04-30");
    expect(r.buckets.opening).toBe(30_000);
    expect(r.outstandingPaise).toBe(30_000);
  });
});

describe("ageOutstanding (payables)", () => {
  it("mirrors receivables: credits are bills, debits settle them", () => {
    const r = ageOutstanding("payable", 0, [
      { date: "2026-02-01", debitPaise: 0, creditPaise: 40_000 }, // bill, 88 days before 30 Apr
      { date: "2026-04-10", debitPaise: 25_000, creditPaise: 0 }, // payment settles 25,000 of it
      { date: "2026-04-25", debitPaise: 0, creditPaise: 10_000 }, // new bill, 5 days
    ], "2026-04-30");
    expect(r.outstandingPaise).toBe(15_000 + 10_000);
    expect(r.buckets).toEqual({ opening: 0, d0_30: 10_000, d31_60: 0, d61_90: 15_000, d90p: 0 });
  });

  it("outstanding matches the closing balance from the books", () => {
    const entries = [
      { date: "2026-03-01", debitPaise: 0, creditPaise: 70_000 },
      { date: "2026-03-15", debitPaise: 30_000, creditPaise: 0 },
      { date: "2026-04-01", debitPaise: 0, creditPaise: 5_000 },
    ];
    const r = ageOutstanding("payable", 0, entries, "2026-04-30");
    const closingCr = entries.reduce((s, e) => s + e.creditPaise - e.debitPaise, 0);
    expect(r.outstandingPaise).toBe(closingCr);
  });
});
