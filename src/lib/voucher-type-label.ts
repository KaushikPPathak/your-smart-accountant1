// Single source of truth for translating the raw voucher_type DB values
// into a printable label in the active app language.
import { getStoredLang, type LangCode } from "@/lib/i18n";
import { tReportText } from "@/lib/report-i18n-rules";

const ENGLISH: Record<string, string> = {
  sales: "Sales",
  purchase: "Purchase",
  receipt: "Receipt",
  payment: "Payment",
  journal: "Journal",
  contra: "Contra",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
  delivery_note: "Delivery Note",
  sales_order: "Sales Order",
  purchase_order: "Purchase Order",
  quotation: "Quotation",
};

export function voucherTypeLabel(type: string, lang: LangCode = getStoredLang()): string {
  const en = ENGLISH[type] ?? type;
  return tReportText(en, lang);
}
