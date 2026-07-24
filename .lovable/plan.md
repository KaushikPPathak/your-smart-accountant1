# Smooth Keyboard Architecture — Audit + Upgrade Plan

Goal: make keyboard feel instant (no lag between keypress and visual response), matching Busy/Tally. The three pillars you named are the right ones. Here is where we stand and what to change.

## Pillar 1 — Imperative focus management

**Have today**
- `src/lib/keyboard/KeyboardProvider.tsx` — single window listener, refs only, zero re-render on keypress.
- `src/lib/keyboard/useAutoFocusRestore.ts` — snapshots `activeElement`, restores after Radix closes.
- `src/components/fast-form/useFocusManager.tsx` — ref-map, `focusByName`, `focusNext`, no React state.
- Voucher forms use `useEnterAsTab` → `useFormEnterNav` (ref-driven).

**Gaps causing lag**
- `TopMenuBar.tsx` still mixes React state (`openMenu`, roving `tabIndex`) with Radix Menubar. Every arrow key triggers a state update + full menubar re-render.
- `QuickActionsRibbon.tsx` also keeps a controlled active index in state.
- Company picker (`routes/index.tsx`) uses a coordinate grid stored in state.
- Several dialogs still read `document.activeElement` on every render instead of once.

**Fix**
- Convert menubar, ribbon, and picker to **ref-based roving focus**: one `useRef<HTMLElement[]>`, `data-key` attributes, focus moves via `el.focus()` — no `setState` on arrow keys.
- Move all "which item is active" tracking out of React state; derive from `document.activeElement` when needed.

## Pillar 2 — Asynchronous data persistence (keystroke path stays clean)

**Have today**
- Voucher draft autosave is debounced (`useVoucherDraft`).
- Balances cache runs off the main thread (recent fix).
- Brain SQLite writes are already async via `safeBrainExec`.

**Gaps causing lag**
- `emitDataChange` fires listeners synchronously; some subscribers (answer cache, semantic index) do work inline on the keypress that saved a voucher.
- `LedgerBalanceChip` re-queries IndexedDB on each field-change, not on idle.
- `FocusHints` context updates on every field focus → re-renders the whole status bar.

**Fix**
- Wrap `emitDataChange` dispatch in `queueMicrotask` + a small idle scheduler (`requestIdleCallback` fallback to `setTimeout(0)`).
- Debounce `LedgerBalanceChip` fetch to 120 ms and cache last result per ledger id.
- Replace `FocusHints` context with a plain event bus + a memoized subscriber component so hint changes don't re-render forms.
- Confirm outbox / snapshot writes never block the keydown handler (audit `emitDataChange` subscribers).

## Pillar 3 — Streamlined DOM structures

**Have today**
- Menubar uses Radix (good baseline).
- Voucher grid rows use `EntryRow` / `ItemRow` — reasonably flat.

**Gaps causing lag**
- `TopMenuBar` wraps each trigger in 3–4 nested `<div>`s for the coffee/violet badge + gradient — repaints on every focus change.
- `QuickActionsRibbon` renders all buttons even when off-screen; each has motion/gradient wrappers.
- Report tables render full-height DOM (no virtualization) — arrow-key nav down a 5k-row day book stutters.
- Tooltip provider wraps the entire tree; every focus opens a tooltip timer.

**Fix**
- Flatten menubar trigger DOM (badge as pseudo-element, not wrapper div).
- Add `content-visibility: auto` to off-screen ribbon groups and report rows.
- Virtualize long report/grid tables (`@tanstack/react-virtual`) — keyboard nav then moves through ~30 rendered rows regardless of dataset size.
- Scope Tooltip delayDuration up to 400 ms and skip tooltips for focus-only opens on menubar/ribbon.

## Deliverables

1. `docs/KEYBOARD_ARCHITECTURE.md` — one-page contract describing the three pillars and where each lives.
2. Refactor `TopMenuBar.tsx`, `QuickActionsRibbon.tsx`, `routes/index.tsx` picker to ref-based roving focus (no state on arrows).
3. Idle-schedule `emitDataChange` fan-out; debounce `LedgerBalanceChip`; slim `FocusHints`.
4. Flatten menubar/ribbon DOM; virtualize report grids; tighten Tooltip.
5. Extend `playwright/tests/cold-start.spec.ts` with a **latency assertion**: measure time from `page.keyboard.press('ArrowRight')` to `aria-expanded="true"` — must be < 50 ms on CI.

## Out of scope
- No visual redesign, no changes to shortcut bindings or Escape ladder — behavior stays identical, only smoother.
- No changes to business logic, voucher posting, or backup/restore.

## Success criteria
- Arrow key across top menu opens next dropdown in one animation frame (visibly instant).
- Typing in a voucher amount field never drops a keystroke, even during autosave.
- Day-book arrow-key scroll stays at 60 fps on a 5k-row dataset.
