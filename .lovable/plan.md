# Centralized Keyboard Navigation Engine

Goal: one shared engine that owns focus order, shortcuts, and popup focus across every accounting screen, so the app is fully usable and fast from the keyboard alone. Mouse still works; browser Tab behavior is replaced by our own deterministic order.

## What exists today

- `src/components/fast-form/useFocusManager.tsx` — per-form focus manager (already used by voucher rows).
- `src/components/fast-form/FocusHints.tsx` — hint provider for the current field.
- `src/components/TopMenuBar.tsx` + `QuickActionsRibbon.tsx` — roving tabindex + Alt-shortcuts + Escape stages (just implemented).
- `src/routes/app.tsx` — global Alt-hotkeys (S/P/R/Y/C/D/J/L), F1 cheatsheet, staged Escape.
- Individual voucher pages wire their own Enter handling.

Problem: each screen re-implements Enter/Arrow/Tab handling. There is no single registry, no global shortcut context, and no reliable focus restoration after dialogs.

## Deliverable

A `src/lib/keyboard/` module that every screen opts into:

```
src/lib/keyboard/
  KeyboardProvider.tsx    # top-level context, mounts global listener
  focusRegistry.ts        # registers/orders focusable nodes per scope
  useFocusable.ts         # hook: register a node, get ref + handlers
  useFocusScope.ts        # hook: create/enter a scope (form, dialog, grid)
  useShortcut.ts          # hook: bind a shortcut, scoped + context-aware
  shortcuts.ts            # shortcut parsing + match ("Alt+S", "Ctrl+Enter")
  focusRestore.ts         # push/pop focus stack across dialogs
  types.ts
```

### Behavior contract

1. Enter
   - On an input: move to next registered field in the scope.
   - On a combobox/select: open dropdown; if open, confirm highlighted option then move next.
   - On the last field of a form: does NOT submit; instead focuses the primary action button. A second Enter on that button submits.
   - Shift+Enter = previous field.
2. Arrow keys
   - Vertical scopes (grids, menus, lists): Up/Down move within scope.
   - Horizontal scopes (menubar, ribbon, tabs): Left/Right move within scope.
   - Never leak to browser scroll while a scope is active.
3. Tab
   - Intercepted at scope root. Same as Enter-next / Shift+Tab = previous, but never leaves the scope. Only Ctrl+Tab or an explicit "exit scope" shortcut moves between scopes.
4. Escape — keeps the staged behavior already implemented (field blur → close overlay → leave page → focus menubar → exit confirm).
5. Shortcuts
   - Registered with a scope tag (`global`, `voucher`, `report`, `grid`, `dialog`).
   - Only the deepest active scope's shortcuts fire; `global` always fires unless a dialog claims the key.
   - Ignored while typing in a plain text field unless marked `allowInField: true`.
6. Focus restore
   - Opening any dialog pushes the current active element; closing pops and restores it on the next microtask (after React commit) so re-renders don't steal focus.
7. No focus jumps after re-render
   - Registry stores logical field IDs, not DOM refs alone. If the current focused ID re-mounts, we re-focus it after commit via a `useLayoutEffect` in the provider.

### Integration plan (phased, each phase ships working)

Phase 1 - Engine + provider
  - Add the `src/lib/keyboard/` module above.
  - Mount `<KeyboardProvider>` inside `src/routes/app.tsx` around `<Outlet />`.
  - Migrate existing global Alt-hotkeys and staged Escape from `app.tsx` into `useShortcut` calls, without behavior change.

Phase 2 - Menubar + ribbon
  - Rewrite `TopMenuBar` and `QuickActionsRibbon` roving-tabindex logic to use `useFocusScope({ orientation: "horizontal" })`. Removes ~120 lines of hand-rolled arrow handling.

Phase 3 - Voucher entry forms
  - Replace `useFocusManager` internals with a thin adapter over the new engine so existing voucher screens keep working while gaining Enter-to-next, Shift+Enter-back, and predictable re-mount focus.
  - Wire the "last field -> primary button, second Enter submits" rule in the voucher form shell.

Phase 4 - Reports & grids
  - Wrap `DataGrid` in a `useFocusScope({ orientation: "grid" })` so Up/Down/Left/Right/Home/End/PageUp/PageDown are consistent across every report.
  - Register report toolbar shortcuts (`Ctrl+P` print, `Ctrl+E` export, `Ctrl+F` filter) through `useShortcut` with scope `report`.

Phase 5 - Dialogs
  - Ensure every shadcn dialog opens inside a new focus scope and pops the focus stack on close. shadcn/Radix already restores focus; we add the registry push so re-renders during close don't lose it.

### Out of scope for this pass

- Chording sequences (Ctrl+K then S). Can be added later on top of `useShortcut`.
- Rebinding UI. Shortcuts stay hard-coded for now.

### Acceptance checks

- Tab on any voucher form moves through fields in the order they are registered, never to browser chrome, never to hidden fields.
- Enter on a party picker opens the dropdown; Enter again picks the highlighted party and jumps to the next field.
- Opening and closing any dialog returns focus to the exact control that opened it, even if the parent list re-rendered.
- Alt+S/P/R/Y/C/D/J/L still open the right vouchers from anywhere except while typing in a field.
- Escape still follows the 5 stages defined earlier.
- No screen relies on native Tab order for correctness.

## Scope of this plan

Phase 1 and Phase 2 in the first implementation pass (engine + menubar/ribbon migration). Phases 3-5 land in follow-up passes so we can verify each accounting screen behaves identically before and after migration.

Reply "go" to start Phase 1+2, or tell me which phase to prioritize.
