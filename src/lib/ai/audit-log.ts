// Phase H — Trust & governance for AI-originated actions.
//
// Anything the assistant drafts or prefills is recorded locally so the
// proprietor can later answer "who put this entry here?". The trail reuses
// the existing local activity log — nothing is sent anywhere.

import { logActivity } from "@/lib/activity-log";

export type AiActionKind =
  | "voucher_draft_accepted"
  | "voucher_draft_rejected"
  | "ocr_import"
  | "bank_line_posted"
  | "ledger_created";

export interface AiActionRecord {
  companyId: string;
  kind: AiActionKind;
  label: string;
  /** 0–1 model/heuristic confidence, when the source produced one. */
  confidence?: number | null;
  detail?: Record<string, unknown> | null;
}

const KIND_TEXT: Record<AiActionKind, string> = {
  voucher_draft_accepted: "AI draft accepted by user",
  voucher_draft_rejected: "AI draft rejected by user",
  ocr_import: "Invoice read by OCR",
  bank_line_posted: "Bank statement line posted",
  ledger_created: "Ledger created from AI suggestion",
};

export async function logAiAction(rec: AiActionRecord): Promise<void> {
  const conf =
    typeof rec.confidence === "number"
      ? ` · confidence ${Math.round(rec.confidence * 100)}%`
      : "";
  try {
    await logActivity({
      company_id: rec.companyId,
      entity_type: "voucher",
      entity_id: null,
      entity_label: rec.label,
      action: rec.kind === "voucher_draft_rejected" ? "delete" : "create",
      note: `${KIND_TEXT[rec.kind]}${conf}`,
      diff: rec.detail ?? null,
    });
  } catch {
    // The audit trail must never block the user's action.
  }
}
