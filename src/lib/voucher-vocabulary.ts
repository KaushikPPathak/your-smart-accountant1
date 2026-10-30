// Word directory for the data-entry assistant.
//
// The assistant reads a plain sentence and decides which voucher it is:
//   payment  = money going OUT (paid, gave, sent, cheque issued, ...)
//   receipt  = money coming IN (received, collected, deposited, ...)
//   sales    = goods or services sold (sold, billed, invoice to, ...)
//   purchase = goods or services bought (bought, purchased, ...)
//
// Words are matched whole-word and case-insensitively. Spellings are listed
// as people type them: English, Indian-English shorthand, Hindi/Hinglish
// (romanised) and Gujarati (romanised), since the books are kept in India.
//
// To teach the assistant a new word, add it to the list for its voucher type.
// Keep each entry lower-case. Multi-word phrases are allowed.

import type { VoucherIntentType } from "./voucher-intent";

export const VOCABULARY: Record<VoucherIntentType, readonly string[]> = {
  payment: [
    // English
    "paid", "pay", "paying", "payment", "payments", "payed", "paid to", "paid for",
    "pay to", "pay for", "gave", "give to", "given to", "gave to", "sent", "send",
    "sent to", "send to", "transfer to", "transferred to", "transferred", "remitted",
    "remit", "remittance", "settled", "settle", "cash out", "cash paid", "cheque issued",
    "cheque given", "issued cheque", "issued a cheque", "neft to", "rtgs to", "imps to",
    "upi to", "online to", "gpay to", "phonepe to", "paytm to", "reimbursed", "refunded to",
    "advance to", "advance given", "expense paid", "bill paid", "salary paid", "rent paid",
    // Hindi / Hinglish
    "diya", "diye", "de diya", "de di", "bheja", "bheje", "bhugtan", "bhugtaan",
    "bhugtaan kiya", "bhara", "bhari", "bhare", "chukaya", "chukaye", "chukta", "chukta kiya",
    "kharcha", "kharch", "kharche", "kharcha kiya", "dena", "dena hai", "cheque diya",
    // Gujarati (romanised)
    "aapyu", "aapiyu", "aapi", "aapyo", "chukvyu", "chukavyu", "chukvi", "bharyu", "bharyo",
    "bharya", "kharchyu", "kharchayu",
  ],

  receipt: [
    // English
    "received", "receive", "receiving", "receipt", "receipts", "recd", "rcvd", "rcd",
    "recv", "rcpt", "collected", "collect", "collection", "collections", "deposited",
    "deposit", "deposited in bank", "deposited in cash", "cash in", "got", "got from",
    "credited", "credited to", "credited by", "credit to bank", "realised", "realized",
    "recovered", "recovery", "recovery from", "received from", "neft from", "rtgs from",
    "imps from", "upi from", "online from", "gpay from", "phonepe from", "paytm from",
    "cheque from", "cheque received", "chq from", "chq received", "check from",
    "check received", "refund from", "refund received", "advance from", "advance received",
    "commission received", "interest received", "rent received", "discount received",
    // Hindi / Hinglish
    "mila", "mile", "mili", "milaa", "milay", "aaya", "aayi", "aaye", "aaya hai", "aayi hai",
    "jama", "jamaa", "jama kiya", "jama karaya", "jama hua", "jama hui", "liya", "liye",
    "lia", "le liya", "le li", "prapt", "praapt", "paya", "payi", "paye", "vasool",
    "vasoolyi", "vasooli", "vasul",
    // Gujarati (romanised)
    "aavyu", "aavi", "aavya", "aavyo", "lidhu", "lidhi", "lidha", "lidhyu", "jama karyu",
    "jamaa karyu", "vasul karyu", "vasuli", "malyu", "malyo", "madyu",
  ],

  sales: [
    // English
    "sold", "sell", "selling", "sale", "sales", "sold to", "sell to", "sales to",
    "billed", "billed to", "bill to", "invoice", "invoiced", "invoice to", "invoiced to",
    "raised invoice", "raised an invoice", "issued invoice", "tax invoice", "sales bill",
    "export sale", "exported to", "supplied to", "supply to", "delivered to", "dispatched to",
    // Hindi / Hinglish
    "bech", "becha", "beche", "bechi", "bechna", "bechaa", "bikri", "bikree", "bikri ki",
    "bill banaya", "bill kiya", "bill bana",
    // Gujarati (romanised)
    "vechyu", "vechi", "vechya", "vechyo", "vechan", "vechaan", "vecchyu", "vech",
    "bill karyu", "bill banavyu",
  ],

  purchase: [
    // English
    "bought", "buy", "buying", "buys", "purchase", "purchases", "purchased", "purchased from",
    "bought from", "buy from", "purchase from", "supplier bill", "vendor bill", "purchase bill",
    "supplier invoice", "vendor invoice", "received from supplier", "bill from", "invoice from",
    "procured", "procurement",
    // Hindi / Hinglish
    "kharida", "kharide", "kharidi", "kharidna", "kharidna hai", "khareeda", "khareed",
    "khareedi", "kharid", "kharidi hai", "maal liya", "maal manga",
    // Gujarati (romanised)
    "kharidyu", "kharidi", "kharidyo", "kharidvu", "maal lidhu", "maal madyo", "kharid karyu",
  ],
};

/** Words that mean the sentence is a question or a report, not an entry. */
export const READ_ONLY_WORDS: readonly string[] = [
  "balance", "bal", "kitna", "kitne", "kitni", "kya", "due", "dues", "outstanding",
  "overdue", "total", "report", "register", "ledger", "statement", "summary", "list",
  "day book", "daybook", "book", "ageing", "aging", "how much", "how many", "show",
  "tell me", "kab", "kaun", "kahan",
];
