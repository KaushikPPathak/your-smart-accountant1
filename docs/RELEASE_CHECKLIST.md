# Release Checklist — Your Mehtaji

**Every release must be signed off against this list before it goes to users.**
Print it. Tick each box by hand. File the signed sheet with the release notes.

Release version: __________________     Date: __________________
Released by: ______________________     Signed: ________________

---

## 1. Automated gates (must all be green)

- [ ] `bun run test` — all tests pass (target: 100% green, 0 skipped)
- [ ] `bunx tsgo --noEmit` — zero type errors
- [ ] `bun run build` — production build succeeds
- [ ] CI build on the release branch is green
- [ ] Stress test (`stress-10k.test.ts`) stays inside every budget

## 2. Data safety — manual (10 minutes, mandatory)

Do this against a **real company** with **at least 1 year** of vouchers.

- [ ] Backup the company from the previous release
- [ ] Install the new release over the previous one
- [ ] Open the app — company list still shows every company
- [ ] Open the tested company — voucher count matches
- [ ] Open Trial Balance — every ledger balance matches to the paisa
- [ ] Open Balance Sheet — total assets = total liabilities
- [ ] Open Profit & Loss — net figure matches previous release
- [ ] Restore the pre-upgrade backup on top of the new install — no rows lost
- [ ] Diagnostics (`/app/diagnostics`) shows **no** new failures during the drill

## 3. Statutory correctness (spot check)

Pick one recent voucher of each type and verify:

- [ ] Sales invoice — CGST + SGST split correct for intra-state, IGST correct for inter-state
- [ ] Purchase invoice with ineligible ITC — GST capitalised into purchase account
- [ ] Payment voucher — party ledger reduced by exact amount
- [ ] Receipt voucher — bank/cash increased by exact amount
- [ ] Journal — Dr = Cr on posting
- [ ] Credit note — reverses the original sale correctly

## 4. Reports parity

- [ ] Day Book prints without column overflow
- [ ] Ledger statement prints with correct opening + closing balance
- [ ] GSTR-1 summary JSON validates against schema
- [ ] Print/PDF invoice matches the customer's usual template

## 5. Rollout plan

- [ ] Release notes drafted (user-facing, plain language)
- [ ] Beta channel receives the build first
- [ ] Wait **72 hours** on beta before promoting to stable
- [ ] Feature flags for risky new code set to correct starting percentage:
  - Feature: _________________________  %: _______
  - Feature: _________________________  %: _______
- [ ] Rollback plan written: previous version installer + last known-good backup filed

## 6. Communication

- [ ] Support inbox notified of the release window
- [ ] Known issues from beta listed in release notes
- [ ] User-facing changelog published

---

## Sign-off

By signing below, I confirm every box above is ticked and I have personally
verified the data-safety drill in section 2 against a real company file.

Release owner: ________________________    Date: __________________
