## Goal
Apply a consistent golden-themed design system across all pages by updating semantic tokens in `src/styles.css`, then auditing components to ensure they consume tokens (no hardcoded colors).

## Palette (Golden)
- Primary: rich gold `oklch(0.78 0.15 85)` (~#E0B53C)
- Primary deep (sidebar/headers): warm bronze `oklch(0.35 0.06 70)` (~#5C4A2A)
- Accent CTA: amber-gold `oklch(0.72 0.17 70)` (~#D99A2B)
- Background: warm ivory `oklch(0.985 0.008 85)`
- Foreground: deep espresso `oklch(0.22 0.02 70)`
- Muted/border: soft champagne tints
- Dark mode: charcoal bg with gold primary preserved

## Changes

### 1. `src/styles.css` — single source of truth
- Replace `:root` and `.dark` token values (teal/amber → gold/bronze) for: `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--accent`, `--muted`, `--border`, `--ring`, `--card`, `--popover`, plus sidebar tokens (`--sidebar-background`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`).
- Update brand gradient (`--gradient-primary`) and elegant shadow (`--shadow-elegant`) to derive from gold.
- Keep semantic names identical — no component refactor needed for token-using code.

### 2. Typography tokens (consistency pass)
- Add `--font-display` and `--font-sans` in `@theme` (Fraunces for headings, Inter for body) and load via `<link>` in `src/routes/__root.tsx`.
- Apply `font-display` on h1–h3 via a base rule in `styles.css`.

### 3. Button consistency
- Verify `src/components/ui/button.tsx` variants (`default`, `secondary`, `outline`, `ghost`, `destructive`) all resolve through tokens — no edits if already token-based; if any hardcoded class found, swap to tokens.

### 4. Hardcoded color audit (UI-only sweep)
- Ripgrep for `bg-white`, `text-black`, `bg-slate-`, `text-teal-`, `bg-amber-`, `#` hex literals inside `src/components/**` and `src/routes/**`.
- Replace stragglers with semantic tokens (`bg-card`, `text-foreground`, `bg-primary`, etc.). Limited to presentation; no logic/schema changes.

### 5. Sidebar + headers
- Ensure `AppSidebar.tsx` uses `bg-sidebar text-sidebar-foreground` and active state uses `bg-sidebar-accent` — adjust only if it currently hardcodes teal/amber classes left over from the previous repaint.

## Out of scope
- No business logic, schema, voucher, or sync changes.
- No new components or routes.
- Dark mode tuned but not redesigned.

## Verification
- Build passes.
- Playwright screenshot of `/app`, `/app/vouchers/new/purchase`, `/app/reports` confirming gold primary, bronze sidebar, ivory background, consistent button styling.
