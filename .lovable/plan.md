# Plan: Virtualized, Excel-like Reports Hub (Offline-Capable)

## Goal
Keep the browser snappy on 50k–500k row reports and let users do filter / sort / multi-column / pivot analysis inside the app — no Excel round-trip. All grid features run client-side so they work fully offline once data is loaded.

## Scope (in)
- Virtual scrolling for every long-list report and master list
- A reusable "DataGrid" shell with Excel-like filtering, multi-sort, column pinning/visibility, group-by + aggregations, simple pivot
- Reports Hub gets a "Grid view" toggle alongside the existing T-account / classic view
- Saved views per report (column order, filters, sort, pivot) persisted locally per user+company

## Scope (out, keep as-is)
- Auth, RLS, voucher entry forms, PDF/CSV/XLSX exporters, print mode
- T-account visual layout for P&L / Balance Sheet / Trading (kept; grid view is additive)
- Data layer (no Dexie migration here — that was a separate proposal)

---

## Libraries (small, proven, offline)
- `@tanstack/react-virtual` — windowing primitive
- `@tanstack/react-table` v8 — headless table (sort/filter/group/column model)
- No ag-grid / no Tabulator (heavy, license concerns). Both libs above are MIT and already align with the existing TanStack stack.

Bundle impact: ~35 KB gz combined.

---

## Architecture

### 1. New primitive: `src/components/data-grid/`
```
data-grid/
  DataGrid.tsx          # virtualized table shell
  GridToolbar.tsx       # search, column chooser, density, saved views, export
  ColumnFilter.tsx      # Excel-style per-column filter popover
  PivotPanel.tsx        # row/col/value/agg picker
  useGridState.ts       # state + persistence (localStorage key: grid:<reportId>:<companyId>)
  types.ts
```

`DataGrid<T>` props:
- `rows: T[]`
- `columns: ColumnDef<T>[]` (TanStack column defs, extended with `aggregator`, `filterType`, `pinned`)
- `reportId: string` (for saved-view persistence)
- `getRowHref?(row)` for drill-down
- `footer?: 'sum' | 'count' | custom`

Internally:
- `useReactTable` with `getSortedRowModel`, `getFilteredRowModel`, `getGroupedRowModel`, `getExpandedRowModel`
- `useVirtualizer` over `rows.length` with `estimateSize: 32`
- Sticky header + sticky footer + horizontal scroll for wide grids
- Column resize via TanStack's column sizing
- Keyboard: arrows move focus, `/` focuses search, `Ctrl+F` opens filter on active column

### 2. Excel-like column filter
Per column type:
- text → contains / equals / starts-with / regex / blank
- number → =, ≠, >, <, between, top-N, blank
- date → on, before, after, between, this-FY, last-month, custom
- enum (voucher_type, side, status) → multi-select checklist with search

Active filters surface as removable chips above the grid.

### 3. Multi-sort + grouping
- Shift-click header to add secondary sort
- Drag a column header into the "Group by" strip → rows collapse with subtotal rows showing aggregator results (sum/count/avg/min/max per numeric column)
- Up to 3 group levels

### 4. Pivot
A lightweight pivot built on the grouped row model:
- Drag fields into Rows / Columns / Values
- Values aggregate (sum/count/avg)
- Pivot table renders inside the same virtualized shell
- "Flatten" button copies the pivot result back into a normal grid for further filtering or export

Limit: pivots cap at ~10k unique row×col combinations to keep render cheap; warn beyond that.

### 5. Saved views
Stored in `localStorage` (works offline). Shape:
```
{ name, columns, sort, filters, group, pivot, density }
```
Per `reportId` + `companyId` + `userId`. UI shows a dropdown with Save / Save as / Reset.

### 6. Exports
Reuse existing `downloadCsv` / `downloadXlsx` / `downloadPdfTable`. Grid exports the **currently visible, filtered, sorted, grouped** rows — not the raw dataset. Pivot exports as a 2-D matrix.

---

## Reports getting the grid

Phase A — pure list reports (drop-in DataGrid replacement):
- Day Book — flat row grid + existing T-account toggle
- Ledger — entries table
- Group Ledger
- Sales Register, Purchase Register
- GST Sales Book, GST Purchase Book
- Outstanding Receivables / Payables / Ageing
- Stock Summary
- Cash & Bank Book
- Day-level lists in BRS

Phase B — virtualization only (no pivot needed):
- Trial Balance (already grouped — add virtualization + column filter)
- Vouchers list (`app.vouchers.tsx`)
- Ledgers / Items / Account Groups masters

Phase C — keep classic view, add optional grid:
- Profit & Loss, Balance Sheet, Trading, GSTR-1/2B/3B summaries

---

## Day Book example after change
- Toolbar gets a "View: T-account | Grid" switch (default T-account preserved)
- Grid view columns: Date, Type, Number, Party, Narration, Side, Debit, Credit, Amount
- Row click → existing `openVoucherDetail`
- Sticky footer: filtered total Dr / Cr / Net
- Filter chips: e.g. "Type = Sales, Purchase", "Party contains 'ABC'"
- Group-by Type → subtotals per voucher type
- Pivot: Rows=Party, Columns=Type, Values=Sum(amount)

---

## Performance budget
- 100k rows render in <80 ms initial, scroll at 60 fps (virtualizer keeps DOM ≤ ~50 rows)
- Filter/sort on 100k rows < 250 ms (TanStack table is in-memory; we'll memoize column accessors)
- Group + aggregate on 100k rows < 400 ms
- Pivot on 50k rows × ≤ 200 columns < 600 ms

If a dataset exceeds budget we:
1. Move heavy aggregation into a Web Worker (`src/workers/grid-agg.worker.ts`) with Comlink-style messaging
2. Cap pivot output and show a "narrow your filter" hint

Worker is wired in from day one for pivot; sort/filter stay on main thread until profiling says otherwise.

---

## Offline behaviour
- All filter/sort/group/pivot logic is pure JS in the browser → works with no network
- Saved views in `localStorage` → persist offline
- The only network dependency is the initial data fetch from Supabase; once rows are in memory the user can analyse freely
- Desktop (Electron) build inherits the same behaviour; no extra work

---

## Rollout (4 PR-sized steps)
1. **Foundation** — add libs, build `DataGrid`, `GridToolbar`, `ColumnFilter`, `useGridState`. Ship behind a feature flag, demo on Vouchers list.
2. **Phase A reports** — Day Book, Ledger, Sales/Purchase Register, GST Books, Outstanding, Ageing, Stock, Cash/Bank. Add view-switcher where a classic view exists.
3. **Pivot + Worker** — `PivotPanel`, worker-based aggregation, saved views UI.
4. **Phase B & C polish** — masters lists virtualized, classic-view reports get optional grid, keyboard shortcuts, density toggle, accessibility pass.

---

## Risks
- TanStack Table v8 + virtualizer with grouping has a known sticky-header quirk on Safari — mitigated with a CSS `position: sticky` wrapper we already use elsewhere.
- Pivot UX is easy to over-build; we ship the minimum (Rows/Cols/Values/Agg) and iterate.
- Saved views in localStorage are per-device. If you later want them synced, we can mirror to a `report_views` table — out of scope here.

---

## Deliverable per phase
Each phase is independently shippable; existing reports keep working unchanged until their grid view lands.
