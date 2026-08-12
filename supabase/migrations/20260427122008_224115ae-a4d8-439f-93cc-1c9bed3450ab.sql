-- Add group_code to ledgers for Schedule III / IT-norms grouping
ALTER TABLE public.ledgers
  ADD COLUMN IF NOT EXISTS group_code text;

CREATE INDEX IF NOT EXISTS idx_ledgers_group_code
  ON public.ledgers (company_id, group_code);

-- Backfill from existing ledger.type so old data is grouped sensibly.
UPDATE public.ledgers SET group_code = CASE type
  WHEN 'capital'           THEN 'CAPITAL_ACCOUNT'
  WHEN 'loan_liability'    THEN 'UNSECURED_LOANS'
  WHEN 'current_liability' THEN 'CURRENT_LIABILITIES'
  WHEN 'duties_taxes'      THEN 'DUTIES_AND_TAXES'
  WHEN 'sundry_creditor'   THEN 'SUNDRY_CREDITORS'
  WHEN 'fixed_asset'       THEN 'FIXED_ASSETS'
  WHEN 'current_asset'     THEN 'CURRENT_ASSETS'
  WHEN 'stock_in_hand'     THEN 'STOCK_IN_HAND'
  WHEN 'sundry_debtor'     THEN 'SUNDRY_DEBTORS'
  WHEN 'cash'              THEN 'CASH_IN_HAND'
  WHEN 'bank'              THEN 'BANK_ACCOUNTS'
  WHEN 'income_direct'     THEN 'SALES_ACCOUNTS'
  WHEN 'income_indirect'   THEN 'INDIRECT_INCOMES'
  WHEN 'expense_direct'    THEN 'PURCHASE_ACCOUNTS'
  WHEN 'expense_indirect'  THEN 'INDIRECT_EXPENSES'
  ELSE NULL
END
WHERE group_code IS NULL;