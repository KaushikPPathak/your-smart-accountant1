// Voucher types that belong in the Journal Book. Legacy/untyped rows count as journals.
export function isJournalType(t: string | null | undefined): boolean {
  return !t || t === "journal";
}
