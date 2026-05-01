// Offline knowledge base for the in-app AI Assistant.
// Pure data — no network calls. Edit freely as the app grows.

export type ActionKind = "navigate" | "set-theme" | "set-language";

export interface AssistantAction {
  kind: ActionKind;
  label: string;
  // For "navigate"
  to?: string;
  // For "set-theme"
  theme?: "light" | "dark";
  // For "set-language"
  lang?: string;
}

export interface KbEntry {
  id: string;
  // Short human title
  title: string;
  // Search aliases / keywords (lowercase). Add many — the matcher uses tokens + fuzzy.
  keywords: string[];
  // Markdown-friendly answer body
  answer: string;
  // Optional contextual actions the user can run with one click
  actions?: AssistantAction[];
  // Tag used for grouping in the "Browse topics" panel
  category:
    | "Getting started"
    | "Vouchers"
    | "Masters"
    | "Reports"
    | "GST"
    | "Housekeeping"
    | "Settings"
    | "Tally / Busy Import";
}

export const ASSISTANT_KB: KbEntry[] = [
  // ---------- Getting started ----------
  {
    id: "create-company",
    title: "Create a new company",
    category: "Getting started",
    keywords: [
      "create company", "new company", "add company", "start company",
      "first company", "register firm", "new firm", "open company",
    ],
    answer:
      "Open **Companies** from the sidebar and click **+ New company**. Fill in name, GSTIN (optional) and state. After saving, switch to it from the company picker in the top bar.",
    actions: [{ kind: "navigate", label: "Open Companies", to: "/app/companies" }],
  },
  {
    id: "switch-company",
    title: "Switch between companies",
    category: "Getting started",
    keywords: ["switch company", "change company", "another company", "company picker"],
    answer:
      "Use the **Company switcher** in the top header (next to the sidebar trigger). Locked companies will ask for a password.",
  },
  {
    id: "lock-workspace",
    title: "Lock the workspace",
    category: "Getting started",
    keywords: ["lock", "logout", "sign out", "secure", "password lock"],
    answer:
      "Click the **Lock** button in the top-right header. You will be returned to the company picker and a password will be required to re-enter the company.",
  },

  // ---------- Vouchers ----------
  {
    id: "new-sales",
    title: "Create a Sales invoice",
    category: "Vouchers",
    keywords: ["sales", "invoice", "bill", "tax invoice", "new sales", "create invoice", "sell"],
    answer:
      "Sidebar → **Transactions → New Sales**, or press **Alt+S** anywhere in the app. Pick a party, add items, GST is computed automatically when the company is GST-registered.",
    actions: [{ kind: "navigate", label: "New Sales", to: "/app/vouchers/new/sales" }],
  },
  {
    id: "new-purchase",
    title: "Record a Purchase",
    category: "Vouchers",
    keywords: ["purchase", "buy", "purchase bill", "vendor bill", "new purchase"],
    answer:
      "Sidebar → **Transactions → New Purchase**, or hotkey **Alt+P**. Choose the supplier ledger and add items or expense ledgers.",
    actions: [{ kind: "navigate", label: "New Purchase", to: "/app/vouchers/new/purchase" }],
  },
  {
    id: "receipt-payment",
    title: "Receipt and Payment vouchers",
    category: "Vouchers",
    keywords: ["receipt", "payment", "received money", "paid", "alt+r", "alt+y"],
    answer:
      "**Receipt** = money in (Alt+R). **Payment** = money out (Alt+Y). Pick the bank/cash ledger and the party. You can allocate against pending bills.",
    actions: [
      { kind: "navigate", label: "New Receipt", to: "/app/vouchers/new/receipt" },
      { kind: "navigate", label: "New Payment", to: "/app/vouchers/new/payment" },
    ],
  },
  {
    id: "journal",
    title: "Pass a Journal entry",
    category: "Vouchers",
    keywords: ["journal", "adjustment", "debit credit", "manual entry", "alt+j"],
    answer:
      "Sidebar → **Transactions → Journal** (Alt+J). Use this for non-cash adjustments like depreciation, provisions or reclassifications.",
    actions: [{ kind: "navigate", label: "New Journal", to: "/app/vouchers/new/journal" }],
  },
  {
    id: "credit-debit-note",
    title: "Credit Note / Debit Note",
    category: "Vouchers",
    keywords: ["credit note", "debit note", "return", "sales return", "purchase return", "alt+c", "alt+d"],
    answer:
      "Use **Credit Note (Alt+C)** for sales returns or rate adjustments to customers, and **Debit Note (Alt+D)** for purchase returns or supplier adjustments. They flow into GSTR-1 / GSTR-2B amendments.",
    actions: [
      { kind: "navigate", label: "New Credit Note", to: "/app/vouchers/new/credit_note" },
      { kind: "navigate", label: "New Debit Note", to: "/app/vouchers/new/debit_note" },
    ],
  },

  // ---------- Masters ----------
  {
    id: "ledgers",
    title: "Ledgers and parties",
    category: "Masters",
    keywords: ["ledger", "party", "customer", "supplier", "vendor", "account", "create ledger"],
    answer:
      "Sidebar → **Administration → Ledgers / Parties**. Customers map to *Sundry Debtors*, suppliers to *Sundry Creditors*. Set GSTIN for parties to enable GST computation on their invoices.",
    actions: [{ kind: "navigate", label: "Open Ledgers", to: "/app/ledgers" }],
  },
  {
    id: "items",
    title: "Items and stock",
    category: "Masters",
    keywords: ["item", "stock", "inventory", "product", "hsn", "sku", "unit"],
    answer:
      "Sidebar → **Administration → Items / Stock**. Each item carries an HSN/SAC code, GST rate and unit. Inventory must be enabled for the company in Company Settings.",
    actions: [{ kind: "navigate", label: "Open Items", to: "/app/items" }],
  },
  {
    id: "recurring",
    title: "Recurring invoices",
    category: "Masters",
    keywords: ["recurring", "subscription", "auto invoice", "monthly invoice"],
    answer:
      "Sidebar → **Administration → Recurring Invoices**. Define a template, frequency and next-run date. The system will queue invoices for you to confirm.",
    actions: [{ kind: "navigate", label: "Recurring", to: "/app/recurring" }],
  },

  // ---------- Reports ----------
  {
    id: "day-book",
    title: "Day Book",
    category: "Reports",
    keywords: ["day book", "daybook", "today entries", "voucher list"],
    answer:
      "Day Book lists every voucher for a date range. Use it for an end-of-day audit. Reports → **Day Book**.",
    actions: [{ kind: "navigate", label: "Open Day Book", to: "/app/reports/day-book" }],
  },
  {
    id: "ledger-statement",
    title: "Ledger Statement",
    category: "Reports",
    keywords: ["ledger statement", "account statement", "party statement", "balance"],
    answer:
      "Per-ledger transaction list with running balance. Reports → **Ledger Statement**. Export to PDF/Excel from the toolbar.",
    actions: [{ kind: "navigate", label: "Ledger Statement", to: "/app/reports/ledger" }],
  },
  {
    id: "trial-balance",
    title: "Trial Balance",
    category: "Reports",
    keywords: ["trial balance", "tb", "balances", "verify books"],
    answer:
      "Reports → **Trial Balance**. Shows debit/credit totals for each ledger; both columns must match.",
    actions: [{ kind: "navigate", label: "Trial Balance", to: "/app/reports/trial-balance" }],
  },
  {
    id: "pl-bs",
    title: "P&L and Balance Sheet",
    category: "Reports",
    keywords: ["p&l", "pnl", "profit loss", "balance sheet", "bs", "financials"],
    answer:
      "Reports → **Profit & Loss** for income/expenses; **Balance Sheet** for assets/liabilities. Both support comparative periods.",
    actions: [
      { kind: "navigate", label: "Profit & Loss", to: "/app/reports/profit-loss" },
      { kind: "navigate", label: "Balance Sheet", to: "/app/reports/balance-sheet" },
    ],
  },
  {
    id: "outstanding",
    title: "Outstanding receivables / payables",
    category: "Reports",
    keywords: ["outstanding", "receivables", "payables", "ageing", "aging", "due", "overdue"],
    answer:
      "Reports → **Outstanding** for bill-wise dues. **Ageing** report buckets them by 0-30 / 31-60 / 60+ days.",
    actions: [
      { kind: "navigate", label: "Outstanding", to: "/app/reports/outstanding" },
      { kind: "navigate", label: "Ageing", to: "/app/reports/ageing" },
    ],
  },

  // ---------- GST ----------
  {
    id: "gstr1",
    title: "File GSTR-1",
    category: "GST",
    keywords: ["gstr1", "gstr-1", "outward supplies", "sales return gst"],
    answer:
      "Reports → **GSTR-1**. Generate the JSON for the GST portal or export the offline-utility template. Make sure all sales invoices have HSN, place of supply and the party's GSTIN where applicable.",
    actions: [{ kind: "navigate", label: "GSTR-1", to: "/app/reports/gstr1" }],
  },
  {
    id: "gstr3b",
    title: "GSTR-3B summary",
    category: "GST",
    keywords: ["gstr3b", "gstr-3b", "monthly summary", "tax payment"],
    answer:
      "Reports → **GSTR-3B**. The summary auto-fills from posted sales/purchase vouchers. Reconcile with GSTR-2B before paying.",
    actions: [{ kind: "navigate", label: "GSTR-3B", to: "/app/reports/gstr3b" }],
  },
  {
    id: "gstr2b",
    title: "Match GSTR-2B (ITC)",
    category: "GST",
    keywords: ["gstr2b", "gstr-2b", "itc", "input credit", "match purchases"],
    answer:
      "Reports → **GSTR-2B**. Upload the JSON downloaded from the GST portal — the system matches it against your purchase vouchers and flags mismatches.",
    actions: [{ kind: "navigate", label: "GSTR-2B", to: "/app/reports/gstr2b" }],
  },
  {
    id: "einvoice",
    title: "E-Invoice and E-Way Bill",
    category: "GST",
    keywords: ["e-invoice", "einvoice", "irn", "qr", "eway", "e-way bill", "ewb"],
    answer:
      "Sidebar → **Housekeeping → E-Invoice / EWB**. Configure Setu credentials in Settings first. From a sales invoice you can generate IRN + EWB in one click.",
    actions: [
      { kind: "navigate", label: "E-Invoice / EWB", to: "/app/einvoice" },
      { kind: "navigate", label: "Setu Settings", to: "/app/settings" },
    ],
  },

  // ---------- Housekeeping ----------
  {
    id: "tally-import",
    title: "Import from Tally / Busy",
    category: "Tally / Busy Import",
    keywords: [
      "tally", "busy", "import", "xml", "master", "ledger import", "migrate",
      "import xml", "tally xml", "busy xml",
    ],
    answer:
      "Open **Housekeeping → Accounting Tools** and use the **Tally / Busy Import** card. For very large XML files (>50 MB) open the **Import settings** panel first to raise the chunk size and pick the right encoding (UTF-16LE is common for Tally).",
    actions: [{ kind: "navigate", label: "Open Import", to: "/app/housekeeping" }],
  },
  {
    id: "ledger-mapping",
    title: "Map Tally/Busy ledgers to groups",
    category: "Tally / Busy Import",
    keywords: ["ledger mapping", "group mapping", "fuzzy match", "ledger group", "auto match"],
    answer:
      "After parsing a Tally/Busy file, the **Ledger Mapping** panel appears. Toggle **Fuzzy match** and click **Auto-match all** to apply both exact and similar-name matches. Use **Save all as future defaults** so the next import is fully automatic.",
    actions: [{ kind: "navigate", label: "Open Import", to: "/app/housekeeping" }],
  },
  {
    id: "backup-restore",
    title: "Backup and Restore",
    category: "Housekeeping",
    keywords: ["backup", "restore", "export data", "download backup", "company backup"],
    answer:
      "Settings → **Backup / Restore**. *Export this company* downloads a single JSON; *Export all companies* downloads everything you can access. Restore lets you optionally wipe the target company before importing.",
    actions: [{ kind: "navigate", label: "Open Settings", to: "/app/settings" }],
  },
  {
    id: "bank-recon",
    title: "Bank Reconciliation / BRS",
    category: "Housekeeping",
    keywords: ["bank", "reconciliation", "brs", "statement", "pdf import", "ocr"],
    answer:
      "Sidebar → **Housekeeping → Bank Reconciliation**. Upload a bank statement PDF/CSV (OCR supported) and tick off matched entries. The **BRS** report compares book vs bank.",
    actions: [
      { kind: "navigate", label: "Bank Recon", to: "/app/bank" },
      { kind: "navigate", label: "BRS Report", to: "/app/reports/brs" },
    ],
  },

  // ---------- Settings ----------
  {
    id: "theme",
    title: "Switch dark / light theme",
    category: "Settings",
    keywords: ["dark mode", "light mode", "theme", "appearance", "night mode"],
    answer:
      "Use the buttons below to toggle. The choice is stored locally on this device.",
    actions: [
      { kind: "set-theme", label: "Switch to dark", theme: "dark" },
      { kind: "set-theme", label: "Switch to light", theme: "light" },
    ],
  },
  {
    id: "language",
    title: "Change interface language",
    category: "Settings",
    keywords: ["language", "hindi", "gujarati", "marathi", "tamil", "telugu", "kannada", "bangla", "bengali", "malayalam"],
    answer:
      "Use the language switcher in the top header, or pick one below.",
    actions: [
      { kind: "set-language", label: "English", lang: "en" },
      { kind: "set-language", label: "हिन्दी", lang: "hi" },
      { kind: "set-language", label: "ગુજરાતી", lang: "gu" },
      { kind: "set-language", label: "मराठी", lang: "mr" },
      { kind: "set-language", label: "தமிழ்", lang: "ta" },
    ],
  },
  {
    id: "invoice-settings",
    title: "Invoice prefix, footer & terms",
    category: "Settings",
    keywords: ["invoice prefix", "starting number", "footer", "terms", "invoice settings"],
    answer:
      "Settings → **Invoice settings**. Set the prefix (e.g. INV/24-25/), starting number, footer note and default terms & conditions.",
    actions: [{ kind: "navigate", label: "Open Settings", to: "/app/settings" }],
  },
  {
    id: "team-roles",
    title: "Invite team members",
    category: "Settings",
    keywords: ["team", "users", "invite", "member", "role", "admin", "accountant", "viewer"],
    answer:
      "Settings → **Team**. Roles: **admin** (full), **accountant** (vouchers + reports, no settings), **viewer** (read-only).",
    actions: [{ kind: "navigate", label: "Open Settings", to: "/app/settings" }],
  },
  {
    id: "setu-gst-api",
    title: "Setu / GSTN API credentials",
    category: "Settings",
    keywords: ["setu", "gstn", "api key", "api credentials", "e-invoice api", "irn api"],
    answer:
      "Settings → **Setu / GST API**. Pick sandbox or production, paste the Client ID + Secret and your GSTN username. These power E-Invoice and E-Way Bill generation.",
    actions: [{ kind: "navigate", label: "Open Settings", to: "/app/settings" }],
  },
  {
    id: "hotkeys",
    title: "Keyboard hotkeys",
    category: "Getting started",
    keywords: ["hotkey", "shortcut", "keyboard", "alt key"],
    answer:
      "Hold **Alt** + a letter anywhere in the app:\n\n- **S** Sales\n- **P** Purchase\n- **R** Receipt\n- **Y** Payment\n- **C** Credit Note\n- **D** Debit Note\n- **J** Journal",
  },
];

export const KB_CATEGORIES = Array.from(
  new Set(ASSISTANT_KB.map((e) => e.category)),
) as KbEntry["category"][];
