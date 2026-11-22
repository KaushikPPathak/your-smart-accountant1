// Chat text for the GST questions (6.1, 6.2, 6.3, 7.2 / 7.3 rule lists). Pure: takes the data a
// tool returned and produces the words shown in chat. Every answer names its period, and a missing
// period is asked for, never guessed.
import { formatINR } from "@/lib/utils/currency-utils";
import { recentCompletedMonths } from "@/lib/gst/period-from-text";

const NOTE_LOCAL = "_Answered locally from your books._";

function monthChoices(): string {
  return recentCompletedMonths(new Date())
    .map((m) => m.label)
    .join(", ");
}

/** Asked when a question names no month. The answer lists candidates; it never picks one. */
export function needsMonthText(intent: "gst_provisional" | "gst_reconciliation"): string {
  const what = intent === "gst_provisional" ? "provisional GST" : "the GSTR-2B reconciliation";
  return [
    `Which month do you want ${what} for? Name it, for example "${intent === "gst_provisional" ? "provisional GST" : "GSTR-2B reconciliation"} for ${recentCompletedMonths(new Date())[0].label}".`,
    `Recent completed months: ${monthChoices()}.`,
    NOTE_LOCAL,
  ].join("\n\n");
}

export interface ProvisionalData {
  status: "provisional" | "refused";
  reason?: string;
  period: { label: string };
  netPayableRupees?: { igst: number; cgst: number; sgst: number; total: number };
  reconciliation?: { state: string; note: string };
  screenPath: string;
  status_needs_month?: boolean;
}

export function provisionalText(d: ProvisionalData): string {
  if (d.status === "refused") {
    return [
      `Provisional GST for ${d.period.label} is not given: ${d.reason ?? "the books cannot support a figure."}`,
      `The GSTR-3B report: ${d.screenPath}`,
      NOTE_LOCAL,
    ].join("\n\n");
  }
  const n = d.netPayableRupees!;
  const rec = d.reconciliation?.note ?? "";
  return [
    `PROVISIONAL net GST payable for ${d.period.label}: ${formatINR(Math.round(n.total * 100))} (IGST ${formatINR(Math.round(n.igst * 100))}, CGST ${formatINR(Math.round(n.cgst * 100))}, SGST ${formatINR(Math.round(n.sgst * 100))}).`,
    `Reconciliation: ${rec}`,
    `This is a provisional figure from your books, not the filing figure. Check it on the GSTR-3B report: ${d.screenPath}`,
    NOTE_LOCAL,
  ].join("\n\n");
}

export interface ReconData {
  status: "ok" | "no_import" | "refused";
  reason?: string;
  period: { label: string };
  rows: {
    side: string;
    supplier: string;
    invoice_no: string;
    invoice_date: string | null;
    books_rupees: number | null;
    gstr2b_rupees: number | null;
    authoritative_label: string;
    guidance: string;
  }[];
  counts: { matched: number; gstr2b_only: number; books_only: number; mismatch: number };
  screenPath: string;
}

const SIDE_TEXT: Record<string, string> = {
  gstr2b_only: "In GSTR-2B, not in books",
  books_only: "In books, not in GSTR-2B",
  mismatch: "Value, tax, date or number differs",
};

const money = (rupees: number | null) => (rupees == null ? "-" : formatINR(Math.round(rupees * 100)));

export function reconText(d: ReconData): string {
  if (d.status !== "ok") {
    return [
      `Reconciliation for ${d.period.label} is not given: ${d.reason ?? "no data."}`,
      `GSTR-2B screen: ${d.screenPath}`,
      NOTE_LOCAL,
    ].join("\n\n");
  }
  const c = d.counts;
  const head = `GSTR-2B against books for ${d.period.label}: ${c.matched} matched, ${c.gstr2b_only} only in GSTR-2B, ${c.books_only} only in books, ${c.mismatch} with differences.`;
  if (d.rows.length === 0) {
    return [head, "No rows to act on.", `GSTR-2B screen: ${d.screenPath}`, NOTE_LOCAL].join("\n\n");
  }
  const lines = d.rows.slice(0, 20).map((r) => {
    const date = r.invoice_date ? ` (${r.invoice_date})` : "";
    return `- ${SIDE_TEXT[r.side] ?? r.side}: ${r.supplier} ${r.invoice_no}${date}. Books ${money(r.books_rupees)}, GSTR-2B ${money(r.gstr2b_rupees)}. Authoritative: ${r.authoritative_label}. ${r.guidance}`;
  });
  const more = d.rows.length > 20 ? `\n- and ${d.rows.length - 20} more on the GSTR-2B screen` : "";
  return [head, lines.join("\n") + more, `GSTR-2B screen: ${d.screenPath}`, NOTE_LOCAL].join("\n\n");
}

export interface RuleIssue { message: string; voucher_number?: string; voucher_date?: string; ledger?: string; party?: string }

export function ruleListText(title: string, note: string, issues: RuleIssue[], total: number, range: string): string {
  if (issues.length === 0) {
    return [`${title}: none found ${range}.`, note, NOTE_LOCAL].join("\n\n");
  }
  const lines = issues.slice(0, 20).map((i) => {
    const where = i.ledger ? `Ledger ${i.ledger}` : `${i.voucher_number ?? ""}${i.voucher_date ? ` (${i.voucher_date})` : ""}${i.party ? `, ${i.party}` : ""}`;
    return `- ${where}: ${i.message}`;
  });
  const more = total > 20 ? `\n- and ${total - 20} more` : "";
  return [`${title} ${range}: ${total} found.`, lines.join("\n") + more, note, NOTE_LOCAL].join("\n\n");
}
