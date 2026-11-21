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
        const { cashPaise = 0, bankPaise = 0, otherPaise = 0 } = card.modeSplit;


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

    case "cash_bank_total": {
      const t = card.cashBankTotal;
      if (!t) return null;
      if (!t.rows.length) return "No cash or bank ledgers found in this company.\n\n_Answered locally from your books._";
      const asOn = t.asOnDate ? ` as on ${t.asOnDate}` : "";
      const lines = t.rows.map((r) => `- ${r.name}: ${formatInr(Math.abs(r.closingPaise))} ${r.closingPaise < 0 ? "Cr" : "Dr"}`);
      return [
        `Cash and bank total${asOn}: ${formatInr(Math.abs(t.totalPaise))} ${t.totalPaise < 0 ? "Cr" : "Dr"}.`,
        lines.join("\n"),
        "_Answered locally from your books._",
      ].join("\n\n");
    }

    case "cash_runway": {
      const c = card.cashRunway;
      if (!c) return null;
      const basis = `Monthly burn is the fall in cash and bank over the three full months from ${c.windowFrom} to ${c.windowTo}, divided by three.`;
      const note = "_Answered locally from your books._";
      if (c.reason === "no_data") return `There are no postings to measure a runway from.\n\n${note}`;
      if (c.reason === "short_history") {
        return `The books start on ${c.latestDate ?? "an unknown date"}, too late to measure three full months before the latest posting. Runway needs that history.\n\n${note}`;
      }
      if (c.reason === "exhausted") {
        return `Cash and bank are nil or overdrawn (${formatInr(Math.abs(c.currentPositionPaise))} ${c.currentPositionPaise < 0 ? "Cr" : "Dr"} as on ${c.latestDate}). There is no runway left.\n\n${note}`;
      }
      if (c.reason === "not_burning") {
        return `Cash and bank did not fall over the last three full months, so the current trend gives no runway limit. Current position: ${formatInr(c.currentPositionPaise)} as on ${c.latestDate}.\n\n${basis}\n\n${note}`;
      }
      return [
        `About ${c.runwayDays} days of runway at the current burn of ${formatInr(c.monthlyBurnPaise)} a month.`,
        `Cash and bank: ${formatInr(c.currentPositionPaise)} as on ${c.latestDate}.`,
        basis,
        note,
      ].join("\n\n");
    }

    case "bank_anomalies": {
      const b = card.bankAnomalies;
      if (!b) return null;
      const rule = "A month counts as a spike at 2× its earlier monthly average and ₹10,000 or more.";
      if (!b.rows.length) {
        return `No spike in cash or bank outflows. Checked ${b.checkedLedgers} cash and bank ledger${b.checkedLedgers === 1 ? "" : "s"}. ${rule}\n\n_Answered locally from your books._`;
      }
      const lines = b.rows.map((r) => {
        const ratio = Number.isFinite(r.ratio) ? `${r.ratio}×` : "from nil";
        return `- ${r.name} (${r.month}): ${formatInr(r.outflowPaise)} out, against an average of ${formatInr(r.baselinePaise)} over ${r.baselineMonths} earlier month${r.baselineMonths === 1 ? "" : "s"} (${ratio}).`;
      });
      return [
        `${b.rows.length} cash or bank ledger${b.rows.length === 1 ? " shows" : "s show"} an unusual outflow in the latest month.`,
        lines.join("\n"),
        rule,
        "_Answered locally from your books._",
      ].join("\n\n");
    }

    case "sales_total": {
      const s = card.salesTotal;
      if (!s) return null;
      if (s.count === 0) return `No sales vouchers from ${s.from} to ${s.to}.\n\n_Answered locally from your books._`;
      return [
        `Sales from ${s.from} to ${s.to}: ${formatInr(s.totalPaise)} across ${s.count} sales voucher${s.count === 1 ? "" : "s"}.`,
        "This is the sum of each sales voucher's total. Credit notes are not deducted.",
        "_Answered locally from your books._",
      ].join("\n\n");
    }

    case "party_summary": {
      const s = card.partySummary;
      if (!s) return null;
      const word = s.side === "receivable" ? "Receivables" : "Payables";
      const asOn = s.asOnDate ? ` as on ${s.asOnDate}` : "";
      if (!s.rows.length) {
        return `No ${s.side === "receivable" ? "receivables" : "payables"} outstanding${asOn}.\n\n_Answered locally._`;
      }
      const top = s.rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.name} — ${formatInr(r.outstandingPaise)}`);
      const more = s.rows.length > 10 ? [`…and ${s.rows.length - 10} more parties.`] : [];
      const b = s.totalBuckets as Record<string, number>;
      const ageing =
        `Ageing from bill dates: 0–30 days ${formatInr(b.d0_30 ?? 0)}, 31–60 ${formatInr(b.d31_60 ?? 0)}, ` +
        `61–90 ${formatInr(b.d61_90 ?? 0)}, over 90 ${formatInr(b.d90p ?? 0)}` +
        ((b.opening ?? 0) > 0 ? `, opening balances ${formatInr(b.opening ?? 0)}` : "") +
        ".";
      return [
        `${word}${asOn}: ${formatInr(s.totalOutstandingPaise)} from ${s.rows.length} part${s.rows.length === 1 ? "y" : "ies"}.`,
        top.join("\n"),
        ...more,
        ageing,
        "Ranked by outstanding balance. Each receipt or payment settles the oldest bill first.",
        "_Answered locally from your books._",
      ].join("\n\n");
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
      // Prefer the accounting engine's authoritative totals when present.
      const dr =
        card.totalDebitPaise ??
        card.rows.reduce((s, r) => s + (r.debitPaise > 0 ? r.debitPaise : 0), 0);
      const cr =
        card.totalCreditPaise ??
        card.rows.reduce((s, r) => s + (r.creditPaise > 0 ? r.creditPaise : 0), 0);
      const diff = Math.abs(dr - cr);
      const asOn = card.asOnDate ? ` as on ${card.asOnDate}` : "";
      return [
        `Trial balance${asOn} — ${card.rows.length} ledgers.`,
        `Total Dr: ${formatInr(dr)} | Total Cr: ${formatInr(cr)}`,
        (card.balanced ?? diff < 1) ? "✅ Balanced." : `⚠️ Off by ${formatInr(diff)}.`,
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
      const lines = card.vouchers.slice(0, 15).map((v: any, i: number) =>
        `${i + 1}. **${v.date || v.voucher_date}**: ${v.number || v.voucher_number || v.kind || ""} — ${formatInr(v.total_paise || v.debit_paise || v.credit_paise || 0)}`,
      );
      return lines.join("\n") + "\n\n_Answered locally._";
    }

    default:
      return null;
  }
}
