import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { convertGstr1Xlsx } from "./gstr1-xlsx-to-json";
import { nilSupplyType, portalHsnBlock } from "./gstr1-portal-format";

function wb() {
  const b = XLSX.utils.book_new();
  const sheet = (name: string, rows: unknown[][]) =>
    XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet([["s"], ["h"], ["t"], ["hdr"], ...rows]), name);
  sheet("hsn(b2c)", [["071390", null, "KGS-KILOGRAMS", 10, 100, 0, 100, 0, 0, 0, null]]);
  sheet("exemp", [["Intra-State supplies to unregistered persons", null, 500, null], ["Intra-State supplies to registered persons", null, null, null]]);
  sheet("docs", [["Invoices for outward supply", "1", "9", 9, 0], ["Credit Note", "1", "2", 2, 0]]);
  return XLSX.write(b, { type: "array", bookType: "xlsx" });
}

describe("GSTR-1 portal JSON shape", () => {
  const json: any = convertGstr1Xlsx(wb(), { gstin: "24EAIPS7135C1ZP", fp: "092026" }).json;
  it("uses the offline-tool envelope", () => {
    expect(json.version).toBe("GST3.2.4");
    expect(json.hash).toBe("hash");
  });
  it("emits only non-empty HSN sections, no legacy data array", () => {
    expect(Object.keys(json.hsn)).toEqual(["hsn_b2c"]);
    const r = json.hsn.hsn_b2c[0];
    expect(r.uqc).toBe("KGS");
    expect(r.desc.length).toBeGreaterThan(0);
  });
  it("reads offline-tool exempt wording", () => {
    expect(json.nil.inv[0]).toMatchObject({ sply_ty: "INTRAB2C", expt_amt: 500 });
    expect(nilSupplyType("Inter-State supplies to registered persons")).toBe("INTRB2B");
  });
  it("labels documents with Credit Note = 5", () => {
    expect(json.doc_issue.doc_det.map((d: any) => [d.doc_num, d.doc_typ])).toEqual([[1, "Invoices for outward supply"], [5, "Credit Note"]]);
  });
  it("returns undefined when both HSN sections are empty", () => {
    expect(portalHsnBlock([], [])).toBeUndefined();
  });
});

describe("service HSN rows", () => {
  it("force UQC NA and zero quantity for SAC 99xx", () => {
    const [r] = portalHsnBlock([], [{ hsn_sc: "996813", uqc: "OTH", qty: 3, rt: 5, txval: 10 }])!.hsn_b2c;
    expect([r.uqc, r.qty]).toEqual(["NA", 0]);
  });
});
