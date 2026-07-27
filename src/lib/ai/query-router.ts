// Offline intent classifier for the AI assistant.
// Pure regex + keyword matching — no LLM call, runs in <1ms.
// Feeds the scoped retrievers so we only fetch the rows a question actually needs.

export type QueryIntent =
  | "party_balance"       // "what does Ramesh owe", "balance of ABC Ltd"
  | "party_ledger"        // "show Ramesh's ledger", "statement of ABC"
  | "date_range_report"   // "sales in march", "purchases last quarter"
  | "voucher_lookup"      // "invoice SI-234", "voucher #123"
  | "latest_voucher"      // "last sales bill", "latest purchase invoice"
  | "ageing"              // "overdue", "90 days outstanding", "ageing"
  | "gst_query"           // "gstr1", "gst liability", "itc"
  | "trial_balance"       // "trial balance", "tb as of"
  | "profit_loss"         // "p&l", "profit", "loss", "trading"
  | "cash_bank"           // "cash balance", "bank book"
  | "stock_query"         // "stock", "closing stock", "inventory"
  | "general";            // fallback → send small generic snapshot

export interface RoutedQuery {
  intent: QueryIntent;
  /** Free-text tokens that look like party/ledger/item names to search for. */
  entityHints: string[];
  /** ISO from/to if the question mentions a date range. */
  from?: string;
  to?: string;
  /** "as on <date>" — freeze balances at this ISO date. Implies to = asOn. */
  asOn?: string;
  /** Voucher number if explicitly mentioned. */
  voucherNumber?: string;
  /** "in the books of X" → candidate company name to switch context to. */
  companyHint?: string;
  /** For "last/latest <kind> bill" → normalized voucher type. */
  latestKind?: "sales" | "purchase" | "receipt" | "payment" | "journal" | "credit_note" | "debit_note";
}

/** Parse an "as on / as at / as of / on <date>" phrase → ISO date. */
function extractAsOn(q: string): string | undefined {
  const lower = q.toLowerCase();
  // ISO form: as on 2026-03-31
  const iso = lower.match(/\b(?:as\s+(?:on|at|of)|on|upto|up\s+to|till|until)\s+(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  // DD/MM/YYYY or DD-MM-YYYY (Indian convention). Year may be 2 or 4 digits.
  const dmy = lower.match(/\b(?:as\s+(?:on|at|of)|on|upto|up\s+to|till|until)\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (dmy) {
    const d = Number(dmy[1]); const m = Number(dmy[2]);
    let y = Number(dmy[3]); if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
    }
  }
  // "as on 31 March 2026"
  const dmn = lower.match(/\b(?:as\s+(?:on|at|of)|on)\s+(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})\b/);
  if (dmn) {
    const d = Number(dmn[1]); const m = MONTHS[dmn[2]]; const y = Number(dmn[3]);
    return `${y}-${(m + 1).toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
  }
  return undefined;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

function extractDateRange(q: string): { from?: string; to?: string } {
  const lower = q.toLowerCase();
  const now = new Date();
  const y = now.getFullYear();

  // "last month"
  if (/\blast month\b/.test(lower)) {
    const start = new Date(y, now.getMonth() - 1, 1);
    const end = new Date(y, now.getMonth(), 0);
    return { from: iso(start), to: iso(end) };
  }
  if (/\bthis month\b/.test(lower)) {
    return { from: iso(new Date(y, now.getMonth(), 1)), to: iso(now) };
  }
  if (/\blast quarter\b/.test(lower)) {
    const q0 = Math.floor(now.getMonth() / 3) * 3 - 3;
    return { from: iso(new Date(y, q0, 1)), to: iso(new Date(y, q0 + 3, 0)) };
  }
  if (/\bthis (fy|financial year)\b|\bcurrent fy\b/.test(lower)) {
    const fyStartYear = now.getMonth() >= 3 ? y : y - 1;
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
  }
  if (/\blast (fy|financial year)\b|\bprevious fy\b/.test(lower)) {
    const fyStartYear = (now.getMonth() >= 3 ? y : y - 1) - 1;
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
  }

  // Month name + optional year: "sales in march 2026"
  const mMatch = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*(\d{4})?/);
  if (mMatch) {
    const mIdx = MONTHS[mMatch[1]];
    const year = mMatch[2] ? Number(mMatch[2]) : y;
    return { from: iso(new Date(year, mIdx, 1)), to: iso(new Date(year, mIdx + 1, 0)) };
  }

  // Explicit ISO or DD/MM/YYYY range
  const isoMatch = lower.match(/(\d{4}-\d{2}-\d{2}).{1,15}?(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return { from: isoMatch[1], to: isoMatch[2] };

  return {};
}

/** Extract quoted phrases and capitalised words as candidate party/ledger names. */
function extractEntityHints(q: string): string[] {
  const hints = new Set<string>();
  for (const m of q.matchAll(/"([^"]{2,40})"|'([^']{2,40})'/g)) {
    const v = (m[1] ?? m[2] ?? "").trim();
    if (v) hints.add(v);
  }
  // Capitalised runs of 1-4 words, but skip sentence starters we don't care about.
  const stop = new Set(["what","who","when","where","why","how","show","list","give","tell","the","a","an","of","for","in","on","at","is","are","from","to","and","or","my","me"]);
  const tokens = q.split(/\s+/);
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 1) {
      const phrase = run.join(" ").trim().replace(/[.,;:!?]+$/, "");
      if (phrase.length >= 2 && !stop.has(phrase.toLowerCase())) hints.add(phrase);
    }
    run = [];
  };
  for (const t of tokens) {
    if (/^[A-Z][A-Za-z&.]*$/.test(t) && !stop.has(t.toLowerCase())) run.push(t);
    else { flush(); }
    if (run.length >= 4) flush();
  }
  flush();
  return [...hints];
}

function extractVoucherNumber(q: string): string | undefined {
  const m = q.match(/\b([A-Z]{1,4}[-/]?\d{1,8})\b/);
  return m?.[1];
}

export function routeQuery(question: string): RoutedQuery {
  const q = question.trim();
  const lower = q.toLowerCase();
  const dates = extractDateRange(q);
  const asOn = extractAsOn(q);
  // "as on <date>" implies the closing date; use it as `to` if no explicit range was given.
  if (asOn && !dates.to) {
    dates.to = asOn;
    // Anchor `from` to the FY start of the as-on date for windowed reports.
    const d = new Date(asOn);
    const fyStartYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    if (!dates.from) dates.from = `${fyStartYear}-04-01`;
  }
  const voucherNumber = extractVoucherNumber(q);

  // "in the books of X", "books of X", "for company X"
  // Strip company clause BEFORE extracting entity hints so "X in the books of Y"
  // doesn't pollute entity matching with the company name tokens.
  let companyHint: string | undefined;
  let qForEntities = q;
  const cm = q.match(/\b(?:in\s+the\s+)?books?\s+of\s+([A-Za-z][A-Za-z0-9&.\s]{2,60})$/i)
          ?? q.match(/\b(?:in\s+the\s+)?books?\s+of\s+([A-Za-z][A-Za-z0-9&.\s]{2,60}?)(?=\s+(?:what|show|list|give|tell|and|find|for|as\s+on)\b|[?.,;]|$)/i)
          ?? q.match(/\bfor\s+company\s+([A-Za-z][A-Za-z0-9&.\s]{2,60})/i);
  if (cm) {
    companyHint = cm[1].trim().replace(/[.,;:!?]+$/, "");
    qForEntities = q.replace(cm[0], " ").trim();
  }

  // Extract entity hints from the question (with company clause removed).
  // Also capture explicit "balance of X" / "ledger of X" / "<X> balance"
  // phrases in a case-insensitive way, so lowercase names like "Land navsari"
  // are still picked up.
  const entityHints = extractEntityHints(qForEntities);
  const balOf = qForEntities.match(/\b(?:balance|ledger|statement|account)\s+(?:of|for)\s+([A-Za-z][A-Za-z0-9&.\s]{1,60}?)(?=\s+(?:as\s+on|on|what|show|and|for|in)\b|[?.,;]|$)/i);
  if (balOf) entityHints.unshift(balOf[1].trim());
  const leading = qForEntities.match(/^([A-Za-z][A-Za-z0-9&.\s]{1,60}?)\s+(?:what\s+is\s+(?:the\s+)?(?:ledger\s+)?balance|balance|ledger\s+balance)\b/i);
  if (leading) entityHints.unshift(leading[1].trim());

  // "last/latest <kind> bill/invoice/voucher/entry"
  let latestKind: RoutedQuery["latestKind"];
  const lm = lower.match(/\b(last|latest|most\s+recent|previous)\s+(sales|sale|purchase|receipt|payment|journal|credit\s*note|debit\s*note)\b/);
  if (lm) {
    const k = lm[2].replace(/\s+/g, "_");
    latestKind = (k === "sale" ? "sales" : k) as RoutedQuery["latestKind"];
  }

  let intent: QueryIntent = "general";

  // A strong party signal exists when the question said "balance/ledger of <Name>"
  // OR a leading "<Name> balance" clause matched. In that case, party lookup wins
  // over generic cash_bank routing even if the word "cash" appears (e.g. the user
  // asked "cash balance of Madhuben" = party balance, settled in cash).
  // A "leading" match on the bare words "cash"/"bank" is not a party hint —
  // those are ledger-type keywords, not party names. Only treat as strong
  // party hint when the leading name is something other than cash/bank.
  const leadingName = leading?.[1]?.trim().toLowerCase() ?? "";
  const leadingIsCashBank = /^(cash|bank)\b/.test(leadingName);
  const strongPartyHint = Boolean(balOf || (leading && !leadingIsCashBank));

  if (latestKind) {
    intent = "latest_voucher";
  } else if (voucherNumber || /\b(voucher|invoice|bill|receipt|payment)\s*(no|number|#)/.test(lower)) {
    intent = "voucher_lookup";
  } else if (/\b(ageing|aging|overdue|days? outstanding|30 days|60 days|90 days)\b/.test(lower)) {
    intent = "ageing";
  } else if (/\b(gstr[- ]?1|gstr[- ]?2|gstr[- ]?3|gst liability|itc|input tax|output tax|hsn)\b/.test(lower)) {
    intent = "gst_query";
  } else if (/\btrial balance|\btb\b/.test(lower)) {
    intent = "trial_balance";
  } else if (/\b(p&l|p and l|profit|loss|trading|gross profit|net profit)\b/.test(lower)) {
    intent = "profit_loss";
  } else if (/\b(cash|bank)\s+(book|balance|position|in\s*hand|on\s*hand|at\s*bank)\b|\bcash\s*[- ]?in[- ]?hand\b|\bcash\s*[- ]?on[- ]?hand\b|\bbrs\b/.test(lower)) {
    intent = "cash_bank";
  } else if (strongPartyHint && /\b(ledger|statement|account)\b/.test(lower)) {
    intent = "party_ledger";
  } else if (strongPartyHint) {
    intent = "party_balance";
  } else if (/\b(stock|inventory|closing stock|opening stock|item)\b/.test(lower)) {
    intent = "stock_query";
  } else if (/\b(balance|owes?|owed|payable|receivable|outstanding|due)\b/.test(lower) && entityHints.length > 0) {
    intent = "party_balance";
  } else if (/\b(ledger|statement|account) (of|for)\b/.test(lower) && entityHints.length > 0) {
    intent = "party_ledger";
  } else if ((dates.from || dates.to) && /\b(sales|purchase|receipt|payment|journal|register)\b/.test(lower)) {
    intent = "date_range_report";
  }


  return { intent, entityHints, ...dates, asOn, voucherNumber, companyHint, latestKind };
}
