import { describe, expect, it } from "vitest";
import { closestHeadingFor } from "@/services/hsnService";

describe("closestHeadingFor", () => {
  it("finds the heading an 8-digit code falls under", () => {
    expect(closestHeadingFor("27101980")?.hsn_code).toBe("2710");
  });
  it("returns null for codes with no heading in the list", () => {
    expect(closestHeadingFor("99999999")).toBeNull();
  });
  it("ignores non-digit input and short codes", () => {
    expect(closestHeadingFor("")).toBeNull();
    expect(closestHeadingFor("27")).toBeNull();
  });
});
