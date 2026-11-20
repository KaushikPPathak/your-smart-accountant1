// One list of Indian bank short names for the AI assistant. The router, the accounting engine and
// the retrievers all read it, so they cannot disagree about what "sbi" or "kotak" refers to.
//
// Short words that are also ordinary English ("yes", "union") are not listed on their own. They are
// recognised only inside their full bank names ("YES Bank", "Union Bank").

export const BANK_ALIAS_TABLE: ReadonlyArray<{ alias: string; canonical: string }> = [
  { alias: "bank of baroda", canonical: "Bank of Baroda" },
  { alias: "bob", canonical: "Bank of Baroda" },
  { alias: "state bank of india", canonical: "State Bank of India" },
  { alias: "sbi", canonical: "State Bank of India" },
  { alias: "bank of india", canonical: "Bank of India" },
  { alias: "boi", canonical: "Bank of India" },
  { alias: "bank of maharashtra", canonical: "Bank of Maharashtra" },
  { alias: "bom", canonical: "Bank of Maharashtra" },
  { alias: "punjab national bank", canonical: "Punjab National Bank" },
  { alias: "pnb", canonical: "Punjab National Bank" },
  { alias: "hdfc bank", canonical: "HDFC Bank" },
  { alias: "hdfc", canonical: "HDFC Bank" },
  { alias: "icici bank", canonical: "ICICI Bank" },
  { alias: "icici", canonical: "ICICI Bank" },
  { alias: "axis bank", canonical: "Axis Bank" },
  { alias: "axis", canonical: "Axis Bank" },
  { alias: "kotak mahindra bank", canonical: "Kotak Mahindra Bank Ltd" },
  { alias: "kotak", canonical: "Kotak Mahindra Bank Ltd" },
  { alias: "indusind bank", canonical: "INDUSIND BANK" },
  { alias: "indusind", canonical: "INDUSIND BANK" },
  { alias: "canara bank", canonical: "Canara Bank" },
  { alias: "canara", canonical: "Canara Bank" },
  { alias: "union bank of india", canonical: "Union Bank of India" },
  { alias: "union bank", canonical: "Union Bank of India" },
  { alias: "ubi", canonical: "Union Bank of India" },
  { alias: "idbi bank", canonical: "IDBI Bank" },
  { alias: "idbi", canonical: "IDBI Bank" },
  { alias: "yes bank", canonical: "YES Bank" },
  { alias: "rbl bank", canonical: "RBL Bank" },
  { alias: "rbl", canonical: "RBL Bank" },
  { alias: "uco bank", canonical: "UCO Bank" },
  { alias: "uco", canonical: "UCO Bank" },
];

/** Lower-case, letters and digits only, single spaces. */
export function normalizeBankText(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const BY_NAME = new Map<string, string>();
for (const { alias, canonical } of BANK_ALIAS_TABLE) {
  BY_NAME.set(normalizeBankText(alias), canonical);
  BY_NAME.set(normalizeBankText(canonical), canonical);
}

/** Canonical bank name for an alias or a full bank name; undefined when it is not a known bank. */
export function resolveBankAlias(input: string): string | undefined {
  return BY_NAME.get(normalizeBankText(input));
}

const LONGEST_FIRST = [...BANK_ALIAS_TABLE].sort(
  (a, b) => normalizeBankText(b.alias).length - normalizeBankText(a.alias).length,
);

/** Regex alternation of every alias, longest first, for use inside a word-bounded pattern. */
export const BANK_ALIAS_PATTERN = `(?:${[
  ...new Set(LONGEST_FIRST.map(({ alias }) => normalizeBankText(alias).replace(/ /g, "\\s+"))),
].join("|")})`;

/** First known bank named in free text. Longest alias first, whole words only. */
export function findBankInText(text: string): string | undefined {
  // "Yes, ..." / "Ok, ..." is an interjection, not the start of a bank name.
  const lower = normalizeBankText(text.replace(/^\s*(?:yes|yeah|yep|ok|okay)\s*[,.!;:-]\s*/i, ""));
  for (const { alias, canonical } of LONGEST_FIRST) {
    const pattern = normalizeBankText(alias).replace(/ /g, "\\s+");
    if (new RegExp(`\\b${pattern}\\b`, "i").test(lower)) return canonical;
  }
  return undefined;
}
