# Smart Accountant ("Your Mehtaji") — Full Technical & Functional Brief

> Purpose: a single hand-off document describing this application so another AI/engineer
> can work on it without reading the whole codebase. Everything below reflects the
> actual repository, not aspiration.

---

## 1. What the product is

An **offline-first, GST-ready double-entry accounting suite for Indian businesses**,
shipped primarily as a **Windows desktop app**. Multi-company books, full voucher
entry (sales/purchase/receipt/payment/journal/contra/notes/orders/manufacturing),
inventory, bank reconciliation, GST returns (GSTR-1 / 2B / 3B), statutory reports,
and an in-app AI assistant ("Mehtaji").

Key product philosophy:

- **Keyboard-first data entry.** Mouse optional. Enter = next field, ArrowLeft = previous,
  F6 = grid↔toolbar, Escape = staged exit, Alt-shortcuts for each voucher type.
- **Local-only data ownership.** All business data lives in IndexedDB on the user's
  machine, forever. Nothing accounting-related is pushed to our servers.
- **Indian compliance native**: paise-integer money, GSTIN/HSN/UQC validation,
  intra vs inter-state tax split, place of supply, MSME, presumptive taxation,
  ICAI Non-Corporate Entity (NCE) reporting shapes.
- **Never named-compare to other accounting products** (legal/licensing constraint).
  Describe behavior generically: "Indian accounting convention", "standard voucher flow".

---

## 2. Runtime targets

| Target | Stack | Notes |
|---|---|---|
| Primary | **Tauri v2** (Rust) + WebView2 | Windows 10/11, NSIS + MSI bundles, `com.smartaccountant.app` |
| Legacy | **Electron 22** (`electron-legacy/`) | Windows 7 / 32-bit support |
| Web | Vite dev / preview | **Gated**: browser build renders a demo landing only; `/app/*` is unreachable (see `WebGate` in `src/routes/__root.tsx`). Public exception: `/privacy` |

**Frozen desktop identity (never change — changing orphans user data):**
- `identifier = com.smartaccountant.app`
- WiX `upgradeCode = F7E5A1C2-4B6D-4C8A-9F2E-1A3B5C7D9E11`
- NSIS `deleteAppDataOnUninstall = false`
- WebView2 profile pinned to `<local_data_dir>/EBWebView` in `src-tauri/src/lib.rs`

---

## 3. Technology stack

**Frontend**
- React 19, TypeScript 5.8, Vite 7
- **TanStack Router** (file-based routes in `src/routes/`, generated `routeTree.gen.ts`)
- TanStack Query, TanStack Table, TanStack Virtual
- Tailwind CSS v4 + shadcn/ui (Radix primitives), `sonner` toasts, `lucide-react` icons
- `react-hook-form` + **Zod** schemas (`src/lib/schemas/`)
- Recharts for dashboards

**Local persistence**
- **Dexie / IndexedDB**, database `ym_offline_cache_v3` (`src/lib/offline/db.ts`)
- Optional native **SQLite** via `tauri-plugin-sql` (`src/brain/SqliteBrain.ts`, `src/utils/nativeDb.ts`)

**Documents / exports**
- `jspdf` + `jspdf-autotable` (data-driven PDFs — **no html2canvas**, it crashes on `oklch()` colors)
- `exceljs`, `xlsx`, `xlsx-js-style` for Excel/GSTR templates
- `jszip`, `fflate` for backups; `papaparse` CSV; `fast-xml-parser` for Tally/Busy-style XML import
- `pdfjs-dist` + `tesseract.js` for bank-statement/invoice OCR
- `qrcode` for NPCI-compliant dynamic UPI payment QR

**AI**
- On-device `@mlc-ai/web-llm` (WebLLM) + LSH vector index for retrieval
- Cloud fallback edge function `supabase/functions/ai-assistant` → Lovable AI Gateway
  (`google/gemini-3.1-flash-lite` default), with an app-knowledge system prompt and a
  known-error KB (`error-kb.ts`) appended only when runtime errors are attached.
- `supabase/functions/ai-ocr-invoice` for invoice OCR assist.

**Cloud (auth only)**
- Supabase (Lovable Cloud) is used for **authentication/profile only**, plus edge functions.
  Business data is never synced. `isLocalOnlyMode()` in `src/lib/local-only-mode.ts`
  (default `true`) short-circuits the sync worker, outbox drain, and snapshot pull.

**Testing**
- Vitest unit/integration (`src/test/**`) incl. stress tests at 10k and 100k vouchers,
  restore round-trips, invariants, GST math, numbering.
- Playwright e2e (`playwright/tests/**`): cold start, navigation, keyboard perf, report return-state.

---

## 4. Data model (IndexedDB, Dexie)

All tables are per-company (`company_id`) and carry `updated_at`, soft-delete `is_deleted`.
Money is **integer paise** everywhere (`*_paise`), never floats.

Core caches (`cache_*` prefix):
- `companies`, `cache_companies`, `cache_company_settings`
- `cache_ledgers`, `cache_items`
- `cache_account_subgroups`, `cache_ledger_group_mappings`, `cache_account_group_overrides`
- `cache_vouchers`, `cache_voucher_entries`, `cache_voucher_items`
- `cache_bill_allocations` (bill-wise adjustment), `cache_voucher_export_details`
- `cache_einvoice_details`, `einvoice_queue`
- `cache_period_locks` (FY / period locking)
- `cache_bom_templates`, `cache_bom_template_lines` (manufacturing BOM)
- `cache_recurring_invoices`
- `cache_voucher_series`, `cache_tax_templates`, `cache_bill_sundries`, `cache_transport_details`
- `cache_cost_centres`, `cache_cost_categories`
- `cache_bank_statements`, `cache_bank_statement_lines` (bank recon, never synced)
- `cache_gstr2b_imports`, `cache_gstr2b_lines` (GSTR-2B recon, never synced)

Infrastructure tables: `outbox`, `dead_letter`, `sync_cursors`, `account_creds`, `meta`, `activity_log`.

**Progressive disclosure rule:** pickers for series / tax templates / cost centres only render
when more than one row exists for the company; a single row auto-applies silently.

---

## 5. Accounting engine rules

- **Double entry enforced**: `entryVoucherSchema` requires ≥2 lines, Dr total == Cr total,
  ≥2 distinct ledgers, each line strictly Debit XOR Credit.
- **Item vouchers**: subtotal must equal Σ line `taxable_paise` (±1 paise), party required,
  and tax mode is exclusive — interstate ⇒ IGST only, intra-state ⇒ CGST+SGST only.
- Voucher date cannot be more than 2 days in the future.
- **Voucher header field order is fixed**: Date → Party → Reference No → Place of Supply.
- **Manufacturing Journal** posts: Dr Finished Goods / Cr Raw Materials (auto-created under
  `STOCK_IN_HAND`) for total consumption value, plus inventory moves via `voucher_items`.
- Postings/derivations live in `voucher-postings.ts`, `voucher-resolver.ts`,
  `voucher-invariants.ts`, `voucher-numbering.ts`, `doc-linking.ts` (sales-cycle carry-forward:
  Quotation → Sales Order → Delivery Note → Invoice).
- Ledger master (`schemas/ledger.ts`) carries GSTIN, PAN, state code, GST registration type
  (regular/composition/unregistered/consumer/SEZ/overseas/UIN), credit limit/days,
  MSME registration + Udyam no + classification (micro/small/medium).

Voucher types: `receipt, payment, journal, contra` (entry) and
`sales, purchase, credit_note, debit_note, sales_order, delivery_note, quotation` (item),
plus manufacturing.

---

## 6. Reports (`src/routes/app.reports.*`)

Day Book, Ledger, Group Ledger, Trial Balance, Profit & Loss, Balance Sheet, Trading,
Receipts & Payments, Cash/Bank, BRS, Ageing, Outstanding, Receivables, Payables,
Sales Register, Purchase Register, Stock Summary, HSN Summary, Cost Centre,
ITC Party-wise, ITC Item-wise, GST Sales/Purchase Book, GSTR-1, GSTR-2B, GSTR-3B,
Tax Audit, Presumptive, Activity Log.

Conventions:
- **Three-line report header**: line 1 = client/company name (+ address line),
  line 2 = report name, line 3 = financial year (`FY 2025-26` format).
- `ReportViewer.tsx` handles view + print preview. Print preview uses a **deep `cloneNode(true)`**
  with inputs/selects flattened to static text and styles inlined, opened via a **Blob URL**
  (Tauri blocks `document.write()`), with `window.print()` fallback and a
  `REPORT_PREVIEW_FAILED` diagnostic log.
- Drill-down preserves history state via `src/lib/report-url-state.ts`.
- Grid: `src/components/data-grid/` (virtualized grid, column filters, pivot engine, worker aggregation).

---

## 7. Keyboard architecture (`src/lib/keyboard/`)

Central engine: `KeyboardProvider`, `useShortcut`, `useFormEnterNav`, `useFocusScope`,
`useAutoFocusRestore`, `shortcuts.ts`. See `docs/KEYBOARD_ARCHITECTURE.md`.

- `Enter` → next field, `ArrowLeft` → previous field, `F6` → grid ↔ toolbar
- `Ctrl+S` save · `Ctrl+/` cheat sheet · `Ctrl+Alt+C` calculator
- `Alt+E` top menu · `Alt+N` Mehtaji menu
- `Alt+Y` Payment · `Alt+R` Receipt · `Alt+S` Sales · `Alt+P` Purchase · `Alt+J` Journal
- **Escape is a staged state machine** (in `src/routes/app.tsx`):
  field → dialog → menu → app-exit confirmation dialog.
- Menus are `role="menubar"` (Radix Menubar) with roving tabIndex, active-descendant
  tracking, focus trap in open dropdowns, and focus return to the trigger.

Top menu: **Mehtaji · Masters · Transactions · Reports · Utilities · Settings · Help**,
plus company switcher and Backup (B) / Restore (R) medallions.

---

## 8. Backup, restore & data safety

- Snapshots at `%LOCALAPPDATA%\com.smartaccountant.app\snapshots\`; backups in `\backups\`.
- Backup schema **v2** with SHA-256 checksums; inspection UI (`BackupInspectDialog`).
- **Auto-restore on launch is silent** (`src/lib/auto-restore.ts`): if the manifest shows
  N>0 rows and live IndexedDB is empty/shrunk, restore the newest valid snapshot without
  prompting — toast only.
- **Auto-snapshot must never overwrite a non-empty snapshot with an empty one** on the same
  day (`src/lib/auto-snapshot.ts`).
- **Local data is permanent.** No prune/rotate/TTL against local snapshots or backups ever.
  Retention constants in `backup-policy.ts` are recommendations for offsite copies only.
  The only exception is the 24h pre-restore undo buffer in `restore-safety.ts` (IndexedDB `meta`).
- Cloud backup is **opt-in, to the user's own Google Drive / OneDrive / Dropbox**
  (`cloud-providers.ts`, `user-cloud-backup.ts`) — never our servers.
- Recovery: `RecoveryWizard`, `UpdateRecoveryBanner`, `RestoreInterruptedBanner`,
  `integrity.ts`, `snapshot-diagnostics.ts`, crash ring buffer in `crash-log.ts`.

---

## 9. Utilities / Housekeeping

Tally/Busy-style XML & CSV import, opening balance & opening stock import, ledger mapping,
merge companies, delete company, financial-year transfer wizard, year-end closure and lock,
import history, self-test panel, data-health field integrity panel, diagnostics flow stages.

---

## 10. Sharing & documents

- **Invoice PDF / Ledger PDF** generated with jsPDF + autoTable directly from data arrays
  (T-format ledger: Date / Particulars / Debit / Credit, opening row, transactions, closing row,
  opening+closing summary footer; 138mm table, light-grey header `[240,240,240]`, no currency glyph).
- **WhatsApp share** (`whatsapp-shared.ts`, `whatsapp-invoice.ts`, `whatsapp-ledger.ts`):
  a native Rust command `copy_files_to_clipboard` (crate `clipboard-win`) places the PDF on the
  Windows clipboard as a real **CF_HDROP file reference**, so Ctrl+V pastes an attachment, not a
  bitmap. Clipboard copy is decoupled from the phone-number lookup so Ctrl+V works even when the
  recipient is chosen manually. Failures raise a dialog + `WHATSAPP_CLIPBOARD_FAILED` log.
- Tauri `fs:scope` in `src-tauri/capabilities/default.json` includes `$TEMP`; clipboard-manager
  permissions enabled.
- Export root selection: `short-data-root.ts` skips a missing `D:` and falls back to `C:`/Home.

---

## 11. Internationalisation & formatting

- `src/lib/i18n.tsx` — English, Hindi, Gujarati, Marathi, Bengali. Gujarati PDF font
  `public/assets/fonts/NotoSansGujarati-Bold.ttf` (`pdf-fonts.ts`).
- Currency provider, date-format provider (Indian conventions), `money.ts` paise helpers.
- Master names (party/ledger/item) are auto **Title Cased** on input (`text-case.ts`).

---

## 12. Security & licensing

- Staff PIN / lock screen (`staff-session.ts`, `routes/lock.tsx`), `LockGate` in `__root.tsx`;
  lock-exempt paths: `/lock`, `/assistant`, `/welcome`, `/privacy`.
- Local device profile for local-first users (`local-device-profile.ts`) — no forced sign-in.
- Ed25519 offline licence verification (`@noble/ed25519`, `src/lib/license/`,
  minting tool in `tools/license-mint/`).
- bcryptjs for cached credential hashes.
- Supabase RLS applies to the (auth-only) cloud tables; roles must always live in a separate
  `user_roles` table with a `has_role()` security-definer function — never on profiles.

---

## 13. Known constraints & gotchas (read before changing anything)

1. Never rename/alter the Tauri identity values in §2.
2. Never add auto-deletion/rotation of local backups or snapshots.
3. Never re-introduce automatic server sync of business data.
4. Never use `html2canvas`/`html2pdf` — modern `oklch()` CSS tokens crash it. Use jsPDF data APIs.
5. Never hardcode Tailwind color literals in components; use semantic design tokens.
6. Never compare the product to other named accounting software in code, docs or UI copy.
7. Print preview must not use `document.write()` inside Tauri — use a Blob URL.
8. `src/integrations/supabase/client.ts`, `types.ts`, `.env`, `supabase/config.toml` are
   auto-generated — do not edit.
9. Money must stay integer paise end-to-end; no floating point in postings.
10. Restore at ~100k vouchers takes ~90s — a known scale ceiling; reads scale linearly.

---

## 14. Repo map (short)

```
src/routes/            TanStack file routes (app.*, reports.*, vouchers.new.*)
src/components/        UI: vouchers/, reports/, data-grid/, housekeeping/, bank/, settings/, assistant/
src/lib/               Domain logic: gst, vouchers, backup, keyboard/, offline/, ai/, license/, recovery/
src/lib/schemas/       Zod validation (voucher, ledger, common)
src/brain/             Perf/error/command "brains" + SQLite bridge
src/test/              Vitest suites incl. stress + invariants
playwright/tests/      E2E
src-tauri/             Rust shell, capabilities, bundle config
electron-legacy/       Win7/32-bit shell
supabase/functions/    ai-assistant, ai-ocr-invoice, setu-gstin-proxy
docs/                  KEYBOARD_ARCHITECTURE, RELEASE_CHECKLIST, DEVICE_SMOKE_CHECKLIST, BUILD_WINDOWS
```

## 15. Build commands

```
bun run dev            # web dev server
bun run test           # vitest
bun run test:e2e       # playwright
bun run tauri:build    # Windows NSIS + MSI
bun run build:store    # Store bundles
```
