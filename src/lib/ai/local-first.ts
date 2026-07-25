// Local-first answering — for deterministic intents (party balance, cash
// balance, trial balance, voucher lookup) the structured card the client
// already computed IS the answer. We render a short, formulaic prose blurb
// and skip the LLM entirely.
//
// This is Tier 3 item #12: cloud model is used only when narrative
// judgement matters (open-ended questions, "why is X higher than Y",
// comparisons, follow-ups the router couldn't nail down).
//
// Zero LLM tokens, zero credits, ~5ms round-trip.

import type { StructuredCard } from "./sqliteContext";

function formatInr(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  return "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rupees);
}

/**
 * If we can answer deterministically from the card, return the prose blurb
 * the UI should show. The verified balance card is rendered above it, so
 * this text is just the "human explanation" — kept intentionally short.
 * Returns null when we should still call the LLM.
 */
export function localFirstAnswer(card: StructuredCard | undefined): string | null {
  if (!card || card.kind !== "party_balance") return null;
  const drCr = card.isDebit ? "Dr" : "Cr";
  const asOn = card.asOnDate ? ` as on ${card.asOnDate}` : "";
  const owes = card.isDebit
    ? `${card.partyName} owes you ${formatInr(card.closingPaise)}${asOn}.`
    : `You owe ${card.partyName} ${formatInr(card.closingPaise)}${asOn}.`;

  const parts: string[] = [];
  parts.push(owes);

  // Cash-vs-bank narrative when we have the split.
  if (card.modeSplit) {
    const { cashPaise, bankPaise, otherPaise } = card.modeSplit;
    const total = Math.abs(cashPaise) + Math.abs(bankPaise) + Math.abs(otherPaise);
    if (total > 0) {
      const bits: string[] = [];
      if (Math.abs(cashPaise) > 0) bits.push(`${formatInr(cashPaise)} in cash`);
      if (Math.abs(bankPaise) > 0) bits.push(`${formatInr(bankPaise)} through bank`);
      if (Math.abs(otherPaise) > 0) bits.push(`${formatInr(otherPaise)} through other modes`);
      if (bits.length) parts.push(`Settlement mode split: ${bits.join(", ")}.`);
    }
  }

  parts.push(
    `Movement in the period: ${formatInr(card.debitPaise)} Dr, ${formatInr(card.creditPaise)} Cr ` +
      `across ${card.voucherCount} voucher${card.voucherCount === 1 ? "" : "s"}. ` +
      `Opening was ${formatInr(card.openingPaise)}.`,
  );

  parts.push(
    "_Answered locally from your books — no cloud AI was called. " +
      "Ask a follow-up like \"why?\" or \"compare with last year\" to get a narrative._",
  );

  return parts.join("\n\n");
}
