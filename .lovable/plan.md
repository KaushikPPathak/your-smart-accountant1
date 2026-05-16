# What's left to build

Shipped so far: virtualized DataGrid foundation, Phase A reports (Day Book, Ledger, Sales/Purchase Register, GST Books, Receivables/Payables, Ageing, Stock Summary, Vouchers list), pivot panel + Web Worker offload, global Currency and Date-format switchers wired into company creation.

Below is everything still open, grouped by priority.

---

## 1. Finish Phase A (the few list reports left)

Drop-in DataGrid on:
- **Cash & Bank Book** (`app.reports.cash-bank.tsx`)
- **Group Ledger** (`app.reports.group-ledger.tsx`)
- **BRS day-level lists** (`app.reports.brs.tsx`)

Each gets the existing `ViewSwitcher` (Classic ↔ Grid) so nothing changes by default.

## 2. Phase B — virtualize the heavy lists

These pages currently render unbounded rows and will stutter on large companies:
- **Trial Balance** (`app.reports.trial-balance.tsx`) — virtualize the grouped tree, add per-column filter
- **Masters**: `app.ledgers.tsx`, `app.items.tsx`, `app.account-groups.tsx` — wrap the existing tables in DataGrid so search/sort/group/export come for free

## 3. Phase C — optional grid on classic-view reports

Add a "Grid" toggle (pivot enabled) to:
- Profit & Loss, Balance Sheet, Trading
- GSTR-1, GSTR-2B, GSTR-3B summaries

Classic T-account / statutory layout stays the default; the grid view unlocks ad-hoc analysis without exporting to Excel.

## 4. Grid polish (small, finishes the story)

- **Density toggle** is in state but not exposed on the toolbar yet — show comfortable/compact button
- **Keyboard shortcuts**: `/` to focus search, `Ctrl+F` to open the active column's filter, arrow keys to move row focus, `Enter` to drill-down
- **Column pinning + resize**: pin left/right columns, drag to resize, persist width per `reportId`
- **Saved views UX**: rename, set default, export/import the JSON definition
- **Accessibility pass**: ARIA roles for grid/row/cell, focus ring, screen-reader headers, reduced-motion respect

## 5. Currency / date follow-ups

- Currency switcher already swaps the symbol everywhere `formatINR` is used. Audit the **PDF/XLSX/Word exporters** and **invoice/voucher print templates** to make sure they pick up the active symbol too (today some templates hard-code ₹).
- Date-format switcher: same audit for PDF headers and printable vouchers (`fmtIndianDate` is wired, but a few report PDFs format dates inline).

## 6. Operational hardening (outside the grid plan but visible)

- **Remix safety**: the `docs/REMIX_CHECKLIST.md` flow is manual. Consider an in-app "Backend self-test" panel under Housekeeping that runs the trigger audit + smoke test automatically after a remix.
- **Weekly backup nudge**: surface a soft reminder if the last in-app backup is >7 days old.

---

## Suggested order

1. Finish Phase A (Cash/Bank, Group Ledger, BRS) — 1 short pass
2. Phase B virtualization (TB + 3 masters) — biggest perf win
3. Grid polish (density, keyboard, pinning, saved-view UX, a11y)
4. Phase C optional grid on P&L / BS / Trading / GSTR
5. Currency + date audit across PDF/XLSX/print templates
6. Remix self-test + backup nudge

Each step is independently shippable; nothing here breaks existing screens.

---

## Out of scope (call out, don't build unless asked)

- Server-side saved views (sync across devices) — currently localStorage, per the original plan
- Full multi-currency accounting (FX rates, gain/loss ledgers) — explicitly declined earlier
- Replacing the data layer with Dexie / IndexedDB cache
