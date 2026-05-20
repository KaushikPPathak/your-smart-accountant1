
## Context — what already works today

Most of what you're asking for is already wired up in the codebase. Before adding anything, here's the honest state of play so we only build the missing pieces:

| Requirement | Status | Where it lives |
|---|---|---|
| DDMM → auto-fill FY year, advance focus | ✅ Done | `FyDatePicker.handleChange` (4/6/8-digit detection, FY year auto-picked Apr–Mar) |
| Dropdown select → lock + advance to next field | ✅ Done | `Combo.handleSelect` (calls `advanceFocus` after select) |
| Enter = Tab across the whole form | ✅ Done | `useEnterAsTab` wrapping the form in `ItemVoucherForm` |
| Ctrl+S = Save/Accept | ✅ Done | `ItemVoucherForm` global keydown |
| Enter does not submit the form | ✅ Done | `useEnterAsTab` calls `preventDefault` |
| F3 / Shift+F3 / F4 / Shift+F4 / Ctrl+D / Ctrl+R | ✅ Done | Same global keydown |

So we are **not rebuilding** the navigation — we're filling 4 specific gaps.

## What's actually missing

1. **Infinite item-grid loop** — Enter inside `Item → Description → Qty → Rate → Disc → GST` currently advances via the generic Enter-as-Tab, but:
   - The **GST column is a Radix `<Select>`**, so Enter opens the dropdown instead of moving to the next cell.
   - On the **last row, last column**, Enter falls through to the "Add line" button / Narration textarea instead of appending a new line and focusing the new row's Item picker.
2. **Alt+S** is not bound (only Ctrl+S / Cmd+S is).
3. **Backspace guard on date auto-advance** — `FyDatePicker.handleChange` fires the 4-digit auto-commit even when the user reached length 4 by *deleting* a character. That can yank focus away while they're correcting.
4. **Date field's "next" target** — today, Date → Party (because Party is the next focusable). Your spec says Date → Reference/Bill No. Decide: keep current order, or visually reorder so Reference No sits right after Date.

## Plan

### 1. Infinite item-grid loop (`src/components/fast-form/ItemRow.tsx` + small hook in `ItemVoucherForm.tsx`)

- Add a new prop `isLastRow: boolean` and `onAdvanceToNewRow: () => void` to `ItemRow`.
- Wrap every editable cell (`Description`, `Qty`, `Rate`, `Discount`) with a shared `onKeyDown` that:
  - On `Enter`: prevents default, commits the current value, then focuses the next cell in the row using a per-row `useRef` map (`item-combo → desc → qty → rate → disc → gst`).
  - On the **GST** column: replace the Radix `<Select>` Enter behaviour by handling Enter at the `SelectTrigger` level — if a value is already chosen and the popover is closed, treat Enter as "advance"; otherwise let Radix open the popover as normal. After selection via `onValueChange`, programmatically advance.
  - When Enter is pressed on the **last editable cell (GST) of the last row**, call `onAdvanceToNewRow`, which in `ItemVoucherForm` runs `addLine()` and then on next paint focuses the freshly appended row's Item Combo (look up by row `id` via a `Map<string, HTMLElement>` of registered triggers).
- The Item picker (`Combo`) already auto-advances after pick via existing `Combo.handleSelect` — no change needed there.

### 2. Alt+S as a Save alias

In the existing global `keydown` handler in `ItemVoucherForm.tsx`, extend the Ctrl+S branch:

```
if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.toLowerCase() === "s") { … }
```

Same behaviour for both — `preventDefault` + `save()`. Note Alt+S may conflict with browser menu access keys; we'll add `e.stopPropagation()` to keep it predictable.

### 3. Backspace guard on date auto-advance (`src/components/ui/fy-date-picker.tsx`)

- Track the previous input length in a `useRef<number>`.
- In `handleChange(v)`, if `v.length < prevLen.current`, **skip** the auto-commit/advance path — only update the visible text. Always update `prevLen.current = v.length` at the end.
- Result: typing `2`, `0`, `0`, `5` → commits + advances. Typing `20055` then backspacing to `2005` → no auto-advance; user can keep editing.

### 4. Date → Reference No ordering (optional, needs your call)

Two options — pick one:
- **A. Keep order as Date → Party → RefNo.** No code change; auto-advance lands on Party, which matches Tally/Busy convention (party is usually the very next field after date).
- **B. Reorder the header grid** in `ItemVoucherForm.tsx` to Date → Reference No → Party → Place of Supply, so Date's auto-advance lands on Reference No exactly as your spec says.

I'll wait for your call on this one before touching the layout.

## Technical notes (for reference)

- All focus moves use `requestAnimationFrame` after state updates so React has committed the new row to the DOM before we call `.focus()`.
- Row-level refs are keyed by the line's stable `crypto.randomUUID()` id (already present on `Line.id`), so re-renders don't lose the focus target.
- We do **not** introduce a new global focus manager — `useFocusManager` exists but is unused here; the existing `useEnterAsTab` + targeted per-cell handlers are enough and keep the diff small.
- The GST `<Select>` will get an `onKeyDown` on its `SelectTrigger` that inspects `aria-expanded`; if `"false"` and a value is set, we preventDefault and call the row's `advanceToNextCell("gst")`.
- No backend / Supabase / schema changes. Pure frontend.

## Files touched

- `src/components/fast-form/ItemRow.tsx` — per-cell Enter handlers, GST-trigger Enter handling, last-cell hook-out
- `src/components/vouchers/ItemVoucherForm.tsx` — Alt+S alias, `onAdvanceToNewRow` callback that appends a row and focuses its Item picker, registry of row Item-Combo refs
- `src/components/ui/fy-date-picker.tsx` — backspace guard via `prevLen` ref
- (Optional, if you pick option B above) header grid reorder in `ItemVoucherForm.tsx`

## One question before I build

For point 4 above — do you want me to **reorder the header to Date → Reference No → Party** (matches your spec literally), or **keep Date → Party → Reference No** (current Tally-like order)?
