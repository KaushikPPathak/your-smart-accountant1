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
export type { StructuredCard };


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
  if (!card) return null;

  switch (card.kind) {
    case "party_balance": {
      const asOn = card.asOnDate ? ` as on ${card.asOnDate}` : "";
      const owes = card.isDebit
        ? `${card.partyName} owes you ${formatInr(card.closingPaise ?? 0)}${asOn}.`
        : `You owe ${card.partyName} ${formatInr(card.closingPaise ?? 0)}${asOn}.`;


      const parts: string[] = [];
      parts.push(owes);

      if (card.modeSplit) {
        const { cashPaise, bankPaise, otherPaise } = card.modeSplit;
        const total = Math.abs(cashPaise) + Math.abs(bankPaise) + Math.abs(otherPaise);
        if (total > 0) {
          const bits: string[] = [];
          if (Math.abs(cashPaise) > 0) bits.push(`${formatInr(cashPaise ?? 0)} in cash`);
          if (Math.abs(bankPaise) > 0) bits.push(`${formatInr(bankPaise ?? 0)} through bank`);
          if (Math.abs(otherPaise) > 0) bits.push(`${formatInr(otherPaise ?? 0)} through other modes`);

          if (bits.length) parts.push(`Settlement mode split: ${bits.join(", ")}.`);
        }
      }

      parts.push(
        `Movement in the period: ${formatInr(card.debitPaise ?? 0)} Dr, ${formatInr(card.creditPaise ?? 0)} Cr ` +
          `across ${card.voucherCount ?? 0} voucher${card.voucherCount === 1 ? "" : "s"}. ` +
          `Opening was ${formatInr(card.openingPaise ?? 0)}.`,

      );

      parts.push(
        "_Answered locally from your books — no cloud AI was called. " +
          'Ask a follow-up like "why?" or "compare with last year" to get a narrative._',
      );

      return parts.join("\n\n");
    }

    case "cash_balance": {
      const label = "Cash";
      return `${label} balance is ${formatInr(card.closingPaise ?? 0)} ${card.isDebit ? "Dr" : "Cr"}.\n\n_Answered locally._`;

    }

    case "bank_balance": {
      const label = card.accountName || "Bank";
      return `${label} balance is ${formatInr(card.closingPaise ?? 0)} ${card.isDebit ? "Dr" : "Cr"}.\n\n_Answered locally._`;
    }

    case "trial_balance": {
      if (!card.rows?.length) return "Trial balance is empty.";
      const dr = card.rows.reduce((s, r) => s + (r.debitPaise > 0 ? r.debitPaise : 0), 0);
      const cr = card.rows.reduce((s, r) => s + (r.creditPaise > 0 ? r.creditPaise : 0), 0);
      const diff = Math.abs(dr - cr);
      return [
        `Trial balance — ${card.rows.length} ledgers.`,
        `Total Dr: ${formatInr(dr)} | Total Cr: ${formatInr(cr)}`,
        diff < 1 ? "✅ Balanced." : `⚠️ Off by ${formatInr(diff)}.`,
        `_Answered locally._`,
      ].join("\n\n");
    }

    case "voucher_lookup": {
      if (!card.voucher) return null;
      const v = card.voucher;
      return [
        `**Voucher ${v.number}** (${v.type}) — ${v.date}`,
        `Narration: ${v.narration}`,
        `_Answered locally._`,
      ].join("\n\n");
    }

    case "voucher_list": {
      if (!card.vouchers?.length) return "No vouchers found.";
      const lines = card.vouchers.map((v: any, i: number) =>
        `${i + 1}. **${v.number}** — ${v.narration || v.kind}`,
      );
      return lines.join("\n") + "\n\n_Answered locally._";
    }

    default:
      return null;
  }
}
