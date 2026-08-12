// Phase 3 — OCR bill → voucher draft (client side).
//
// Steps:
//   1) Read the user-dropped File as base64.
//   2) Call the `ai-ocr-invoice` edge function (Gemini vision).
//   3) Fuzzy-match extracted party against local ledgers using the
//      phonetic engine (reused from voucher-actions).
//   4) Return a structured OCR draft the assistant renders as a preview
//      card; on confirm the caller writes an AssistantPrefill and opens
//      the voucher form.

import { supabase } from "@/integrations/supabase/client";
import { readLedgers } from "@/lib/offline/cache-read";
import { scoreNameMatch } from "./phonetic";

export interface OcrItem {
  description: string;
  hsn?: string | null;
  quantity?: number | null;
  unit?: string | null;
  rate?: number | null;
  amount: number;
  gst_rate?: number | null;
}

export interface OcrExtracted {
  party_name: string;
  party_gstin?: string | null;
  party_state?: string | null;
  party_address?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  place_of_supply?: string | null;
  items: OcrItem[];
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess?: number;
  round_off?: number;
  total_amount: number;
  is_interstate?: boolean;
  notes?: string | null;
  confidence: number;
}

export interface OcrDraft {
  extracted: OcrExtracted;
  /** Best-guess local ledger for the party — null if none crossed threshold. */
  matchedPartyLedgerId: string | null;
  matchedPartyName: string | null;
  matchScore: number;
  /** Alternative ledger suggestions (score ≥ 0.5, top 3). */
  alternatives: { id: string; name: string; score: number }[];
  intent: "purchase" | "sales";
  fileName: string;
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function readFileAsBase64(file: File): Promise<{ base64: string; mime: string }> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max is 15 MB.`);
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve({
        base64: comma >= 0 ? result.slice(comma + 1) : result,
        mime: file.type || "image/jpeg",
      });
    };
    reader.readAsDataURL(file);
  });
}

export async function extractInvoiceOcr(
  file: File,
  companyId: string,
  intent: "purchase" | "sales" = "purchase",
): Promise<OcrDraft> {
  const { base64, mime } = await readFileAsBase64(file);
  const { data, error } = await supabase.functions.invoke("ai-ocr-invoice", {
    body: { fileBase64: base64, mimeType: mime, filename: file.name, hint: intent },
  });
  if (error) throw new Error(error.message || "OCR call failed");
  const payload = data as { ok?: boolean; extracted?: OcrExtracted; error?: string } | null;
  if (!payload || payload.ok === false || !payload.extracted) {
    throw new Error(payload?.error || "OCR returned no data");
  }
  const extracted = payload.extracted;

  // Fuzzy match party against local ledgers (phonetic engine).
  const ledgers = (await readLedgers(companyId)) as Array<{ id: string; name: string; type: string }>;
  const typeFilter =
    intent === "purchase"
      ? (t: string) => t === "sundry_creditor" || t === "expense_direct" || t === "expense_indirect"
      : (t: string) => t === "sundry_debtor" || t === "income_direct" || t === "income_indirect";
  const targetPhrase = String(extracted.party_name || "").trim();
  const scored = ledgers
    .filter((l) => typeFilter(l.type))
    .map((l) => ({ id: l.id, name: l.name, score: scoreNameMatch(l.name, targetPhrase).score }))
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  // Second pass across ALL ledgers if none in the type-restricted pool matched.
  const fallback = scored.length
    ? []
    : ledgers
        .map((l) => ({ id: l.id, name: l.name, score: scoreNameMatch(l.name, targetPhrase).score }))
        .filter((s) => s.score >= 0.6)
        .sort((a, b) => b.score - a.score);
  const pool = scored.length ? scored : fallback;

  const best = pool[0];
  return {
    extracted,
    matchedPartyLedgerId: best && best.score >= 0.7 ? best.id : null,
    matchedPartyName: best && best.score >= 0.7 ? best.name : null,
    matchScore: best?.score ?? 0,
    alternatives: pool.slice(0, 3),
    intent,
    fileName: file.name,
  };
}
