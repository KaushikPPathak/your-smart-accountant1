
/**
 * Shared logic and hooks for accounting vouchers.
 */

import { useState, useCallback, useEffect } from "react";
import { parseToPaise } from "@/lib/utils/currency-utils";

/**
 * Common validation results for a voucher.
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate that a voucher date is not in the future.
 */
export function validateVoucherDate(date: string): string | null {
  const today = new Date().toISOString().split("T")[0];
  if (date > today) return "Voucher date cannot be in the future.";
  return null;
}

/**
 * Validate that a voucher has a party ledger selected.
 */
export function validateParty(partyId: string, label: string = "Party"): string | null {
  if (!partyId) return `${label} is required.`;
  return null;
}

/**
 * Hook to manage simple voucher line state (Receipt/Payment).
 */
export function useSimpleVoucherLines(initialCount: number = 2) {
  const [lines, setLines] = useState(() => 
    Array.from({ length: initialCount }, () => ({
      id: crypto.randomUUID(),
      ledger_id: "",
      amount: "0",
      narration: "",
    }))
  );

  const updateLine = useCallback((index: number, data: Partial<any>) => {
    setLines(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...data };
      return next;
    });
  }, []);

  const addLine = useCallback(() => {
    setLines(prev => [...prev, {
      id: crypto.randomUUID(),
      ledger_id: "",
      amount: "0",
      narration: "",
    }]);
  }, []);

  const totalPaise = lines.reduce((acc, l) => acc + parseToPaise(l.amount), 0);

  return { lines, setLines, updateLine, addLine, totalPaise };
}
