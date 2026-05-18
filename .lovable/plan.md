## Goal

Right now the T-format (Horizontal) ledger view shows only two columns per side:
`Particulars` + `Amount`, with the date / vch type / vch no / cheque-ref crammed
into a small "hint" line under the particulars. The Grid view, by contrast, is a
clean Excel-style table with separate columns: **Date | Particulars | Vch Type |
Vch No | Narration | Debit | Credit | Balance** and vertical gridlines between
every column.

You want the T-format to use the **same column structure as Grid** on each side,
with vertical gridlines — and the **only** difference between Grid and T-format
should be that T splits debit and credit into Dr (left) and Cr (right) halves.

## What changes

### 1. New columnar T-account renderer

Create `src/components/reports/TAccountColumnar.tsx`. It renders one big table
with this layout:

```text
┌──────────────────────────── Dr. ────────────────────────────┬──────────────────────────── Cr. ────────────────────────────┐
│ Date │ Particulars │ Vch Type │ Vch No │ Chq/Ref │ Amount   │ Date │ Particulars │ Vch Type │ Vch No │ Chq/Ref │ Amount   │
├──────┼─────────────┼──────────┼────────┼─────────┼──────────┼──────┼─────────────┼──────────┼────────┼─────────┼──────────┤
│ ...  │ To Sales A/c│ Sales    │ 0012   │ INV/12  │ 5,000.00 │ ...  │ By Cash A/c │ Receipt  │ 0007   │ NEFT123 │ 5,000.00 │
│ ...  │ ...         │ ...      │ ...    │ ...     │ ...      │      │             │          │        │         │          │
├──────┴─────────────┴──────────┴────────┴─────────┼──────────┼──────┴─────────────┴──────────┴────────┴─────────┼──────────┤
│ Total                                            │ 5,000.00 │ Total                                            │ 5,000.00 │
└──────────────────────────────────────────────────┴──────────┴──────────────────────────────────────────────────┴──────────┘
```

Key details:
- One real `<table>` (not two stacked div grids) so column widths align and
  vertical borders are continuous from header → body → totals.
- Thick center separator (2px) between the Dr and Cr halves; thin gridlines
  between every other column, matching Grid view styling.
- Rows on the shorter side padded with blank cells so the center divider stays
  straight and totals line up.
- "To Opening Balance" / "By Opening Balance" become normal rows with the date
  in the Date column (no more cramped hint line).
- Amount column right-aligned, `tabular-nums`, monospace — same as Grid.
- Click-to-drill behavior preserved on each row (whole row clickable).

### 2. Ledger route wiring

In `src/routes/app.reports.ledger.tsx`:

- Replace the `<TAccount>` usage in the horizontal view with `<TAccountColumnar>`,
  passing per-row objects: `{ date, particulars, vchType, vchNo, chqRef, amount, onClick }`.
  `chqRef` comes from `v.reference_no` (the existing field used for cheque /
  NEFT / bill ref). Narration is dropped from the on-screen T row — it would
  bloat the table; it remains in Grid/Columnar and in the per-row hover tooltip.
- "Balance c/d" lines stay as the closing balancing row on whichever side is
  short, rendered as a bold total row spanning Date..Chq/Ref with the amount
  in the Amount column.
- Drop the old `drRows` / `crRows` `TRow[]` mapping; build the new column rows
  directly inside `useMemo` so we don't recompute on every render.

### 3. PDF export for T-format

In `onExportPdf` (horizontal branch) and the matching All-Ledgers exporter, change
the head/body/foot to the new column shape:

- head: `["Date","Particulars","Vch Type","Vch No","Chq/Ref","Amount", "Date","Particulars","Vch Type","Vch No","Chq/Ref","Amount"]`
- body: parallel rows, padded with `""` on the shorter side.
- foot: `["Total","","","","", drTotal, "Total","","","","", crTotal]`
- `rightAlignCols: [5, 11]`, `dividerBeforeCol: 6` so jsPDF draws the same
  thick center divider used today.
- CSV / XLSX rows updated to the same 12-column shape so exports match what's
  on screen.

### 4. Out of scope

- Grid view and Columnar view are unchanged.
- Other reports (Cash/Bank, BRS, etc.) are unchanged.
- Word export of single-ledger T-format already piggybacks on the on-screen
  HTML and will pick up the new structure automatically; no extra work needed.

## Files touched

- **new** `src/components/reports/TAccountColumnar.tsx`
- **edit** `src/routes/app.reports.ledger.tsx` (horizontal render + PDF/CSV/XLSX export builders)

No DB changes, no schema changes, no business-logic changes — purely a
presentation change to the T-format ledger.
