# Architecture rules

- GSTR-9 keeps GSTN rate/UQC detail separate from consolidated HSN presentation so summary merging cannot corrupt official filing rows.
- GSTR-9 drill-down provenance is generated alongside classified books aggregates and reconciled HSN lines; source editing uses the existing voucher editor and manual filed-return inputs stay local and separate so investigating figures cannot rewrite accounting data.
- GST return builders share the zero-rate/zero-tax line predicate; explicit supply nature is preserved because a zero rate alone cannot identify an exemption.
- Voucher master refresh changes editing drafts only; GST direction corrections require explicit save so ledger edits cannot silently rewrite historical postings.
- GST reporting allocates saved bill tax to detail lines in integer paise without altering taxable values or including round-off; all return details share this allocation.
- Invoice-number changes require explicit create/edit input and same-type, same-company, financial-year duplicate validation; automatic recovery never renumbers records.
- Workspace surfaces and picker lettering use semantic global theme tokens; the mounted root overrides the legacy splash background so desktop screens cannot retain its startup colour. Print colours remain independent.
- WhatsApp ledger PDFs use one chronological debit/credit/running-balance table with whole-row pagination and repeated headers so independent side pagination cannot disrupt date order.
- Menus, report tabs and report sections decide visibility only through the shared per-company feature helper (GST, inventory, presumptive scheme) so one company's settings never leak into another's books.
- Section 170 rounding (nearest rupee per tax head) applies only to return lines. It must never post to the ledger; the exact figures stay on `unrounded` for the books-to-return difference.
- Chat GST figures are read-only and labelled provisional. Chat checks (`check_book_rules`) explain and point to rows; blocking happens only on save and report screens.
- Company-level policy thresholds (count variance, round-off, advance notice) must not diverge between devices. Until they sync through the company record, treat them as device-local and do not add a second override path.
- Book/ledger print pagination (continuous vs. new page per date or ledger) is a per-device print choice rendered through print-only markup, so screen layouts and saved data are untouched.
- A zero rate alone never makes a line exempt. Zero-rate lines are exempt only when their HSN matches the exempt-goods list (`src/lib/gst/exempt-goods.ts`, generated from Notification 10/2025-CT(R)); otherwise they are nil-rated. Chapter-level and free-text list entries are never matched automatically.
- Tally import skips an exact repeat (same type, number, date, party and total) and imports a same-number voucher with a different total but reports it for checking; it never silently drops a voucher.
- The SQLite book file is never deleted by the app: the uninstaller keeps app data (custom NSIS template) and the daily snapshot is never pruned automatically.
- Startup integrity failures are shown, never repaired automatically, and the banner does not alter data.
- Storage layer roles (SQLite, IndexedDB cache, cloud) are recorded in docs/adr/0001-storage-layers.md; change that record before changing which layer is the system of record.
