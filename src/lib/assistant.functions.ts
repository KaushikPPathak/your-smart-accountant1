// Client-side stub for the AI assistant. The AI gateway requires a server
// secret; in the pure-SPA build it returns a friendly unavailability message.

export interface AssistantChatResult {
  text: string;
}

export async function assistantChat(
  _args?: { data: unknown },
): Promise<AssistantChatResult> {
  return {
    text:
      "The AI assistant is temporarily unavailable in this build. Please use the reports and ledgers directly for now.",
  };
}

export interface AssistantDraftResult {
  draft: null;
  error: string;
}

export async function assistantDraftVoucher(
  _args?: { data: unknown },
): Promise<AssistantDraftResult> {
  return {
    draft: null,
    error: "AI voucher drafting is temporarily unavailable in this build.",
  };
}
