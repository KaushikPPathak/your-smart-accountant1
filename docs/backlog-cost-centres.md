# Backlog: cost-centre field and enforcement (7.3)

Status: specified, not built. Do not add a cost-centre validation to save until the field exists;
a rule that no voucher can satisfy blocks every expense voucher with no way out.

## What to build, in order

1. **Schema.** A nullable `cost_center_id` on each item voucher line and on each entry-form line
   that posts to an expense ledger. A voucher-level `cost_center_id` as the default for its lines.
   Cost centres stay company-scoped (the existing `cost_centres` list).
2. **Forms.** Item line and entry form get an optional cost-centre picker. Optional on save.
   The voucher default fills new lines and can be changed per line.
3. **Enforcement.** `missingRequirements` in `src/lib/voucher-requirements.ts` enforces the cost
   centre only when the company has at least one cost centre defined. Companies that never use
   cost centres are never blocked.
4. **Reports.** Every report that groups by cost centre treats `null` as "Unallocated". It must
   not error or drop the row.
5. **Sync.** The new columns go through the same cloud, SQLite and cache path as other voucher
   fields. Add them to the migration, the desktop schema and the Dexie row together.

## Rule (7.3, final wording)

Cost centre required where the line form supports it, when the company has at least one cost
centre. Applies to purchase, payment and journal lines that post to an expense ledger. Does not
apply to tax, tax payment or round-off entries.

## Acceptance

- A company with no cost centres saves every voucher as before.
- A company with cost centres cannot save an expense line without one, and the message names the line.
- A null cost centre appears as "Unallocated" in every cost-centre report.
- The chat rule list (`check_book_rules`) reports the same rows the save path would block.
