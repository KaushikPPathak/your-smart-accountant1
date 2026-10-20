import { applyGstOverride, sumLines, type GstLineResult, type GstOverride } from "@/lib/gst";

/** Keep the saved adjustment separate from item prices and tax when editing. */
export function editedInvoiceTotals(lines: GstLineResult[], override: GstOverride, interstate: boolean, roundOffPaise: number) {
  const base = applyGstOverride(sumLines(lines), override, interstate);
  return { ...base, round_off_paise: roundOffPaise, total_paise: base.total_paise + roundOffPaise };
}

export function validateInvoiceNumber(number: string, date: string, type: string,
  rows: Array<{ id: string; voucher_number?: unknown; voucher_date?: unknown; voucher_type?: unknown; is_deleted?: boolean }>, excludeId?: string) {
  const value = number.trim();
  if (!value) throw new Error("Enter an invoice number.");
  const fyStart = (d: string) => Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 4 ? 1 : 0);
  if (rows.some((row) => row.id !== excludeId && !row.is_deleted && row.voucher_type === type
    && fyStart(String(row.voucher_date ?? "")) === fyStart(date)
    && String(row.voucher_number ?? "").trim().toLowerCase() === value.toLowerCase())) {
    throw new Error("This invoice number already exists in this financial year.");
  }
  return value;
}