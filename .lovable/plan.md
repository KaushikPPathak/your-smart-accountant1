## Goal
Give the user three tightly linked GSTR-1 tools so mismatches become impossible to hide:
1. **Live preview export** that streams from the same builder the report uses, so it stays in sync as invoices change.
2. **Reconciliation drill-down** that itemises every invoice/line contributing to the `Net outward − HSN total` Difference.
3. **Voucher audit view** that shows, per sales line, which GSTR-1 bucket (B2B / B2CL / B2CS / CDNR / CDNUR / EXP / NIL / HSN-B2B / HSN-B2C) it lands in and why.

All work is frontend + a small extension to the existing `buildGstr1()` engine in `src/lib/gst-returns.ts` — no schema changes, no server work, local-only.

---

## What to build

### 1. Trace-enabled build (engine change)
Extend `buildGstr1()` with an optional `trace: true` mode that, in addition to the current buckets, returns a per-line ledger:

```text
BuildTrace = {
  lines: TracedLine[]        // one row per voucher_item (+ CN/DN items)
  voucherSummary: Map<voucherId, TracedVoucherSummary>
}

TracedLine = {
  voucherId, voucherNumber, voucherDate, voucherType,
  partyName, partyGstin, isInterstate, pos,
  itemName, hsn, uqc, qty, rate, taxable, iamt, camt, samt, csamt,
  supplyNature,                    // taxable | nil_rated | exempt | non_gst | export | sez
  buckets: {                       // where this line contributed
    section: "B2B" | "B2CL" | "B2CS" | "CDNR" | "CDNUR" | "EXP" | "NIL" | null,
    subKey:  string,               // e.g. "INTRB2B" for NIL, "27|18" for B2CS
    hsnBucket: "HSN_B2B" | "HSN_B2C" | null,
    reason: string,                // human-readable: "Registered dealer + interstate → B2B; nil line stripped to NIL/INTRB2B"
  }
}
```

Implemented by threading a lightweight recorder through the existing sales/CN loops — no branching logic change, just observation. Zero cost when `trace` is off (default).

### 2. Reconciliation drill-down (new component)
`src/components/reports/Gstr1ReconciliationDrilldown.tsx`

Opens as a dialog from a new **"Explain Difference"** button in the existing reconciliation card on `/app/reports/gstr1`.

Layout:
- Header: A (Net outward) − B (HSN total) = **Difference** (rupees + paise).
- Two panels side by side:
  - **Left — Outward side (A)**: expandable rows per section (B2B, B2CL, B2CS, EXP, NIL, CDNR, CDNUR). Each expands to the traced lines contributing to that section, showing invoice number, party, taxable, tax, section total. Running subtotal at bottom of each.
  - **Right — HSN side (B)**: same lines regrouped by `HSN_B2B` / `HSN_B2C` with per-HSN subtotals.
- **Mismatch band** at the bottom: any line whose "A side" bucket total ≠ its HSN contribution is highlighted amber. Common causes are auto-diagnosed and labelled:
  - "Round-off residue < ₹1"
  - "HSN missing on line — counted in A but not in HSN summary"
  - "UQC missing"
  - "Nil line without HSN"
  - "CN/DN sign flip"
- CSV export of the drill-down for auditor sharing.

### 3. Voucher audit view (new component + link)
`src/components/vouchers/Gstr1PostingAudit.tsx`

Reusable panel that takes a `voucherId` and shows, per line:

```text
Line 1 — "Copier Paper A4" 12% · HSN 4802 · Qty 10 REAM · ₹5,000
  → Section: B2B (registered dealer + intra-state)
  → HSN bucket: HSN_B2B (grouped 4802|REAM|12%)
  → GSTR-1 row: B2B > CTIN 24ABCDE1234F1Z5 > Inv INV/001
  → Tax split: CGST ₹300 + SGST ₹300

Line 2 — "Loose grain" NIL · no HSN
  → Section: NIL sheet > INTRAB2B > Nil-rated column
  → HSN bucket: HSN_B2B (line dropped because HSN blank — flagged)
  → Reason: 0% rate + zero tax → treated as nil-rated per Table 8
```

Mounted in two places:
- **Voucher detail page** (`app.vouchers.$voucherId.tsx`) as a collapsible "GSTR-1 posting" section.
- **From the drill-down** — clicking any invoice row opens this panel in-place.

### 4. Live preview export
`src/components/reports/Gstr1LivePreview.tsx` — a persistent side panel on `/app/reports/gstr1` (toggled by a "Live preview" switch, off by default so it stays out of the way for users who don't need it).

- Subscribes to the same `sales` / `cdnotes` state the page already loads.
- Re-runs `buildGstr1({ trace: true })` on every voucher save via the existing `cache-events.ts` bus (already used for AI cache invalidation) — debounced 300 ms.
- Shows a compact per-section table: rows, taxable, IGST, CGST, SGST, total. Difference badge highlighted red when non-zero.
- **"Download current"** button emits `.xlsx` and `.json` from the *exact* in-memory build — same guardrail path as the main export (HSN error block, reconciliation check).
- Each total in the panel has a `?` tooltip: "Sum of 42 lines from 17 invoices — click to trace" → opens the drill-down scoped to that section.

---

## Technical details

### Files to add
- `src/lib/gstr1-trace.ts` — `TracedLine`, `BuildTrace`, `classifyReason()` helpers.
- `src/components/reports/Gstr1ReconciliationDrilldown.tsx`
- `src/components/reports/Gstr1LivePreview.tsx`
- `src/components/vouchers/Gstr1PostingAudit.tsx`
- `src/lib/gstr1-trace.test.ts` — verify every existing test invoice in `gst-returns.test.ts` produces a trace whose bucket sums equal the aggregate output (invariant: `sum(trace.lines where bucket=X) === built[X].totals`).

### Files to modify
- `src/lib/gst-returns.ts` — thread optional `trace` recorder through the sales + CN loops. Additive only; no behaviour change when `trace` is undefined.
- `src/routes/app.reports.gstr1.tsx` — add "Live preview" toggle, "Explain Difference" button on the reconciliation card, wire both components.
- `src/routes/app.vouchers.$voucherId.tsx` — mount `Gstr1PostingAudit` in a collapsible section for sales / CN / DN voucher types.
- `src/lib/ai/cache-events.ts` — reuse existing `voucher:saved` topic; no new events.

### Performance
- Trace only runs when a consumer asks for it (live preview open, drill-down open, or single-voucher audit).
- Live preview uses `queueMicrotask` + 300 ms debounce, same pattern as the AI cache warmer, so keystroke latency budget in `keyboard-perf.spec.ts` remains untouched.
- Single-voucher audit builds only that voucher's slice (`buildGstr1({ sales: [v], creditNotes: [] })`) — sub-millisecond.

### Correctness guardrails
- Trace invariant test: for every fixture in `gst-returns.test.ts`, aggregate-by-bucket of `trace.lines` must equal the section totals in the current output. If it drifts, the test fails — this locks the "explanation" to the actual numbers so the drill-down can never lie.
- Reconciliation drill-down never re-computes totals; it groups already-traced lines. A and B always come from the same `BuildTrace`.

### Out of scope (deliberately)
- No changes to the GSTN JSON shape, portal template export, validators, or existing "block export on HSN error" rule.
- No new database tables — everything is derived at render time from vouchers already in IndexedDB.
