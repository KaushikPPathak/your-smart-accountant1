# Fix report loading and Balance Sheet mismatch

## What will change
- Prevent Cash Book, Bank Book, and Journal Book from remaining on “Loading…” when the local accounting store is blocked or slow.
- Ensure every Balance Sheet ledger is included exactly once, even when its debit/credit sign moves it to the opposite side.
- Add focused regression checks for the missing Balance Sheet amounts and local report-read timeout behavior.

## Implementation
- Add a bounded timeout around local cache reads and handle blocked/version-changed local database connections safely, so report loading always completes or exits with a clear non-blocking failure.
- Keep local data authoritative; do not introduce cloud reads or synchronization for business data.
- Update Balance Sheet grouping so a ledger whose saved group belongs to the opposite section is placed in an appropriate fallback group instead of being silently discarded.
- Add explicit groups for bank overdrafts and debit tax balances to preserve correct accounting classification.
- Verify the affected tests, current build status, and both report paths without changing visuals or unrelated features.
