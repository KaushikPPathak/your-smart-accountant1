// Phase F — Explain-and-teach mode.
//
// Two kinds of provenance are attached to an assistant answer:
//   1. Data sources  — which local screens / tools the numbers came from.
//   2. Law citations — the statutory reference behind the rule being applied,
//      so the user can verify the advice instead of trusting it blindly.
//
// Everything is a static local table: no network, no model call, works offline
// on the Windows 7 build.

export interface LawCitation {
  id: string;
  /** e.g. "CGST Act, 2017 — s.16(2)" */
  ref: string;
  title: string;
  /** One-line plain-language explanation. */
  gist: string;
}

export interface DataSource {
  label: string;
  /** In-app route the user can open to verify. */
  to?: string;
}

const LAW: (LawCitation & { keywords: string[] })[] = [
  {
    id: "itc-conditions",
    ref: "CGST Act, 2017 — s.16(2)",
    title: "Conditions for taking input tax credit",
    gist: "ITC needs a tax invoice, receipt of goods/services, tax actually paid by the supplier, and the return filed.",
    keywords: ["itc", "input tax credit", "credit eligible", "2b", "gstr-2b"],
  },
  {
    id: "itc-180-days",
    ref: "CGST Rules, 2017 — r.37",
    title: "Reversal of ITC on non-payment within 180 days",
    gist: "If a supplier is not paid within 180 days of the invoice date, the ITC claimed must be reversed with interest.",
    keywords: ["180 days", "reversal", "payable ageing", "creditor ageing"],
  },
  {
    id: "gstr1-due",
    ref: "CGST Rules, 2017 — r.59",
    title: "Furnishing details of outward supplies (GSTR-1)",
    gist: "Outward supplies are reported in GSTR-1 — monthly by the 11th, or quarterly under QRMP.",
    keywords: ["gstr-1", "gstr1", "outward", "sales return filing", "b2b", "b2c"],
  },
  {
    id: "gstr3b",
    ref: "CGST Rules, 2017 — r.61",
    title: "Monthly return in Form GSTR-3B",
    gist: "GSTR-3B is the summary return where output tax and eligible ITC are declared and tax is paid.",
    keywords: ["gstr-3b", "gstr3b", "summary return", "tax payable"],
  },
  {
    id: "rcm",
    ref: "CGST Act, 2017 — s.9(3) / s.9(4)",
    title: "Reverse charge mechanism",
    gist: "On notified supplies, and on certain supplies from unregistered persons, the recipient pays the tax.",
    keywords: ["rcm", "reverse charge", "urd", "unregistered purchase"],
  },
  {
    id: "einvoice",
    ref: "Notification 13/2020-CT (as amended)",
    title: "E-invoicing applicability",
    gist: "E-invoice (IRN) is mandatory once aggregate turnover crosses the notified threshold in any year from 2017-18.",
    keywords: ["e-invoice", "einvoice", "irn", "qr code"],
  },
  {
    id: "eway",
    ref: "CGST Rules, 2017 — r.138",
    title: "E-way bill",
    gist: "An e-way bill is required for movement of goods above the notified consignment value.",
    keywords: ["e-way", "eway", "transport", "consignment"],
  },
  {
    id: "msme-45",
    ref: "MSMED Act, 2006 — s.15 / Income-tax Act s.43B(h)",
    title: "Payment to micro & small enterprises",
    gist: "Dues to a registered micro/small supplier must be paid within 45 days, else the expense is disallowed in that year.",
    keywords: ["msme", "45 days", "43b", "micro", "small enterprise"],
  },
  {
    id: "tds",
    ref: "Income-tax Act, 1961 — Chapter XVII-B",
    title: "Tax deducted at source",
    gist: "TDS must be deducted at the prescribed rate at payment or credit, whichever is earlier, and deposited by the due date.",
    keywords: ["tds", "deducted at source", "194", "26q"],
  },
  {
    id: "depreciation",
    ref: "Income-tax Act, 1961 — s.32 / Companies Act Sch. II",
    title: "Depreciation",
    gist: "Tax depreciation is block-wise on WDV; book depreciation follows useful life under Schedule II.",
    keywords: ["depreciation", "wdv", "fixed asset", "block of assets"],
  },
  {
    id: "audit-44ab",
    ref: "Income-tax Act, 1961 — s.44AB",
    title: "Tax audit limits",
    gist: "Audit applies above the turnover threshold, relaxed where cash receipts and payments are within 5%.",
    keywords: ["tax audit", "44ab", "audit limit", "turnover limit"],
  },
  {
    id: "presumptive",
    ref: "Income-tax Act, 1961 — s.44AD / 44ADA",
    title: "Presumptive taxation",
    gist: "Business income may be declared at the prescribed percentage of turnover; professionals use 44ADA.",
    keywords: ["presumptive", "44ad", "44ada"],
  },
  {
    id: "nce-icai",
    ref: "ICAI — Accounting Standards for Non-Company Entities",
    title: "NCE reporting levels",
    gist: "Non-company entities are classified into levels by turnover/borrowings, with graded disclosure relief.",
    keywords: ["nce", "non-corporate", "icai", "level i", "level ii"],
  },
  {
    id: "books-retention",
    ref: "CGST Act, 2017 — s.36",
    title: "Retention of accounts",
    gist: "Books and records must be kept for 72 months from the due date of the annual return.",
    keywords: ["retention", "keep records", "72 months", "how long"],
  },
];

/** Map an assistant answer + the user question to relevant statutory citations. */
export function findCitations(text: string, question = "", limit = 3): LawCitation[] {
  const hay = `${question} ${text}`.toLowerCase();
  const scored = LAW.map((l) => {
    let score = 0;
    for (const k of l.keywords) if (hay.includes(k)) score += k.length;
    return { l, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((x) => ({ id: x.l.id, ref: x.l.ref, title: x.l.title, gist: x.l.gist }));
}

const TOOL_SOURCES: Record<string, DataSource> = {
  ledger_balance: { label: "Ledger account", to: "/app/reports/ledger" },
  cash_bank_balance: { label: "Cash & bank book", to: "/app/reports/cash-bank" },
  party_outstanding: { label: "Outstanding report", to: "/app/reports/outstanding" },
  trial_balance: { label: "Trial balance", to: "/app/reports/trial-balance" },
  profit_loss: { label: "Profit & loss", to: "/app/reports/profit-loss" },
  balance_sheet: { label: "Balance sheet", to: "/app/reports/balance-sheet" },
  sales_summary: { label: "Sales register", to: "/app/reports/sales-register" },
  purchase_summary: { label: "Purchase register", to: "/app/reports/purchase-register" },
  stock_summary: { label: "Stock summary", to: "/app/reports/stock-summary" },
  gst_summary: { label: "GSTR-3B working", to: "/app/reports/gstr3b" },
  day_book: { label: "Day book", to: "/app/reports/day-book" },
};

/** Turn executed tool names into "where this number came from" links. */
export function toolsToSources(toolNames: string[]): DataSource[] {
  const out: DataSource[] = [];
  const seen = new Set<string>();
  for (const n of toolNames) {
    const s = TOOL_SOURCES[n];
    const label = s?.label ?? n.replace(/_/g, " ");
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(s ?? { label });
  }
  return out;
}
