// Tiny per-session memory so follow-ups ("and as on 31/12/2025?",
// "what about last month?") can re-use the previously resolved party,
// company and date without the user having to repeat themselves.
//
// Stored client-side only, in the AssistantChat component ref.

import type { QueryIntent } from "./query-router";

export interface ConversationMemory {
  companyId?: string | null;
  /** Last resolved party ledger name (post-fuzzy). */
  partyName?: string;
  partyLedgerId?: string;
  /** Last "as on" date (ISO) the user asked about. */
  asOnDate?: string;
  /** Last from/to window. */
  from?: string;
  to?: string;
  /** Last classified intent. */
  intent?: QueryIntent;
}

export function mergePrior(next: ConversationMemory, prev?: ConversationMemory): ConversationMemory {
  return { ...(prev ?? {}), ...next };
}
