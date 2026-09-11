# Fix Cash, Bank and Journal Book Loading

## Goal
Make Cash Book, Bank Book and Journal Book finish loading reliably from the device’s local accounting data, without visual changes or cloud synchronization.

## Changes
- Replace repeated full local-data scans in Cash/Bank Book with one shared local read, then derive opening balance, dated entries, and counterpart ledgers in memory.
- Make Journal Book use the same bounded, single-pass local dataset path.
- Keep local IndexedDB data authoritative and retain legacy untagged-entry recovery.
- Ensure every failure or cancellation clears the loading state and reports a non-blocking error.
- Add focused regression tests covering local-only report reads, date/ledger filtering, sibling entries, and bounded completion.
- Update the roadmap and verify affected tests plus the preview build.

## Technical details
- Add a report-specific local dataset helper around one voucher read, one voucher-entry read, and one ledger read.
- Avoid the current sequence of several independently timed eight-second reads, which can keep Cash/Bank Book waiting for multiple timeout windows.
- Do not change report layout, wording, database records, or unrelated accounting logic.
