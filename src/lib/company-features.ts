/**
 * Per-company feature switches, read ONLY from the active company's own
 * settings. Every menu, report tab and report section must use this so a
 * choice made for one company (GST, inventory, 44AD/44ADA) never leaks into
 * another company's books.
 */
export type PresumptiveScheme = "none" | "44ad" | "44ada";

export interface CompanyFeatureFlags {
  gst: boolean;
  inventory: boolean;
  presumptive: boolean;
  presumptiveScheme: PresumptiveScheme;
  /** Income from other sources only: business menus and transactions are hidden. */
  incomeOnly: boolean;
}

type CompanyLike = {
  gst_registered?: boolean | null;
  gstin?: string | null;
  inventory_enabled?: boolean | null;
  presumptive_scheme?: string | null;
  income_only?: boolean | null;
} | null | undefined;

export function companyFeatures(company: CompanyLike): CompanyFeatureFlags {
  const scheme = String(company?.presumptive_scheme ?? "none").toLowerCase();
  const incomeOnly = company?.income_only === true;
  const presumptiveScheme: PresumptiveScheme = !incomeOnly && (scheme === "44ad" || scheme === "44ada") ? scheme : "none";
  return {
    // Older saved companies may carry a GSTIN without the explicit flag.
    gst: !incomeOnly && (Boolean(company?.gst_registered) || Boolean(String(company?.gstin ?? "").trim())),
    inventory: !incomeOnly && (company?.inventory_enabled == null ? true : Boolean(company.inventory_enabled)),
    presumptive: presumptiveScheme !== "none",
    presumptiveScheme,
    incomeOnly,
  };
}

/** Pages that only make sense for a GST-registered company. */
export const GST_ONLY_URLS = new Set([
  "/app/reports/gstr1",
  "/app/reports/gstr3b",
  "/app/reports/gstr2b",
  "/app/reports/gstr9",
  "/app/tools/gstr1-json",
  "/app/einvoice",
  "/app/reports/gst-sales-book",
  "/app/reports/gst-purchase-book",
  "/app/reports/itc-item-wise",
  "/app/reports/itc-party-wise",
  "/app/reports/tax-audit",
]);

/** Pages that only make sense when the company maintains inventory. */
export const INVENTORY_ONLY_URLS = new Set([
  "/app/items",
  "/app/reports/stock-summary",
  "/app/reports/hsn-summary",
  "/app/vouchers/new/manufacturing",
]);

/** Pages that only make sense when the company opted for 44AD / 44ADA. */
export const PRESUMPTIVE_ONLY_URLS = new Set(["/app/reports/presumptive"]);

/** Business sales, purchase and stock pages, hidden for companies with income from other sources only. */
export const INCOME_ONLY_HIDDEN_URLS = new Set([
  "/app/vouchers/new/sales",
  "/app/vouchers/new/purchase",
  "/app/vouchers/new/credit_note",
  "/app/vouchers/new/debit_note",
  "/app/vouchers/new/manufacturing",
  "/app/vouchers/new/sales_order",
  "/app/vouchers/new/delivery_note",
  "/app/vouchers/new/quotation",
  "/app/vouchers/new/physical_stock",
  "/app/reports/sales-register",
  "/app/reports/purchase-register",
  "/app/reports/cost-centre",
]);

export function isUrlEnabled(url: string, flags: CompanyFeatureFlags): boolean {
  if (flags.incomeOnly && INCOME_ONLY_HIDDEN_URLS.has(url)) return false;
  if (GST_ONLY_URLS.has(url) && !flags.gst) return false;
  if (INVENTORY_ONLY_URLS.has(url) && !flags.inventory) return false;
  if (PRESUMPTIVE_ONLY_URLS.has(url) && !flags.presumptive) return false;
  return true;
}
