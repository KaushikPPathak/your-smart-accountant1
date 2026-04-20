

# Your Mehtaji — Phase 1 Plan

A modern web-based accounting app (with a Windows desktop build) inspired by Busy. Hybrid UI: clean modern visuals + Busy-style keyboard shortcuts and dense data grids for fast entry.

## Phase 1 Scope

**Multi-company, multi-user accounting workspace** with:

### 1. Auth & Companies
- Email/password login (Lovable Cloud)
- User roles: **Admin, Accountant, Viewer** (stored in `user_roles` table)
- **Multi-company**: create companies, switch via top-bar company picker; all data scoped per-company
- Invite team members to a company with a role

### 2. Masters
- **Ledgers / Parties** (customers, suppliers, expense heads) with GSTIN, address, opening balance
- **Items / Stock** with HSN code, unit, GST rate, opening stock & rate
- **Tax rates** (GST 0/5/12/18/28 + custom)

### 3. Vouchers (data entry, keyboard-first)
- **Sales Invoice** (with item lines, auto CGST/SGST/IGST split based on party state)
- **Purchase Invoice**
- **Receipt, Payment, Journal, Contra**
- **Credit Note / Debit Note**
- Auto voucher numbering per company per type
- Hotkeys: `Alt+S` Sales, `Alt+P` Purchase, `Alt+R` Receipt, `Alt+J` Journal, `F2` date, `Ctrl+S` save, `Esc` cancel

### 4. Inventory
- Auto stock in/out from purchase/sales
- Stock summary, item movement, low-stock view

### 5. Reports
- **Day Book**, **Ledger statement**, **Trial Balance**
- **Profit & Loss**, **Balance Sheet**
- **GSTR-1 summary** (outward supplies) & **GSTR-3B summary**
- **Stock Summary**
- Date-range filter, export to CSV/Excel, print-friendly view

### 6. Invoice printing
- A4 GST-compliant tax invoice template with company logo, HSN, tax breakup, amount in words

## UX

- Left collapsible sidebar (Dashboard, Masters, Vouchers, Reports, Settings)
- Top bar: company switcher, financial-year selector, global search (`Ctrl+K`), user menu
- Dashboard: cash/bank balance, receivables, payables, sales this month, top items, recent vouchers
- Voucher entry: dense tabular grid, Tab navigation, inline party/item lookup
- Light + dark theme

## Delivery

1. **Web app first** — fully working at your Lovable URL, multi-user, multi-company
2. **Windows desktop build** — once web is stable, package the same app via Electron as a portable Windows folder you can run (`.exe` inside). For a signed installer, you'd run one final command on a Windows PC — I'll provide instructions.

## Out of scope for Phase 1 (can add later)
Payroll, e-invoice/IRN integration, bank reconciliation import, barcode scanning, mobile app, actual GSTR JSON filing upload, manufacturing/BOM, branch transfers.

## Tech notes
- Lovable Cloud (Postgres + Auth) with Row-Level Security so each company's data is isolated
- Roles in a separate `user_roles` table (security best practice)
- All money stored as integers (paise) to avoid float errors
- Numbers in Indian format (₹ 1,23,456.00)

Click **Implement plan** to start building Phase 1.

