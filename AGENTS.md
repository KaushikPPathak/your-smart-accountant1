# Architecture rules

- GSTR-9 keeps GSTN rate/UQC detail separate from consolidated HSN presentation so summary merging cannot corrupt official filing rows.
- GST return builders share the zero-rate/zero-tax line predicate; explicit supply nature is preserved because a zero rate alone cannot identify an exemption.
- Voucher master refresh changes editing drafts only; GST direction corrections require explicit save so ledger edits cannot silently rewrite historical postings.
- GST reporting allocates saved bill tax to detail lines in integer paise without altering taxable values or including round-off; all return details share this allocation.
- Invoice-number changes require explicit create/edit input and same-type, same-company, financial-year duplicate validation; automatic recovery never renumbers records.
- Workspace surfaces and picker lettering use semantic global theme tokens; the mounted root overrides the legacy splash background so desktop screens cannot retain its startup colour. Print colours remain independent.