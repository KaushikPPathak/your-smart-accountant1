import { supabase } from "@/integrations/supabase/client";

/**
 * Year-end closure state shared by the Year-End screen and the company cards.
 * A year counts as closed when closing journals we posted (by narration) exist.
 */
// Narration prefixes we generate when posting year-end closure journals.
// Kept in sync with the `narration` strings in buildPreview / postClosure.
const CLOSURE_NARRATION_MARKERS = [
  "Closing stock as on",
  "Direct incomes & expenses for FY",
  "Indirect incomes/expenses & Gross Profit transferred",
  "Net Profit for FY",
  "Net Loss for FY",
];

export function narrationLooksLikeClosure(narration: string | null | undefined): boolean {
  const n = String(narration ?? "").trim();
  if (!n) return false;
  return CLOSURE_NARRATION_MARKERS.some((m) => n.startsWith(m));
}

export async function findExistingClosureVoucherIds(
  companyId: string,
  fyStart: string,
  fyEnd: string,
): Promise<string[]> {
  const { isLocalOnlyMode } = await import("@/lib/local-only-mode");
  if (isLocalOnlyMode()) {
    const { offlineDb } = await import("@/lib/offline/db");
    const rows = await offlineDb.cache_vouchers.where("company_id").equals(companyId).toArray();
    return (rows as any[])
      .filter(
        (v) =>
          v?.is_deleted !== true &&
          v?.voucher_type === "journal" &&
          String(v?.voucher_date ?? "") >= fyStart &&
          String(v?.voucher_date ?? "") <= fyEnd &&
          narrationLooksLikeClosure(v?.narration),
      )
      .map((v) => String(v.id));
  }
  const { data } = await supabase
    .from("vouchers")
    .select("id, narration")
    .eq("company_id", companyId)
    .eq("voucher_type", "journal")
    .gte("voucher_date", fyStart)
    .lte("voucher_date", fyEnd);
  return (data ?? [])
    .filter((v: any) => narrationLooksLikeClosure(v.narration))
    .map((v: any) => String(v.id));
}


/**
 * Picks the owner's Capital ledger. Only names that say capital qualify, so a
 * Drawings or Withdrawal ledger (also type capital) is never used for the profit transfer.
 * Returns null when there is none; the caller then uses "Capital A/c".
 */
export function pickCapitalLedger<T extends { id: string; name: string }>(candidates: T[]): T | null {
  const isCapital = (n: string) => /\bcapital\b|\bproprietor\b|\bowner'?s?\s+equity\b|\bpartner'?s?\s+capital\b/i.test(n);
  const isReserve = (n: string) => /reserve|surplus|retained\s+earning/i.test(n);
  const isDrawings = (n: string) => /drawing|withdraw|personal/i.test(n);
  const usable = candidates.filter(
    (l) => !isReserve(l.name) && !isDrawings(l.name) && l.name.trim().toLowerCase() !== "profit & loss a/c",
  );
  return usable.find((l) => isCapital(l.name)) ?? null;
}
