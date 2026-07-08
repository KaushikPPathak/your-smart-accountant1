## Goal
Bring every voucher form up to the same robustness bar. Today only the item-based form (Sales/Purchase/etc.) has crash-recovery drafts and duplicate protection. Journal/Payment/Receipt/Contra and Manufacturing lag behind, and keyboard flow is inconsistent.

## Scope (4 areas, one pass)

### 1. Draft auto-save & crash recovery
- Extract the existing draft logic from `ItemVoucherForm.tsx` into a reusable hook `src/hooks/useVoucherDraft.ts` (debounced write, restore on mount, clear on save/cancel, per company + voucher type key).
- Wire it into `EntryVoucherForm.tsx` (Journal / Payment / Receipt / Contra) and `ManufacturingVoucherForm.tsx`.
- On restore, show a small inline "Draft recovered — Discard" banner (not a toast) so nothing is silently overwritten.

### 2. Validation & duplicate protection
- Reuse `voucher-duplicate-check.ts` in `EntryVoucherForm` and `ManufacturingVoucherForm` (same warn-before-save pattern already used in `ItemVoucherForm`).
- Add inline field-level errors (currently some errors only appear as toasts):
  - Unbalanced Dr/Cr in Journal
  - Missing party for Payment/Receipt when narration implies one
  - Duplicate voucher number for the same series in the current FY
  - Negative stock warning in Manufacturing (uses existing invariants)
- Errors render under the offending field; Save stays disabled until fixed (or user explicitly overrides for soft warnings).

### 3. Keyboard-only speed
- Standardise the Enter-to-advance behaviour (`enterTab` is already used in most forms — audit and fix gaps in Manufacturing).
- Global voucher shortcuts inside a voucher form:
  - `Ctrl+S` save, `Esc` cancel with confirm-if-dirty
  - `Ctrl+D` duplicate last row (item/entry grids)
  - `Ctrl+Del` remove current row
  - `F2` focus date, `F4` focus party, `Alt+N` new voucher after save
- Ensure `autoFocus` lands on Date on mount, then Enter moves through Party → Ref → Place of Supply → first grid row.

### 4. Auto-complete & smart defaults
- Party picker: remember last-used party per voucher type; pre-select on new voucher (opt-out via a setting).
- Item picker: on select, auto-fill unit, rate, HSN, GST rate from item master (already partially done — audit + fill gaps in Purchase and Credit/Debit Note).
- Ledger picker in Journal: rank by recency-of-use within the current company.
- Reference number: auto-suggest next number based on the highest existing ref for that party+voucher type in the current FY (suggestion only, editable).

## Files touched
- New: `src/hooks/useVoucherDraft.ts`, `src/hooks/useVoucherShortcuts.ts`
- Edited: `src/components/vouchers/EntryVoucherForm.tsx`, `ManufacturingVoucherForm.tsx`, `ItemVoucherForm.tsx` (refactor to use the shared hook), plus small helpers in `src/lib/voucher-defaults.ts` (new) for last-used party / recency ranking.
- Tests: extend `src/test/voucher-invariants.test.ts` with duplicate-number and draft-restore cases.

## Out of scope for this pass
- Voice entry, barcode scanning, multi-currency, batch/serial tracking — separate hardening passes.
- No schema changes; drafts stay in `localStorage` (local-only per project rule).

## Order of work
1. Extract `useVoucherDraft` and migrate all three forms.
2. Add duplicate + inline validation to `EntryVoucherForm` and `ManufacturingVoucherForm`.
3. Add `useVoucherShortcuts` and wire into all three forms.
4. Smart defaults (last-used party, ref suggestion, ledger recency).
5. Run the voucher test suite and typecheck.
