// Non-destructive mock data used by the AI test harness.
// All rows use the TEST_COMPANY_ID so real books stay untouched — the harness
// deletes anything it writes on teardown.

export const TEST_COMPANY_ID = "__ai_test_company__";

export interface MockLedger {
  id: string;
  company_id: string;
  name: string;
  type: string;
  is_active: boolean;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  updated_at: string;
}

export interface MockItem {
  id: string;
  company_id: string;
  name: string;
  unit: string;
  gst_rate: number;
  is_active: boolean;
  updated_at: string;
}

export interface MockVoucher {
  id: string;
  company_id: string;
  voucher_type: string;
  voucher_number: string;
  voucher_date: string;
  narration?: string;
  updated_at: string;
}

export interface MockVoucherEntry {
  id: string;
  company_id: string;
  voucher_id: string;
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  updated_at: string;
}

const NOW = new Date().toISOString();

export const MOCK_LEDGERS: MockLedger[] = [
  { id: "tst-l-cash",   company_id: TEST_COMPANY_ID, name: "Cash",             type: "cash",           is_active: true, updated_at: NOW },
  { id: "tst-l-hdfc",   company_id: TEST_COMPANY_ID, name: "HDFC Bank",        type: "bank",           is_active: true, updated_at: NOW },
  { id: "tst-l-sales",  company_id: TEST_COMPANY_ID, name: "Sales A/c",        type: "income_direct",  is_active: true, updated_at: NOW },
  { id: "tst-l-rent",   company_id: TEST_COMPANY_ID, name: "Rent Expense",     type: "expense_indirect", is_active: true, updated_at: NOW },
  {
    id: "tst-l-ramesh", company_id: TEST_COMPANY_ID, name: "Ramesh & Co",
    type: "sundry_debtor", is_active: true,
    gstin: "27AAAPL1234C1ZV", pan: "AAAPL1234C",
    phone: "9876543210", email: "ramesh@example.com",
    updated_at: NOW,
  },
];

export const MOCK_ITEMS: MockItem[] = [
  { id: "tst-i-widget", company_id: TEST_COMPANY_ID, name: "Widget A", unit: "PCS", gst_rate: 18, is_active: true, updated_at: NOW },
  { id: "tst-i-gizmo",  company_id: TEST_COMPANY_ID, name: "Gizmo B",  unit: "KG",  gst_rate: 12, is_active: true, updated_at: NOW },
];

export const MOCK_VOUCHERS: MockVoucher[] = [
  {
    id: "tst-v-1", company_id: TEST_COMPANY_ID, voucher_type: "receipt",
    voucher_number: "R-001", voucher_date: "2026-03-15",
    narration: "Received from Ramesh — contact ramesh@example.com / 9876543210",
    updated_at: NOW,
  },
  {
    id: "tst-v-2", company_id: TEST_COMPANY_ID, voucher_type: "payment",
    voucher_number: "P-001", voucher_date: "2026-03-20",
    narration: "Rent paid via HDFC A/c 123456789012",
    updated_at: NOW,
  },
];

export const MOCK_VOUCHER_ENTRIES: MockVoucherEntry[] = [
  { id: "tst-e-1a", company_id: TEST_COMPANY_ID, voucher_id: "tst-v-1", ledger_id: "tst-l-cash",   debit_paise: 500000, credit_paise: 0,       updated_at: NOW },
  { id: "tst-e-1b", company_id: TEST_COMPANY_ID, voucher_id: "tst-v-1", ledger_id: "tst-l-ramesh", debit_paise: 0,      credit_paise: 500000,  updated_at: NOW },
  { id: "tst-e-2a", company_id: TEST_COMPANY_ID, voucher_id: "tst-v-2", ledger_id: "tst-l-rent",   debit_paise: 1200000, credit_paise: 0,      updated_at: NOW },
  { id: "tst-e-2b", company_id: TEST_COMPANY_ID, voucher_id: "tst-v-2", ledger_id: "tst-l-hdfc",   debit_paise: 0,      credit_paise: 1200000, updated_at: NOW },
];

// Fixture queries + expected intents for the router test.
export const ROUTER_FIXTURES: Array<{ q: string; intent: string }> = [
  { q: "what is the trial balance as on 31-03-2026", intent: "trial_balance" },
  { q: "profit and loss for this month",             intent: "profit_loss"   },
  { q: "cash balance today",                         intent: "cash_bank"     },
  { q: "ageing of receivables over 90 days",         intent: "ageing"        },
  { q: "gstr-1 summary for march",                   intent: "gst_query"     },
  { q: "show invoice SI-1023",                       intent: "voucher_lookup"},
  { q: "sales in march 2026",                        intent: "date_range_report" },
  { q: "closing stock",                              intent: "stock_query"   },
  { q: "balance of Ramesh",                          intent: "party_balance" },
  { q: "ledger of Ramesh",                           intent: "party_ledger"  },
];

// Text expected to be scrubbed by the PII redactor.
export const PII_SAMPLE = [
  "GSTIN 27AAAPL1234C1ZV",
  "PAN AAAPL1234C",
  "call 9876543210 or +91 9812345678",
  "mail ramesh@example.com",
  "bank a/c 123456789012",
].join(" | ");
