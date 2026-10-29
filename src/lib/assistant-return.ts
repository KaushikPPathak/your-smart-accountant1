/**
 * Remembers that a voucher form was opened from the Mehtaji assistant, so the
 * form's Cancel button can take the user back to the chat instead of the list.
 */
const KEY = "ym_assistant_return";
export const ASSISTANT_PATH = "/app/assistant";

export function markAssistantReturn(): void {
  try { sessionStorage.setItem(KEY, ASSISTANT_PATH); } catch { /* storage unavailable */ }
}

export function peekAssistantReturn(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function consumeAssistantReturn(): string | null {
  const v = peekAssistantReturn();
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  return v;
}
