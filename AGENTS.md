# Architecture rules

- GSTR-9 keeps GSTN rate/UQC detail separate from consolidated HSN presentation so summary merging cannot corrupt official filing rows.
- GSTR-9 drill-down provenance is generated alongside classified books aggregates and reconciled HSN lines; source editing uses the existing voucher editor and manual filed-return inputs stay local and separate so investigating figures cannot rewrite accounting data.
- GST return builders share the zero-rate/zero-tax line predicate; explicit supply nature is preserved because a zero rate alone cannot identify an exemption.
- Voucher master refresh changes editing drafts only; GST direction corrections require explicit save so ledger edits cannot silently rewrite historical postings.
- GST reporting allocates saved bill tax to detail lines in integer paise without altering taxable values or including round-off; all return details share this allocation.
- Invoice-number changes require explicit create/edit input and same-type, same-company, financial-year duplicate validation; automatic recovery never renumbers records.
- Workspace surfaces and picker lettering use semantic global theme tokens; the mounted root overrides the legacy splash background so desktop screens cannot retain its startup colour. Print colours remain independent.
- WhatsApp ledger PDFs use one chronological debit/credit/running-balance table with whole-row pagination and repeated headers so independent side pagination cannot disrupt date order.- Menus, report tabs and report sections decide visibility only through the shared per-company feature helper (GST, inventory, presumptive scheme) so one company's settings never leak into another's books.
- Book/ledger print pagination (continuous vs. new page per date or ledger) is a per-device print choice rendered through print-only markup, so screen layouts and saved data are untouched.
