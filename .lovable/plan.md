## Rapid Entry Mode — Status Bar, Focus Hints, Sub-10ms Item Grid

Neutral, generic terminology throughout. No references to legacy desktop accounting brands in code, comments, or UI copy.

### 1. Fast-Form Primitives

**Create `src/lib/save-status.ts`** — module-level pub/sub holding `{ lastSavedLabel, lastSavedAt, failureCount }`. Exposes `markSaved(label)`, `useSaveStatus()`, `useHasFailures()`.

**Edit `src/lib/save-queue.tsx`**
- After a successful `queue.shift()`, call `markSaved(job.label)`
- On failure, increment failure count in save-status (in addition to existing toast)
- Drop the per-form `toast.success(...)` calls — status bar is now the success channel; toasts remain for errors only

**Create `src/components/fast-form/FocusHints.tsx`**
- `FocusHintsProvider` with `setHints(zone, string[])` / `clearHints(zone)` and `useCurrentHints()` hook
- Default zone hints (when nothing focused): `Enter: next · Esc: back · Ctrl+S: accept · Alt+L: ledger report`

**Create `src/components/fast-form/StatusBar.tsx`** (replaces inline status line in `app.tsx`)
- Three visual states driven by `useSaveStatus()` + `useHasFailures()`:
  - **idle** — muted bg, shows `useCurrentHints()`
  - **success** — green dot + "✓ Saved {label}", auto-reverts to idle after 1500ms (timer keyed off `lastSavedAt`)
  - **alert** — amber bg + "⚠ {N} background save(s) failed — click to resolve". Click toggles `PendingSavesTray` to expanded mode.
- Right side keeps the `F1 Keyboard help` button

**Edit `src/components/fast-form/PendingSavesTray.tsx`** — accept controlled `open` prop so StatusBar can force it open; auto-shows when in-flight as today.

### 2. Item Grid Performance (sub-10ms keystroke target)

**Edit `src/components/vouchers/ItemVoucherForm.tsx`**
- Extract `<ItemRow>` as a `React.memo` component, props: `{ idx, initial: Line, gstRate, onCommit(idx, patch), onFocusZone, registerInput }`
- Numeric fields (`qty`, `rate`, `discount`) become **uncontrolled** (`defaultValue`, ref-based read), committing to parent state only on `onBlur` or `Enter`
- Item picker / description stay controlled (low cost) but isolated inside the memoized row
- Totals: wrap parent `setLines` calls in `startTransition`; derive `computed[]` and `totals` via `useDeferredValue(lines)` so the row a user is typing in feels instant while totals settle on the next idle frame
- On focus into a row's qty/rate/discount, push contextual hints: `Enter: next · F4: new item · Shift+F4: edit item · Ctrl+D: delete row · Ctrl+S: accept`

**Edit `src/components/vouchers/EntryVoucherForm.tsx`**
- Same memoized `<EntryRow>` pattern for journal/simple line grids
- Uncontrolled `debit` / `credit` / `amount` numeric inputs, commit on blur
- Defer totalDr/totalCr via `useDeferredValue`
- Focus hints: `Enter: next · F3: new ledger · Shift+F3: edit ledger · Ctrl+D: delete row · Ctrl+S: accept`

**Verification step (post-implementation)** — run `browser--start_profiling` while typing into a 25-row item grid and confirm keypress→paint self-time stays under 10ms.

### 3. Workflow Enhancements

**Recall Last Narration (`Ctrl+R`)**
- Add `src/lib/recall-store.ts` — module-level `lastNarrationByType: Record<voucherType, string>`
- After a successful enqueue, store the narration keyed by voucher type
- In both forms, `Ctrl+R` while focused in the narration field fills it with the last value (with a tiny inline "recalled" hint via FocusHints)

**Delete Row (`Ctrl+D`)** — within row focus, deletes that row (respecting min-row rule)

**Accept Confirmation Overlay**
- New `src/components/fast-form/AcceptConfirm.tsx` — small keyboard-first dialog: "Accept this voucher? (Y / N)" with `Y`/`Enter` to accept, `N`/`Esc` to cancel
- The Save button + `Ctrl+S` open this overlay first; Y proceeds to validate + enqueue
- Trap focus, no mouse needed

### 4. Files

**Create**
- `src/lib/save-status.ts`
- `src/lib/recall-store.ts`
- `src/components/fast-form/StatusBar.tsx`
- `src/components/fast-form/FocusHints.tsx`
- `src/components/fast-form/AcceptConfirm.tsx`
- `src/components/fast-form/ItemRow.tsx` (memoized row extracted from ItemVoucherForm)
- `src/components/fast-form/EntryRow.tsx` (memoized row extracted from EntryVoucherForm)

**Edit**
- `src/lib/save-queue.tsx`
- `src/components/fast-form/PendingSavesTray.tsx`
- `src/routes/app.tsx` (mount `FocusHintsProvider` + `<StatusBar />`)
- `src/components/vouchers/ItemVoucherForm.tsx`
- `src/components/vouchers/EntryVoucherForm.tsx`

### 5. Terminology Discipline

- Use "Rapid Entry Mode", "Power User Shortcuts", "Recall", "Accept", "Status Bar"
- No code/UI strings referencing legacy desktop accounting product names
- Comments describe the *behavior* (e.g. "uncontrolled numeric input committed on blur"), not lineage

### Out of scope (ask if you want them)
- Persisting recall across page reloads (currently in-memory only)
- Undo of an enqueued save (separate feature)
- Animated transitions beyond Tailwind `transition-colors`