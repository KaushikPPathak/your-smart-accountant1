// Client-side stubs for the AI assistant. The AI gateway requires a server
// secret; in the pure-SPA build these return graceful "unavailable" results
// with the same shape the original server functions produced.

export interface AssistantChatResult {
  ok: boolean;
  text: string;
  error?: string;
  toolCalls?: { name: string; input: string }[];
}

export async function assistantChat(
  _args?: { data: unknown },
): Promise<AssistantChatResult> {
  return {
    ok: false,
    text: "",
    error: "AI assistant is temporarily unavailable in this build.",
  };
}

export interface AssistantDraft {
  date: string;
  partyLedgerId?: string | null;
  cashBankLedgerId?: string | null;
  counterLedgerId?: string | null;
  amount: number;
  narration?: string;
  refNo?: string;
}

export interface AssistantDraftResult {
  ok: boolean;
  draft: AssistantDraft | null;
  error?: string;
}

export async function assistantDraftVoucher(
  _args?: { data: unknown },
): Promise<AssistantDraftResult> {
  return {
    ok: false,
    draft: null,
    error: "AI voucher drafting is temporarily unavailable in this build.",
  };
}
