
# NCE Accounting & Compliance Module — Gap Analysis & Plan

## What already exists in the app

| Requirement | Status | Where |
|---|---|---|
| Entity type selector (Individual / HUF / AOP / Pvt Ltd / RF / Trust) | ✅ Present | `src/lib/entity-status.ts`, `app.companies.tsx` |
| Per-entity form bundling (Karta / Partners / Trustees / Directors) | ✅ Present | `entity-status.ts` (`getEntityFeatures`) |
| Annual turnover captured on company | ✅ Present | `companies.annual_turnover_paise` |
| P&L vs Income & Expenditure toggle (Trust) | ✅ Present | `app.reports.profit-loss.tsx`, `report-i18n.ts` |
| Balance Sheet with per-entity capital labels | ✅ Partial | `app.reports.balance-sheet.tsx` |
| Trading Account | ✅ Present | `app.reports.trading.tsx` |
| Period locks / FY lock (heavy-audit style) | ✅ Present | `period-locks.ts` — used for GST filings |
| Voucher repair audit table | ✅ Present (limited) | `voucher_repair_audit`, `period_lock_audit` |

## What is missing (the ICAI-NCE gaps)

1. **ICAI Level 1/2/3 classification engine** — no code anywhere computes Level from turnover + borrowings. Field `borrowings_paise` doesn't exist on `companies`.
2. **Borrowings input** — not captured in onboarding/settings.
3. **Receipts & Payments Account report** — no report route exists (only P&L, I&E, Trading, BS). Trusts and professionals need this.
4. **Level-driven disclosure gating** — reports don't hide/show disclosures based on Level. Cash-flow, related-party etc. are always the same regardless of size.
5. **Presumptive taxation (44AD / 44ADA)**
   - No calculator, no threshold tracking (₹2 Cr / ₹3 Cr for 44AD; ₹50 L / ₹75 L for 44ADA; 6% digital / 8% cash / 50% professional).
   - No opt-in flag on the company, no dashboard tile, no report route.
6. **Lightweight activity log** — today only heavyweight audits exist (period-lock, voucher-repair). No general "who edited what voucher / created which ledger" trail that a proprietor can browse.
7. **Onboarding classification wizard** — new companies skip straight to the full form; no guided "what kind of entity are you + Level auto-suggestion" step.

---

## Plan — 4 phases, each shippable independently

### Phase 1 — Classification & Threshold Engine

**Schema (migration)**
- Add to `public.companies`:
  - `borrowings_paise BIGINT NOT NULL DEFAULT 0`
  - `nce_level SMALLINT` (1/2/3, nullable = "auto-compute")
  - `nce_level_override BOOLEAN DEFAULT false`
  - `presumptive_scheme TEXT CHECK (presumptive_scheme IN ('none','44ad','44ada'))` default `'none'`
  - `presumptive_mode TEXT CHECK (presumptive_mode IN ('digital','cash','professional'))` nullable

**Code**
- New `src/lib/nce-classification.ts`:
  - `classifyNceLevel({ turnover, borrowings, entity }) → { level: 1|2|3, reason }`
  - ICAI thresholds: Level 1 turnover > ₹250 Cr or borrowings > ₹50 Cr; Level 2 turnover > ₹50 Cr or borrowings > ₹10 Cr; else Level 3.
  - Pvt Ltd is force-flagged as "corporate — use Schedule III" and this module skips it.
- Extend `entity-status.ts` with `getNceDisclosureFlags(level)` → `{ showCashFlow, showRelatedParty, showSegmentReport, ... }`.
- `Zod` schema (`schemas/company.ts`) gains `borrowings_lakhs`, `presumptive_scheme`, `presumptive_mode`.
- UI: `app.companies.tsx` gets a **Classification** card showing computed Level + reason + manual override checkbox.

### Phase 2 — Simplified Financial Statements

**New reports**
- `src/routes/app.reports.receipts-payments.tsx` — pure cash/bank Dr–Cr rebuild from `voucher_entries` filtered by ledger type = `cash` / `bank`. Follows Trust / Professional format.

**Wiring existing reports to Level**
- `app.reports.balance-sheet.tsx` and `app.reports.profit-loss.tsx`: read `nce_level` and hide corporate-only sections (Schedule III subtotals, related-party notes) when level ≥ 2.
- New shared helper `src/lib/nce-report-shape.ts` returning the disclosure set for the active company (used by BS, P&L, Trading, R&P).
- Reports menu (`app.reports.tsx`) gains "Receipts & Payments" tab, visible only when entity is Trust / Individual / HUF / RF (feature-flag driven).

### Phase 3 — Presumptive Taxation (44AD / 44ADA)

**Code**
- `src/lib/presumptive.ts`:
  - `computePresumptive({ scheme, mode, grossReceiptsPaise, digitalReceiptsPaise, cashReceiptsPaise })`.
  - Returns `{ eligibleThresholdPaise, deemedProfitPaise, effectiveRate, thresholdBreached }`.
  - Rates: 44AD → 6% digital / 8% cash; 44ADA → 50% (professional). Thresholds: ₹2 Cr / ₹3 Cr (95%+ digital); ₹50 L / ₹75 L.
- New route `src/routes/app.reports.presumptive.tsx` — dashboard with gross receipts YTD, deemed profit, threshold gauge, disqualification warnings.
- Settings toggle in `app.settings.tsx` under "Compliance": enable presumptive + pick scheme.
- Dashboard tile in `app.index.tsx` when scheme active.

### Phase 4 — Lightweight Activity Log (opt-in, local-first)

**Local-first design** (respects Core rule: no server sync of business data)
- New Dexie table in `src/lib/offline/db.ts`:
  ```
  activity_log: "++id, company_id, ts, entity_type, entity_id, action"
  ```
  Fields: `ts, actor, entity_type ('voucher'|'ledger'|'item'|'company'), entity_id, action ('create'|'update'|'delete'), diff (jsonb-ish)`.
- New helper `src/lib/activity-log.ts` — `logActivity(...)`; wrapped around existing repository writes (voucher save/update/delete, ledger create, item create).
- New route `src/routes/app.reports.activity-log.tsx` — filterable table (date/entity type/action), CSV export.
- Setting: "Enable activity log" default **on** for new NCE companies; toggle in Settings → Compliance. Retention slider (30/90/180/365 days).
- Explicitly **not** immutable, **not** synced remotely — matches the "non-mandatory / opt-in / lightweight" spec.

---

## Technical notes

- All new columns + Dexie tables follow the Core rule "no auto server sync of business data" — Phase 4 log lives only in IndexedDB.
- Migration adds `GRANT` for `authenticated` on the new columns (they're on an existing table so no fresh GRANT needed, but the migration will re-assert).
- Reports reuse the existing `voucher_entries` + `ledgers` cache — zero new heavy queries.
- No changes to keyboard architecture, GST engine, or Tauri/Electron builds.

## Deliverables per phase

| Phase | New files | Migrations | User-visible |
|---|---|---|---|
| 1 | `nce-classification.ts` + schema update | 1 | Classification card in Company form |
| 2 | `app.reports.receipts-payments.tsx`, `nce-report-shape.ts` | 0 | New R&P report, cleaner BS/P&L for small entities |
| 3 | `presumptive.ts`, `app.reports.presumptive.tsx` | 0 (uses Phase 1 cols) | Presumptive dashboard + settings toggle |
| 4 | `activity-log.ts`, Dexie v9, `app.reports.activity-log.tsx` | 0 | Opt-in activity trail |

Approve and I'll ship Phase 1 first, then loop back for Phase 2–4.
