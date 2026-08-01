// Phase E3 — OCR hardening.
//
// Vision models read numbers well but not perfectly. Before an extracted
// invoice can become a voucher we run deterministic checks that a human
// accountant would run: does taxable + tax = total, is the GSTIN structurally
// valid, is the date sane, is the GST split consistent with inter/intra state.
//
// The result downgrades confidence and shows plain-language warnings instead of
// silently booking a wrong bill.
import type { OcrExtracted } from "./ocr-invoice";
import { isValidGstin } from "@/utils/gstinValidator";

export type OcrIssueLevel = "error" | "warning";

export interface OcrIssue {
  level: OcrIssueLevel;
  field: string;
  message: string;
}

export interface OcrValidation {
  issues: OcrIssue[];
  /** Confidence after penalties, 0..1. */
  adjustedConfidence: number;
  /** True when at least one hard error exists — block one-click posting. */
  blocking: boolean;
}

const R2 = (n: number) => Math.round(n * 100) / 100;

export function validateOcrExtract(e: OcrExtracted): OcrValidation {
  const issues: OcrIssue[] = [];
  const taxable = Number(e.taxable_value || 0);
  const cgst = Number(e.cgst || 0);
  const sgst = Number(e.sgst || 0);
  const igst = Number(e.igst || 0);
  const cess = Number(e.cess || 0);
  const roundOff = Number(e.round_off || 0);
  const total = Number(e.total_amount || 0);

  if (total <= 0) {
    issues.push({ level: "error", field: "total_amount", message: "Invoice total could not be read." });
  }
  if (taxable <= 0 && total > 0) {
    issues.push({ level: "warning", field: "taxable_value", message: "Taxable value is zero — check if this is an exempt / nil-rated bill." });
  }

  // Arithmetic: taxable + taxes + round-off should equal the total (±₹2).
  const computed = R2(taxable + cgst + sgst + igst + cess + roundOff);
  if (total > 0 && Math.abs(computed - R2(total)) > 2) {
    issues.push({
      level: "error",
      field: "total_amount",
      message: `Totals do not add up: ${computed.toLocaleString("en-IN")} from parts vs ${R2(total).toLocaleString("en-IN")} printed.`,
    });
  }

  // GST split sanity.
  if (igst > 0 && (cgst > 0 || sgst > 0)) {
    issues.push({ level: "error", field: "gst", message: "Both IGST and CGST/SGST present — only one split is valid." });
  }
  if (cgst > 0 && sgst > 0 && Math.abs(cgst - sgst) > 1) {
    issues.push({ level: "error", field: "gst", message: "CGST and SGST differ — they must be equal." });
  }
  if (e.is_interstate === true && igst === 0 && (cgst > 0 || sgst > 0)) {
    issues.push({ level: "warning", field: "gst", message: "Marked inter-state but tax is CGST/SGST." });
  }
  if (e.is_interstate === false && igst > 0) {
    issues.push({ level: "warning", field: "gst", message: "Marked intra-state but tax is IGST." });
  }

  // Effective rate should land near a legal GST slab.
  const taxTotal = cgst + sgst + igst;
  if (taxable > 0 && taxTotal > 0) {
    const rate = (taxTotal / taxable) * 100;
    const slabs = [0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];
    if (!slabs.some((s) => Math.abs(rate - s) <= 0.6)) {
      issues.push({
        level: "warning",
        field: "gst",
        message: `Effective GST rate reads ${rate.toFixed(2)}% — not a standard slab; verify the tax amounts.`,
      });
    }
  }

  // GSTIN structure.
  if (e.party_gstin) {
    const g = String(e.party_gstin).replace(/\s+/g, "").toUpperCase();
    if (!isValidGstin(g)) {
      issues.push({ level: "warning", field: "party_gstin", message: `GSTIN "${g}" fails the checksum — re-read or clear it.` });
    }
  }

  // Date sanity: parseable, not in the future, not absurdly old.
  if (e.invoice_date) {
    const t = Date.parse(e.invoice_date);
    if (Number.isNaN(t)) {
      issues.push({ level: "warning", field: "invoice_date", message: "Invoice date could not be understood." });
    } else {
      const now = Date.now();
      if (t > now + 86_400_000) {
        issues.push({ level: "warning", field: "invoice_date", message: "Invoice date is in the future." });
      } else if (now - t > 5 * 365 * 86_400_000) {
        issues.push({ level: "warning", field: "invoice_date", message: "Invoice date is more than 5 years old." });
      }
    }
  } else {
    issues.push({ level: "warning", field: "invoice_date", message: "No invoice date found." });
  }

  if (!e.party_name || !String(e.party_name).trim()) {
    issues.push({ level: "error", field: "party_name", message: "Party name could not be read." });
  }
  if (!e.invoice_number) {
    issues.push({ level: "warning", field: "invoice_number", message: "No invoice number found." });
  }

  // Line items should roughly sum to the taxable value when present.
  if (e.items?.length) {
    const sum = R2(e.items.reduce((a, i) => a + Number(i.amount || 0), 0));
    if (taxable > 0 && Math.abs(sum - R2(taxable)) > Math.max(2, taxable * 0.01)) {
      issues.push({
        level: "warning",
        field: "items",
        message: `Line items total ${sum.toLocaleString("en-IN")} but taxable value reads ${R2(taxable).toLocaleString("en-IN")}.`,
      });
    }
  }

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const base = typeof e.confidence === "number" ? e.confidence : 0.7;
  const adjustedConfidence = Math.max(0, Math.min(1, base - errors * 0.25 - warnings * 0.07));

  return { issues, adjustedConfidence, blocking: errors > 0 };
}
