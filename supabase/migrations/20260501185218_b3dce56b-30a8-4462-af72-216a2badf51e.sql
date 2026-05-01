-- Composite covering index for the most common ledger-balance / report query:
-- voucher_entries joined to vouchers filtered by ledger_id + voucher date.
-- Existing idx_ventries_ledger only helps the first half; this covers both
-- columns we read most often (debit_paise, credit_paise) and lets Postgres
-- skip heap fetches for balance roll-ups.
CREATE INDEX IF NOT EXISTS idx_ventries_ledger_amounts
  ON public.voucher_entries (ledger_id)
  INCLUDE (debit_paise, credit_paise, voucher_id);

-- Voucher list / day-book / register pages filter by (company, type, date).
-- The existing idx_vouchers_company_date covers (company_id, voucher_date)
-- but not when voucher_type is also in the filter (very common).
CREATE INDEX IF NOT EXISTS idx_vouchers_company_type_date
  ON public.vouchers (company_id, voucher_type, voucher_date DESC);

-- Drop the exact-duplicate index (idx_voucher_entries_ledger duplicates
-- idx_ventries_ledger), saving write-amplification on every voucher insert.
DROP INDEX IF EXISTS public.idx_voucher_entries_ledger;