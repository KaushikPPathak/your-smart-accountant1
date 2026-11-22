// Routes for the GST questions that have a read-only answer: 6.1 provisional figure, 6.2 books
// against GSTR-2B, 6.3 / 7.3 voucher rules. These run before the generic GST pattern so that
// "what's my GST" asks for the month instead of going to a generic GST summary.
import type { IntentType, RouteResult } from "./query-router";
import { explicitMonthFromText } from "@/lib/gst/period-from-text";

const TWO_B = /\b(?:2b|gstr-?2b)\b/i;

/** 6.3: transactions without a GSTIN or HSN/SAC code. Checked before the book-rules pattern, which also matches "which transactions lack". */
export function taxComplianceQuestion(t: string): boolean {
  return /(?:gstin|registration (?:number|no)|hsn|sac\b|tax invoice)/i.test(t)
    && /(?:lack|missing|without|no\b|invalid|wrong|not (?:valid|correct|mentioned|given|entered))/i.test(t);
}

export function gstReconciliationQuestion(t: string): boolean {
  return TWO_B.test(t) && /(?:mismatch|reconcil|differ|match|missing|not (?:in|on|reflected)|\bvs\.?\b|versus|against|difference)/i.test(t);
}

export function bookRulesQuestion(t: string): boolean {
  return /(?:missing|lack(?:ing)?|without)\s+(?:a\s+|the\s+|any\s+)?(?:bill|invoice|reference|document|narration|cost\s*cent|supplier)|wrong (?:account )?(?:type|group)|account type|miscoded|(?:which|what) (?:vouchers|entries|transactions)[^?]{0,40}(?:fail|missing|lack|incomplete|wrong|check)|book(?:s)? (?:rules?|checks?|validation)/i.test(t);
}

export function gstProvisionalQuestion(t: string): boolean {
  if (TWO_B.test(t)) return false;
  return /(?:net gst|gst payable|gst liability|tax payable|provisional gst|gst due|how much gst|what(?:'s| is)\s+(?:my|our|the)\s+gst|gst (?:figure|amount)|gstr-?3b (?:payable|liability|due))/i.test(t);
}

/** Last calendar day of a "YYYY-MM" month, as "YYYY-MM-DD". */
function lastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, "0")}`;
}

function gstRoute(intent: IntentType, t: string): RouteResult {
  // Only an explicitly named month sets the period. A missing month stays unset: the tool asks.
  const month = explicitMonthFromText(t);
  const from = month ? `${month}-01` : undefined;
  const to = month ? lastDay(month) : undefined;
  return {
    intent,
    confidence: 0.9,
    requiresLLM: false,
    requiresTools: true,
    entity: {},
    entityHints: [],
    asOn: to,
    from,
    to,
    latestKind: "latest",
  } as RouteResult;
}

/** The GST route for a question, or null when it is not one of these. */
export function gstRouteFor(t: string): RouteResult | null {
  if (taxComplianceQuestion(t)) return gstRoute("tax_compliance", t);
  if (gstReconciliationQuestion(t)) return gstRoute("gst_reconciliation", t);
  if (bookRulesQuestion(t)) return gstRoute("book_rules", t);
  if (gstProvisionalQuestion(t)) return gstRoute("gst_provisional", t);
  return null;
}
