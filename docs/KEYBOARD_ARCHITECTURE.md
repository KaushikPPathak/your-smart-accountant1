# Keyboard Architecture

Three pillars keep the app feeling instant on keyboard-only workflows.

## 1. Imperative focus management (no state on the keystroke path)

- **`src/lib/keyboard/KeyboardProvider.tsx`** — single `window` keydown listener, all bindings held in a `useRef` map. Zero React state, zero re-renders per keypress.
- **`src/lib/keyboard/useAutoFocusRestore.ts`** — snapshots `document.activeElement` on Radix `onOpenAutoFocus`; restores on close.
- **`src/components/fast-form/useFocusManager.tsx`** — ref-map of named inputs with `focusByName` / `focusNext`; no state.
- **`useFormEnterNav` / `useEnterAsTab`** — Enter/ArrowLeft/ArrowRight moves focus via `el.focus()`, never `setState`.
- **`QuickActionsRibbon`** — roving `tabIndex` applied by writing DOM attributes on focus; the active id lives in a ref, mirrored to `aria-activedescendant`.
- **`TopMenuBar`** — Radix Menubar owns arrow/Enter/Escape inside the menubar; we only add hover-to-open and Alt+letter shortcuts through the engine.

**Rule:** never call `setState` from an arrow/Enter/Escape handler on a hot path (menubar, ribbon, voucher grid). Move the DOM instead.

## 2. Asynchronous persistence (write off the keystroke tick)

- **`src/lib/ai/cache-events.ts`** — `emitDataChange` dispatches subscribers inside `queueMicrotask` so a voucher save on Enter never pays for cache invalidation on the same tick.
- **`useVoucherDraft`** — draft autosave debounced.
- **Brain SQLite** — writes are async through `safeBrainExec`.
- **Balances cache** — IndexedDB work runs off the main thread.

**Rule:** synchronous handlers do only DOM/focus work. Any I/O (IndexedDB, SQLite, fetch, worker) is `queueMicrotask`-ed or debounced.

## 3. Streamlined DOM

- Menubar / ribbon use Radix primitives — flat trigger DOM.
- Ribbon items carry `data-focus-item="true"` so roving focus finds them in a single `querySelectorAll`.
- Long report tables should use `@tanstack/react-virtual` (planned) so arrow-key navigation stays at 60 fps regardless of dataset size.

**Rule:** any list expected to exceed ~200 rows must be virtualized before shipping keyboard nav on it.

## Latency budget

- Arrow-key across menubar → next dropdown open: **< 50 ms** (one animation frame).
- Enter in a voucher field → focus lands on next field: **< 16 ms**.
- Typing in an amount field during autosave: **never drops a keystroke**.

The Playwright suite in `playwright/tests/cold-start.spec.ts` guards the menubar arrow-key behavior; extend it with `performance.now()` deltas when adding new hot paths.
