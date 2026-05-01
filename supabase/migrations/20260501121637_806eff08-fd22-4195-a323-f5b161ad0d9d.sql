-- Allow company deletion to cascade through voucher line items and ledger references.
-- Previously RESTRICT blocked deleting companies that had any vouchers/items.

ALTER TABLE public.voucher_items
  DROP CONSTRAINT voucher_items_item_id_fkey,
  ADD CONSTRAINT voucher_items_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;

ALTER TABLE public.voucher_entries
  DROP CONSTRAINT voucher_entries_ledger_id_fkey,
  ADD CONSTRAINT voucher_entries_ledger_id_fkey
    FOREIGN KEY (ledger_id) REFERENCES public.ledgers(id) ON DELETE CASCADE;

ALTER TABLE public.vouchers
  DROP CONSTRAINT vouchers_party_ledger_id_fkey,
  ADD CONSTRAINT vouchers_party_ledger_id_fkey
    FOREIGN KEY (party_ledger_id) REFERENCES public.ledgers(id) ON DELETE SET NULL;
