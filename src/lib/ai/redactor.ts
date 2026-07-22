// PII redaction layer for AI Gateway calls.
// Replaces GSTIN, PAN, phone, email, bank a/c numbers with opaque tokens
// (<GSTIN_a1b2>, <PAN_c3d4>, ...). Keeps a reverse map so we can un-redact
// the LLM's answer before showing it to the user.
//
// The reverse map NEVER leaves the device — only the redacted payload does.

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}\b/g;
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
// Indian phone: optional +91, 10 digits starting 6-9. Guarded by word boundary + length.
const PHONE_RE = /\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Bank account: 9-18 digits, not part of longer numeric string. Conservative.
const BANK_RE = /(?<![\d])(\d{9,18})(?![\d])/g;

export interface RedactionMap {
  /** token → original string, e.g. "<GSTIN_a1b2>" → "27AAAPL1234C1ZV" */
  reverse: Map<string, string>;
  /** original → token so repeated occurrences share the same token */
  forward: Map<string, string>;
}

export function createRedactionMap(): RedactionMap {
  return { reverse: new Map(), forward: new Map() };
}

let counter = 0;
function shortId(): string {
  counter = (counter + 1) & 0xffff;
  return counter.toString(16).padStart(4, "0");
}

function tokenFor(kind: string, value: string, map: RedactionMap): string {
  const existing = map.forward.get(value);
  if (existing) return existing;
  const token = `<${kind}_${shortId()}>`;
  map.forward.set(value, token);
  map.reverse.set(token, value);
  return token;
}

/** Redact a single string. Safe for undefined / non-strings. */
export function redactString(input: unknown, map: RedactionMap): string {
  if (input == null) return "";
  let s = String(input);
  s = s.replace(GSTIN_RE, (m) => tokenFor("GSTIN", m, map));
  s = s.replace(PAN_RE, (m) => tokenFor("PAN", m, map));
  s = s.replace(EMAIL_RE, (m) => tokenFor("EMAIL", m, map));
  s = s.replace(PHONE_RE, (m) => tokenFor("PHONE", m, map));
  // Bank last — its pattern is broadest; other kinds get first claim.
  s = s.replace(BANK_RE, (m) => tokenFor("ACCT", m, map));
  return s;
}

/** Deep-redact any JSON-ish value in place-safe way (returns new structure). */
export function redactDeep<T>(value: T, map: RedactionMap): T {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value, map) as unknown as T;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, map)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, map);
    }
    return out as unknown as T;
  }
  return value;
}

/** Reverse redaction on the LLM's answer so the user sees real GSTINs/names. */
export function unredact(text: string, map: RedactionMap): string {
  if (!text || map.reverse.size === 0) return text;
  let out = text;
  for (const [token, original] of map.reverse) {
    if (out.includes(token)) out = out.split(token).join(original);
  }
  return out;
}
