import * as React from "react";

/**
 * Print pagination choice for books and ledgers.
 *  - "continuous": entries flow on from page to page.
 *  - "paged": each unit (a date for Cash/Bank/Journal books, a ledger for
 *    All Ledgers) starts on a fresh page.
 * Saved per report on this device.
 */
export type PrintLayout = "continuous" | "paged";

const key = (reportKey: string) => `ym_print_layout:${reportKey}`;

export function readPrintLayout(reportKey: string, fallback: PrintLayout): PrintLayout {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key(reportKey));
    return v === "paged" || v === "continuous" ? v : fallback;
  } catch {
    return fallback;
  }
}

export function usePrintLayout(reportKey: string, fallback: PrintLayout = "continuous") {
  const [layout, setLayoutState] = React.useState<PrintLayout>(() => readPrintLayout(reportKey, fallback));
  const setLayout = React.useCallback((next: PrintLayout) => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(key(reportKey), next);
    } catch {
      /* ignore */
    }
  }, [reportKey]);
  return [layout, setLayout] as const;
}

export interface BookPrintRow {
  key: string;
  date: string;
  vchNo: string;
  vchType: string;
  particulars: string;
  narration: string;
  debit: number; // paise
  credit: number; // paise
  /** Running balance after this row (paise, Dr positive) — Cash/Bank only. */
  balance?: number;
}

export interface BookPrintDay {
  date: string;
  rows: BookPrintRow[];
  debit: number;
  credit: number;
  /** Balance brought forward into the day (Cash/Bank only). */
  opening?: number;
  /** Balance carried forward at the end of the day (Cash/Bank only). */
  closing?: number;
}

/** Splits book rows into one block per date, preserving order and carrying balances. */
export function groupBookRowsByDate(rows: BookPrintRow[], opening?: number): BookPrintDay[] {
  const days: BookPrintDay[] = [];
  let carry = opening;
  for (const row of rows) {
    let day = days[days.length - 1];
    if (!day || day.date !== row.date) {
      day = { date: row.date, rows: [], debit: 0, credit: 0, opening: carry, closing: carry };
      days.push(day);
    }
    day.rows.push(row);
    day.debit += row.debit;
    day.credit += row.credit;
    if (row.balance != null) {
      day.closing = row.balance;
      carry = row.balance;
    }
  }
  return days;
}
