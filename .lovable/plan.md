## Why bugs keep slipping through

Right now, when I make a change I rely on:
- Type checks + the auto build
- Reading the code I just wrote

That catches syntax, imports, and shape mismatches — but it does **not** catch:
- "Works online, breaks offline" (because I never actually toggled offline)
- "Fix saves the voucher but UI still shows error" (because I never clicked Save twice)
- "Restore succeeds but reports show zero" (because I never opened the P&L after restore)
- "Lock screen AI button does nothing" (because I never clicked it post-fix)

In short: I've been verifying the *code path* I touched, not the *user journey* the bug lives in. That is the gap you're calling out, and it's fair.

## The fix — a mandatory verification protocol for every change

For every reported bug or behaviour change, before I report "fixed", I will run the **smallest end-to-end reproduction** of the original complaint using the in-sandbox browser (Playwright) against the live preview, and attach screenshot evidence.

### Standard verification matrix

| Change touches… | Must verify in actual run |
|---|---|
| Lock / login / signup | Open `/lock`, click each affected button, confirm navigation + console clean |
| Online ↔ offline sync | Toggle `navigator.onLine=false`, reload, open a company, open ledgers/items/vouchers, confirm rows render from cache |
| Voucher save / repair | Save a voucher, watch toast + failure counter, open Day Book + ledger + P&L + BS to confirm it appears everywhere — not just Day Book |
| Restore / backup | Restore a sample backup into a test company, then open BS **and** P&L, then verify totals tie |
| GST / HSN fetch | Enter a real GSTIN, watch network tab for 200, confirm address auto-fills the ledger form |
| Reports (BS / P&L / TB / Day Book) | Open each affected report and confirm rows + totals render, not just the one I "fixed" |
| Route / navigation | Navigate away and back, refresh hard, confirm "return-to-screen" actually returns |

If I can't reproduce in the sandbox (needs a real GSTIN, a real Windows build, a real signed-in cloud user that doesn't exist here), I will **say so explicitly** in the reply — "verified in code only, please retest" — instead of claiming it works.

### Reporting format I will use from now on

After every fix:

```
Fixed: <one-line summary>
Verified by: <Playwright run / build only / code only — pick one honestly>
Evidence: <screenshot path or "N/A — needs your retest because <reason>">
Known not-covered: <related screens I did NOT retest>
```

So you can immediately see whether something is "actually tested" or "patched and shipped to you to retest".

### Built-in regression checklist for this app

I'll keep and run this short smoke list whenever I touch anything in the offline / sync / restore / voucher / reports area, because those are the recurring pain points:

1. Lock screen loads, AI button opens `/assistant`, login works
2. Open a company → ledgers, items, vouchers, Day Book all show rows online
3. Toggle offline → same screens still show rows (from cache)
4. Create a payment voucher → appears in Day Book + ledger + P&L
5. Run "Repair / Verify Books" → completes without "Failed to fetch"
6. Open Restore dialog → company scope guard still shown

If any of those 6 break, the change is not done.

## Technical section

- Use the Playwright environment already available in the sandbox (`headless=True`, viewport 1280×1800, screenshots under `/tmp/browser/<slug>/`).
- For offline checks: `await context.set_offline(True)` after initial load, then re-navigate.
- For auth-gated screens: restore the managed Supabase session from `LOVABLE_BROWSER_SUPABASE_SESSION_JSON` before navigating into `/app/*`.
- Network and console logs captured per run via `page.on("console")` and `page.on("requestfailed")`, dumped to a log file alongside screenshots.
- Where a fix is in a route file, also `rg` for sibling routes doing the same anti-pattern (e.g. direct `supabase.from(...)` with no cache fallback) and list them in "Known not-covered" so you can decide whether to expand scope.

## What I need from you

Just confirm: **"yes, apply this protocol going forward"** and I'll start using it on the very next fix — including re-verifying the three I just shipped (lock-screen AI button, Verify Books offline, ledgers/items/vouchers offline fallback) by actually opening them in a headless browser and sending you screenshots.
