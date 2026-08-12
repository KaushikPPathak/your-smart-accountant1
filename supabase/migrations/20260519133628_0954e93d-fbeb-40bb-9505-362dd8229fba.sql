
-- Shorten verbose system ledger names to Tally/Busy conventions.
-- Skip rename when a ledger with the short name already exists in the same company.
DO $$
DECLARE
  r record;
  pairs text[][] := ARRAY[
    ARRAY['Capital Goods (Fixed Assets)', 'Capital Goods A/c'],
    ARRAY['Input Services (Expense)',     'Input Services A/c'],
    ARRAY['Input CGST (Electronic Credit Ledger)', 'Input CGST'],
    ARRAY['Input SGST (Electronic Credit Ledger)', 'Input SGST'],
    ARRAY['Input IGST (Electronic Credit Ledger)', 'Input IGST']
  ];
  p text[];
BEGIN
  FOREACH p SLICE 1 IN ARRAY pairs LOOP
    FOR r IN
      SELECT id, company_id FROM public.ledgers WHERE name = p[1]
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.ledgers
        WHERE company_id = r.company_id AND lower(name) = lower(p[2]) AND id <> r.id
      ) THEN
        UPDATE public.ledgers SET name = p[2] WHERE id = r.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;
