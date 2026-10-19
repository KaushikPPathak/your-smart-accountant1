# Architecture rules

- GSTR-9 keeps GSTN rate/UQC detail separate from consolidated HSN presentation so summary merging cannot corrupt official filing rows.
- GST return builders share the zero-rate/zero-tax line predicate; explicit supply nature is preserved because a zero rate alone cannot identify an exemption.
- Voucher master refresh changes editing drafts only; GST direction corrections require explicit save so ledger edits cannot silently rewrite historical postings.