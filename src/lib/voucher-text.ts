/**
 * Resolve the "Narration" text to display in any report row.
 *
 * Priority (matches the Tally / double-entry convention the user expects):
 *   1. The per-line entry narration (voucher_entries.narration)
 *   2. The voucher-level narration (vouchers.narration)
 *   3. The voucher reference number (vouchers.reference_no) — what the user
 *      typed into the "Reference / Cheque / UTR No." field
 *   4. Fallback supplied by the caller (often a humanised voucher_type)
 */
interface EntryLike {
  narration?: string | null;
}
interface VoucherLike {
  narration?: string | null;
  reference_no?: string | null;
}

export function narrationOf(
  entry: EntryLike | null | undefined,
  voucher: VoucherLike | null | undefined,
  fallback = "",
): string {
  return (
    (entry?.narration && entry.narration.trim()) ||
    (voucher?.narration && voucher.narration.trim()) ||
    (voucher?.reference_no && voucher.reference_no.trim()) ||
    fallback
  );
}

/** True when at least one row in the list has any narration text. */
export function hasAnyNarration(rows: { narration?: string | null }[]): boolean {
  return rows.some((r) => !!(r.narration && r.narration.trim().length > 0));
}
