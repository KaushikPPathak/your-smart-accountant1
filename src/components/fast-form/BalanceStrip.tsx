import * as React from "react";
import { useVoucherContext } from "@/lib/voucher-context-store";
import { LedgerBalanceChip } from "@/components/vouchers/LedgerBalanceChip";

/**
 * Live balance strip rendered in the app status bar. Reads
 * `voucher-context-store` so it works for any open voucher form.
 */
export function BalanceStrip() {
  const ctx = useVoucherContext();
  if (!ctx.partyLedgerId && !ctx.cashBankLedgerId) return null;
  return (
    <div className="flex items-center gap-2">
      {ctx.partyLedgerId && (
        <LedgerBalanceChip ledgerId={ctx.partyLedgerId} prefix="Party" compact />
      )}
      {ctx.cashBankLedgerId && (
        <LedgerBalanceChip ledgerId={ctx.cashBankLedgerId} prefix="Cash/Bank" compact />
      )}
    </div>
  );
}
