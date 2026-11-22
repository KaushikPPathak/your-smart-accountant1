# Backlog: scope decisions and deferred items

Items here are either a recorded scope decision (out of scope for chat) or a separate backlog
item. Neither is unfinished work on the current release.

## Scope decisions (out of scope for chat)

- **Rule 46 tax-invoice completeness (catalogue 6.3a).** Not a chat check. A chat list of invoices
  would be full of false positives: the legal checklist depends on the recipient's registration
  status and on the turnover slab. Build it as a required-field check on the invoice screen when
  the invoice form validations are built: serial, date, party, HSN, taxable value, tax heads and
  place of supply.
- **GST portal GSTIN check (catalogue 6.3b).** Needs a GSP or live GSTN API, credentials, rate
  limits and a terms-of-service review. It adds a network dependency the offline app does not have.
  Build as a "Verify GSTIN" button on the party master, with a cached result and a timestamp.

## Separate backlog items

1. **General offline queue for company-settings edits.** Today every company-settings edit,
   including the policy thresholds, fails offline and changes nothing locally. Queuing one kind of
   edit would create a split between devices. A queue must cover all company-settings edits
   together, with a conflict rule for each. Do not add it through the thresholds.
2. **Invoice-screen completeness check** (see 6.3a above).
3. **Verify GSTIN button on the party master** (see 6.3b above).
4. **Cost-centre field and enforcement.** See `docs/backlog-cost-centres.md`.
5. **Threshold change history.** Thresholds change compliance behaviour. The company settings
   change log should record who changed each value and when. Not built.
