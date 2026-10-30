import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TAccount } from "@/components/reports/TAccount";
import { indianAmount } from "@/lib/export-format";

describe("T-format print table", () => {
  it("pairs Dr and Cr rows so each printed row holds one entry per side", () => {
    const html = renderToStaticMarkup(
      <TAccount
        leftRows={[{ label: "A", amount: "1" }, { label: "B", amount: "2" }]}
        rightRows={[{ label: "X", amount: "5" }]}
        leftTotal="3"
        rightTotal="5"
      />,
    );
    // header row + two body rows + totals row
    expect(html.match(/<tr>/g)?.length).toBe(4);
    expect(html).toContain("data-print-only");
    expect(html).toContain("data-print-hide");
  });
});

describe("export amounts", () => {
  it("groups digits the Indian way with two decimals", () => {
    expect(indianAmount(4000000)).toBe("40,00,000.00");
    expect(indianAmount(1150433.13)).toBe("11,50,433.13");
  });
});
