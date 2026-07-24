// GSTR-1 per-line classification tracer.
//
// Mirrors the classification decisions made by `buildGstr1()` in
// `src/lib/gst-returns.ts` at the SINGLE-VOUCHER level so we can show, for any
// invoice, exactly which GSTR-1 bucket (B2B / B2CL / B2CS / CDNR / CDNUR / EXP
// / NIL / HSN-B2B / HSN-B2C) each line contributes to and why.
//
// The full builder loop stays authoritative for the report; this module is a
// side-channel used by the audit panel, drill-down and live preview so the
// user can inspect provenance. All amounts here are in paise.
//
// If you touch the classification rules in `gst-returns.ts` you MUST update
// the corresponding branches here — the invariant test in gstr1-trace.test.ts
// verifies the two engines agree on section totals for the fixture suite.

import type { VoucherRow, CompanyMeta } from "@/lib/gst-returns";

export type Gstr1Section =
  | "B2B" | "B2BA" | "B2CL" | "B2CLA" | "B2CS" | "CDNR" | "CDNRA" | "CDNUR" | "EXP" | "NIL" | null;

export type HsnBucket = "HSN_B2B" | "HSN_B2C" | null;

export interface TracedLine {
  voucherId: string;
  voucherNumber: string;
  voucherDate: string;              // ISO
  voucherType: string;
  partyName: string;
  partyGstin: string;
  isInterstate: boolean;
  pos: string;
  itemName: string;
  hsn: string;
  uqc: string;
  qty: number;
  rate: number;                     // GST rate %
  taxable_paise: number;            // signed (credit note = negative)
  iamt_paise: number;
  camt_paise: number;
  samt_paise: number;
  csamt_paise: number;
  section: Gstr1Section;
  subKey: string;                   // e.g. "INTRB2B" / "INTER|27|18" / invoice number
  hsnBucket: HsnBucket;
  reason: string;                   // human-readable classification
  flags: string[];                  // "missing_hsn", "missing_uqc", "nil_no_hsn", "b2cl_below_threshold_dropped"
}

const B2CL_THRESHOLD_PAISE = 2_50_000 * 100;

const isExportTreatment = (t: string | null | undefined): boolean =>
  t === "overseas" || t === "sez_with_payment" || t === "sez_without_payment";

const nilKey = (interstate: boolean, hasGstin: boolean): "INTRB2B" | "INTRB2C" | "INTRAB2B" | "INTRAB2C" =>
  interstate ? (hasGstin ? "INTRB2B" : "INTRB2C") : (hasGstin ? "INTRAB2B" : "INTRAB2C");

const isNilLine = (it: VoucherRow["voucher_items"][number]): boolean =>
  Number(it.gst_rate || 0) === 0
  && Number(it.igst_paise || 0) === 0
  && Number(it.cgst_paise || 0) === 0
  && Number(it.sgst_paise || 0) === 0;

/** Classify one sales or CN/DN voucher into per-line GSTR-1 postings. */
export function classifyVoucher(v: VoucherRow, company: CompanyMeta): TracedLine[] {
  const isCN = v.voucher_type === "credit_note";
  const isDN = v.voucher_type === "debit_note";
  const isNote = isCN || isDN;
  const sign: 1 | -1 = isCN ? -1 : 1;

  const partyGstin = v.ledgers?.gstin || "";
  const compState = company.state_code ?? "";
  const pos = ((v.place_of_supply_code || v.ledgers?.state_code || compState) || "").padStart(2, "0");
  const interstate = v.is_interstate;
  const treatment = v.ledgers?.gst_treatment;
  const partyName = v.ledgers?.name || "";

  // Effective supply nature — mirrors the auto-classify safety net in buildGstr1.
  let sn = (v.supply_nature ?? "taxable") as string;
  if ((!sn || sn === "taxable") && v.voucher_items.length > 0) {
    const allZero = v.voucher_items.every(isNilLine);
    const voucherZeroTax = (v.cgst_paise || 0) === 0 && (v.sgst_paise || 0) === 0 && (v.igst_paise || 0) === 0;
    if (allZero && voucherZeroTax) sn = "nil_rated";
  }

  const isB2Bhsn = !!(partyGstin && partyGstin.trim());
  const hsnBucket: HsnBucket = isB2Bhsn ? "HSN_B2B" : "HSN_B2C";

  const lines: TracedLine[] = [];

  const mkBase = (it: VoucherRow["voucher_items"][number]) => {
    const hsn = (it.items?.hsn_code || "").trim();
    const rawUnit = (it.items?.unit || "OTH").toUpperCase();
    const isService = hsn.startsWith("99");
    const uqc = isService ? "NA" : (rawUnit.slice(0, 3) + "-" + rawUnit);
    const flags: string[] = [];
    if (!hsn) flags.push("missing_hsn");
    if (!isService && !it.items?.unit) flags.push("missing_uqc");
    return {
      voucherId: v.id,
      voucherNumber: v.voucher_number,
      voucherDate: v.voucher_date,
      voucherType: v.voucher_type,
      partyName, partyGstin, isInterstate: interstate, pos,
      itemName: it.items?.name || "",
      hsn, uqc, qty: Number(it.qty || 0), rate: Number(it.gst_rate || 0),
      taxable_paise: sign * (it.taxable_paise || 0),
      iamt_paise: sign * (it.igst_paise || 0),
      camt_paise: sign * (it.cgst_paise || 0),
      samt_paise: sign * (it.sgst_paise || 0),
      csamt_paise: 0,
      hsnBucket,
      flags,
    };
  };

  // Whole-voucher NIL: nature-tagged voucher — every line lands in NIL sheet
  // with the appropriate column. Value uses subtotal_paise (matches accNil).
  if (sn === "nil_rated" || sn === "exempt" || sn === "non_gst") {
    const col = sn === "nil_rated" ? "Nil-rated" : sn === "exempt" ? "Exempted" : "Non-GST";
    const sub = nilKey(interstate, !!partyGstin);
    const reason = `Voucher marked ${sn.replace("_", "-")} · ${sub} · lands in NIL sheet "${col}" column`;
    if (v.voucher_items.length === 0) {
      // Header-only voucher — still emit a synthetic line so the audit shows the value.
      lines.push({
        voucherId: v.id, voucherNumber: v.voucher_number, voucherDate: v.voucher_date,
        voucherType: v.voucher_type,
        partyName, partyGstin, isInterstate: interstate, pos,
        itemName: "(no line items)", hsn: "", uqc: "OTH-OTH", qty: 0, rate: 0,
        taxable_paise: sign * (v.subtotal_paise || v.total_paise),
        iamt_paise: 0, camt_paise: 0, samt_paise: 0, csamt_paise: 0,
        section: "NIL", subKey: `${sub}|${col}`, hsnBucket,
        reason, flags: ["header_only"],
      });
      return lines;
    }
    for (const it of v.voucher_items) {
      const base = mkBase(it);
      // taxable value for whole-voucher NIL follows the value fields on the line
      lines.push({ ...base, section: "NIL", subKey: `${sub}|${col}`, reason,
        flags: base.hsn ? base.flags : [...base.flags, "nil_no_hsn"] });
    }
    return lines;
  }

  // Zero-rated / SEZ / overseas
  const isExport = sn === "zero_rated_wp" || sn === "zero_rated_wop" || isExportTreatment(treatment);
  const partitionNilLines = !isExport;

  // Mixed-rate: split nil lines out of taxable posting.
  for (const it of v.voucher_items) {
    const base = mkBase(it);

    if (partitionNilLines && isNilLine(it) && (it.taxable_paise || 0) > 0) {
      const sub = nilKey(interstate, !!partyGstin);
      lines.push({
        ...base, section: "NIL", subKey: `${sub}|Nil-rated`,
        reason: `0% rate + zero tax on a taxable voucher → stripped to NIL sheet · ${sub}`,
        flags: base.hsn ? base.flags : [...base.flags, "nil_no_hsn"],
      });
      continue;
    }
    if (partitionNilLines && isNilLine(it) && (it.taxable_paise || 0) === 0) {
      // Zero-value nil line — skipped entirely in the builder.
      lines.push({
        ...base, section: null, subKey: "",
        reason: "0% rate + zero taxable + zero tax → dropped (contributes nothing)",
        flags: [...base.flags, "empty_line"],
      });
      continue;
    }

    // From here the line is taxable / export / SEZ.
    if (isExport) {
      if (treatment === "sez_with_payment" || treatment === "sez_without_payment") {
        lines.push({
          ...base, section: "B2B",
          subKey: `${partyGstin}|${v.voucher_number}`,
          reason: `SEZ (${treatment === "sez_with_payment" ? "with payment" : "without payment"}) → B2B sheet with SEWP/SEWOP invoice type`,
        });
      } else {
        lines.push({
          ...base, section: "EXP",
          subKey: `${sn === "zero_rated_wop" ? "WOPAY" : "WPAY"}|${v.voucher_number}`,
          reason: `Zero-rated export (${sn === "zero_rated_wop" ? "without payment" : "with payment"}) → EXP sheet`,
        });
      }
      continue;
    }

    // Registered dealer → B2B (or CDNR for notes)
    if (partyGstin) {
      if (isNote) {
        lines.push({
          ...base,
          section: v.is_amendment ? "CDNRA" : "CDNR",
          subKey: `${partyGstin}|${v.voucher_number}`,
          reason: `Registered party (GSTIN ${partyGstin}) · ${isCN ? "credit" : "debit"} note → CDNR${v.is_amendment ? "A" : ""} sheet · ${interstate ? "IGST" : "CGST+SGST"}`,
        });
      } else {
        lines.push({
          ...base,
          section: v.is_amendment ? "B2BA" : "B2B",
          subKey: `${partyGstin}|${v.voucher_number}`,
          reason: `Registered party (GSTIN ${partyGstin}) · ${interstate ? "inter-state → IGST" : "intra-state → CGST+SGST"} → B2B${v.is_amendment ? "A" : ""} sheet`,
        });
      }
      continue;
    }

    // Unregistered
    if (isNote) {
      const isExpNote = isExportTreatment(treatment) || sn === "zero_rated_wp" || sn === "zero_rated_wop";
      const typ = isExpNote ? (sn === "zero_rated_wop" ? "EXPWOP" : "EXPWP") : "B2CL";
      if (typ !== "B2CL" || (interstate && v.total_paise > B2CL_THRESHOLD_PAISE)) {
        lines.push({
          ...base, section: "CDNUR", subKey: `${typ}|${v.voucher_number}`,
          reason: `Unregistered ${isCN ? "credit" : "debit"} note → CDNUR (${typ})`,
        });
      } else {
        lines.push({
          ...base, section: "B2CS",
          subKey: `${interstate ? "INTER" : "INTRA"}|${pos}|${it.gst_rate}`,
          reason: `Unregistered small ${isCN ? "credit" : "debit"} note → nets into B2CS bucket ${interstate ? "INTER" : "INTRA"}·${pos}·${it.gst_rate}%`,
        });
      }
      continue;
    }
    if (interstate && v.total_paise > B2CL_THRESHOLD_PAISE) {
      lines.push({
        ...base,
        section: v.is_amendment ? "B2CLA" : "B2CL",
        subKey: v.voucher_number,
        reason: `Unregistered inter-state · invoice > ₹2.5L threshold → B2CL${v.is_amendment ? "A" : ""} sheet`,
      });
    } else {
      lines.push({
        ...base, section: "B2CS",
        subKey: `${interstate ? "INTER" : "INTRA"}|${pos}|${it.gst_rate}`,
        reason: `Unregistered ${interstate ? "inter-state (≤ ₹2.5L)" : "intra-state"} → B2CS bucket ${interstate ? "INTER" : "INTRA"}·${pos}·${it.gst_rate}%`,
      });
    }
  }

  return lines;
}

export interface Gstr1Trace {
  lines: TracedLine[];
  byVoucher: Map<string, TracedLine[]>;
}

export function classifyAll(
  sales: VoucherRow[],
  creditNotes: VoucherRow[],
  company: CompanyMeta,
): Gstr1Trace {
  const lines: TracedLine[] = [];
  const byVoucher = new Map<string, TracedLine[]>();
  const push = (v: VoucherRow) => {
    const rows = classifyVoucher(v, company);
    byVoucher.set(v.id, rows);
    for (const r of rows) lines.push(r);
  };
  for (const v of sales) push(v);
  for (const v of creditNotes) push(v);
  return { lines, byVoucher };
}

// ─── Aggregation helpers used by drill-down / live preview ────────────────

export interface SectionAgg {
  section: NonNullable<Gstr1Section>;
  taxable: number; iamt: number; camt: number; samt: number; total: number; lineCount: number;
}

export function sumBySection(lines: TracedLine[]): SectionAgg[] {
  const m = new Map<string, SectionAgg>();
  for (const l of lines) {
    if (!l.section) continue;
    const cur = m.get(l.section) ?? {
      section: l.section, taxable: 0, iamt: 0, camt: 0, samt: 0, total: 0, lineCount: 0,
    };
    cur.taxable += l.taxable_paise;
    cur.iamt += l.iamt_paise;
    cur.camt += l.camt_paise;
    cur.samt += l.samt_paise;
    cur.total += l.taxable_paise + l.iamt_paise + l.camt_paise + l.samt_paise;
    cur.lineCount += 1;
    m.set(l.section, cur);
  }
  return Array.from(m.values());
}

export interface HsnAgg {
  bucket: "HSN_B2B" | "HSN_B2C";
  taxable: number; iamt: number; camt: number; samt: number; total: number; lineCount: number;
}

export function sumByHsnBucket(lines: TracedLine[]): HsnAgg[] {
  const m = new Map<HsnAgg["bucket"], HsnAgg>();
  for (const l of lines) {
    if (!l.hsnBucket) continue;
    const cur = m.get(l.hsnBucket) ?? {
      bucket: l.hsnBucket, taxable: 0, iamt: 0, camt: 0, samt: 0, total: 0, lineCount: 0,
    };
    cur.taxable += l.taxable_paise;
    cur.iamt += l.iamt_paise;
    cur.camt += l.camt_paise;
    cur.samt += l.samt_paise;
    cur.total += l.taxable_paise + l.iamt_paise + l.camt_paise + l.samt_paise;
    cur.lineCount += 1;
    m.set(l.hsnBucket, cur);
  }
  return Array.from(m.values());
}
