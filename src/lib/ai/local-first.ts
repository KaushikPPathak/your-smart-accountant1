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

    case "vendor_spend_cycle": {
      const c = card.vendorSpendCycle;
      if (!c) return null;
      const note = "_Answered locally from your books._";
      if (c.status === "no_name") return `Name the vendor, for example "spend and payment cycle for ABC Traders".\n\n${note}`;
      if (c.status === "not_found") return `I could not find a ledger named "${c.query}". Check the spelling, or give the exact ledger name.\n\n${note}`;
      if (c.status === "ambiguous") {
        return `More than one ledger matches "${c.query}": ${c.candidates.join(", ")}. Say which one.\n\n${note}`;
      }
      const period = `${c.from} to ${c.to}`;
      const cycle = c.averageCycleDays === null
        ? "No payment in the period settled a bill, so there is no payment cycle."
        : `Average payment cycle: ${c.averageCycleDays} days, measured on ${formatInr(c.settledPaise)} of payments matched to bills.`;
      const unmatched = c.unmatchedPaymentsPaise > 0 ? ` ${formatInr(c.unmatchedPaymentsPaise)} of payments in the period was not matched to a bill (advances).` : "";
      const method =
        c.method === "bill_allocations"
          ? "Payments are matched to the bills they were recorded against."
          : c.method === "mixed"
            ? `${formatInr(c.allocatedPaise)} is matched to the bills it was recorded against. ${formatInr(c.fifoPaise)} had no recorded allocation and is matched FIFO, so it is an estimate.`
            : c.method === "fifo"
              ? "No bill allocations are recorded for these payments, so they are matched FIFO. This is an estimate."
              : "";
      const opening = c.openingSettledPaise > 0 ? ` ${formatInr(c.openingSettledPaise)} of payments settled the opening balance; its age is unknown, so it is not timed.` : "";
      const unusable = c.unusableAllocations > 0 ? ` ${c.unusableAllocations} recorded allocation${c.unusableAllocations === 1 ? " points" : "s point"} at a bill dated after the payment or a missing bill, and was not used.` : "";
      return [
        `Purchases from ${c.vendor}, ${period}: gross ${formatInr(c.grossPurchasesPaise)} across ${c.billCount} bill${c.billCount === 1 ? "" : "s"}; less purchase returns ${formatInr(c.purchaseReturnsPaise)}; less other debit adjustments ${formatInr(c.debitAdjustmentsPaise)}; net ${formatInr(c.netPurchasesPaise)}.`,
        `${cycle}${unmatched}`,
        `${method}${unusable}`.trim(),
        note,
      ].join("\n\n");
    }

    case "duplicate_check": {
      const d = card.duplicateCheck;
      if (!d) return null;
      const rule = `Definitions: a duplicate bill is two purchase bills from one vendor with the same bill number. A repeat payment is the same amount paid to a vendor within ${d.repeatPaymentWindowDays} days. An unusual price is a purchase rate more than ${d.priceJumpPct}% above the vendor's previous rate for that item.`;
      const note = "_Answered locally from your books._";
      const none = d.duplicateBills.length + d.repeatPayments.length + d.priceJumps.length === 0;
      const parts: string[] = [];
      if (none) {
        parts.push(`No duplicate bills, repeat payments or unusual purchase prices found across ${d.purchaseCount} purchase bill${d.purchaseCount === 1 ? "" : "s"}.`);
      }
      if (d.duplicateBills.length) {
        parts.push(`Duplicate bill numbers (${d.duplicateBills.length}):\n` + d.duplicateBills.map((x) => `- ${x.vendor}: bill ${x.billNo}, ${x.voucherIds.length} vouchers, ${formatInr(x.totalPaise)}`).join("\n"));
      }
      if (d.repeatPayments.length) {
        parts.push(`Repeat payments (${d.repeatPayments.length}):\n` + d.repeatPayments.map((x) => `- ${x.vendor}: ${formatInr(x.amountPaise)} on ${x.dates.join(", ")}`).join("\n"));
      }
      if (d.priceJumps.length) {
        parts.push(`Unusual purchase prices (${d.priceJumps.length}):\n` + d.priceJumps.slice(0, 10).map((x) => `- ${x.item} from ${x.vendor} on ${x.date}: ${formatInr(x.ratePaise)} against ${formatInr(x.previousRatePaise)} (+${x.changePct}%)`).join("\n"));
      }
      if (d.purchasesWithoutBillNo > 0) {
        parts.push(`${d.purchasesWithoutBillNo} purchase bill${d.purchasesWithoutBillNo === 1 ? " has" : "s have"} no bill number, so ${d.purchasesWithoutBillNo === 1 ? "it was" : "they were"} not compared.`);
      }
      return [...parts, rule, note].join("\n\n");
    }

    case "vendor_overdue": {
      const v = card.vendorOverdue;
      if (!v) return null;
      const rule = "Overdue means a payable past the vendor's credit days (30 where none is set). Advances are unmatched payments; debit notes are unmatched debit notes. They are shown separately.";
      const note = "_Answered locally from your books._";
      if (!v.rows.length) {
        return `No vendor has a payable past its credit days, and none has an unadjusted advance or debit note. Checked ${v.checked} payable part${v.checked === 1 ? "y" : "ies"}.\n\n${rule}\n\n${note}`;
      }
      const lines = v.rows.map((r) => {
        const parts: string[] = [];
        if (r.overduePaise > 0) parts.push(`${formatInr(r.overduePaise)} overdue`);
        if (r.advancePaise > 0) parts.push(`${formatInr(r.advancePaise)} unadjusted advance`);
        if (r.debitNotePaise > 0) parts.push(`${formatInr(r.debitNotePaise)} unadjusted debit note`);
        return `- ${r.name}: ${parts.join("; ")} (of ${formatInr(r.outstandingPaise)} payable).`;
      });
      return [
        `${v.rows.length} vendor${v.rows.length === 1 ? " has" : "s have"} an overdue balance or an unadjusted advance.`,
        lines.join("\n"),
        rule,
        note,
      ].join("\n\n");
    }

    case "customer_ranking": {
      const c = card.customerRanking;
      if (!c) return null;
      const note = "_Answered locally from your books._";
      const revLines = c.byRevenue.length
        ? c.byRevenue.map((r, i) => `${i + 1}. ${r.name}: ${formatInr(r.revenuePaise)} across ${r.vouchers} sales voucher${r.vouchers === 1 ? "" : "s"}`).join("\n")
        : "No sales to a customer in this period.";
      const ovLines = c.byOverdue.length
        ? c.byOverdue.map((r, i) => `${i + 1}. ${r.name}: ${formatInr(r.overduePaise)} over 30 days (of ${formatInr(r.outstandingPaise)} outstanding)`).join("\n")
        : "No customer has a balance over 30 days old.";
      return [
        `**Top customers by revenue, ${c.from} to ${c.to}**\n\n${revLines}`,
        `**Top customers by overdue balance, as on ${c.to}**\n\n${ovLines}`,
        "Revenue is the sum of sales vouchers; credit notes are not deducted. Overdue means a balance over 30 days old; opening balances count as overdue.",
        note,
      ].join("\n\n");
    }

    case "credit_watch": {
      const w = card.creditWatch;
      if (!w) return null;
      const rule = "A customer is flagged when the balance is above its credit limit (where one is set), or any bill is past its credit days. Credit days are the ledger's own where set; otherwise 30 days, and the row says so. Opening balances count as overdue.";
      const note = "_Answered locally from your books._";
      if (!w.rows.length) {
        return `No customer is over a credit limit or past its credit days. Checked ${w.checked} receivable part${w.checked === 1 ? "y" : "ies"}.\n\n${rule}\n\n${note}`;
      }
      const lines = w.rows.map((r) => {
        const parts = [`outstanding ${formatInr(r.outstandingPaise)}`];
        if (r.creditLimitPaise !== null) parts.push(`limit ${formatInr(r.creditLimitPaise)}`);
        if (r.overLimitPaise > 0) parts.push(`over limit by ${formatInr(r.overLimitPaise)}`);
        if (r.overdue30Paise > 0) parts.push(`${formatInr(r.overdue30Paise)} past ${r.creditDays} credit days${r.creditDaysSource === "default_30" ? " (30-day default)" : ""}`);
        return `- ${r.name}: ${parts.join("; ")}.`;
      });
      return [
        `${w.rows.length} customer${w.rows.length === 1 ? " is" : "s are"} over a credit limit or past credit days.`,
        lines.join("\n"),
        rule,
        note,
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
        "Ranked by outstanding balance. Recorded bill allocations are applied first; unallocated receipts and payments settle the oldest bill first (FIFO).",
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
