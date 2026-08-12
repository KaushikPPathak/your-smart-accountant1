// Post-write invariant guards for accounting vouchers.
//
// Double-entry bookkeeping has one non-negotiable law: total debits must
// equal total credits, on every voucher, every time. If a bug ever lets
// an unbalanced voucher through, the trial balance stops matching and
// every downstream report (P&L, Balance Sheet, GSTR) is silently wrong.
//
// These checks run in-process BEFORE the row leaves the app for the DB.
// A violation throws — the save never happens, the user sees the error,
// nothing is written. This is a defence-in-depth layer on top of the DB
// trigger; the DB trigger catches server-side bugs, this catches
// client-side bugs (e.g. a wrong posting builder, a bad rounding path).

export interface VoucherEntry {
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
}

export class VoucherInvariantError extends Error {
  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "VoucherInvariantError";
  }
}

/**
 * Assert Dr = Cr, all values are finite non-negative integers, and every
 * entry references a ledger. Amounts are in paise (integers) so there is
 * no floating-point slack — the sums must match exactly.
 */
export function assertVoucherBalanced(
  entries: readonly VoucherEntry[],
  context: { voucherType: string; companyId: string },
): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new VoucherInvariantError("Voucher has no ledger entries", context);
  }
  if (entries.length < 2) {
    throw new VoucherInvariantError("Voucher needs at least two ledger entries (Dr + Cr)", { ...context, entryCount: entries.length });
  }

  let dr = 0;
  let cr = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.ledger_id) {
      throw new VoucherInvariantError(`Entry ${i + 1} has no ledger_id`, context);
    }
    const d = e.debit_paise ?? 0;
    const c = e.credit_paise ?? 0;
    if (!Number.isFinite(d) || !Number.isInteger(d) || d < 0) {
      throw new VoucherInvariantError(`Entry ${i + 1} has an invalid debit_paise: ${d}`, context);
    }
    if (!Number.isFinite(c) || !Number.isInteger(c) || c < 0) {
      throw new VoucherInvariantError(`Entry ${i + 1} has an invalid credit_paise: ${c}`, context);
    }
    if (d > 0 && c > 0) {
      throw new VoucherInvariantError(`Entry ${i + 1} has both debit and credit set`, context);
    }
    dr += d;
    cr += c;
  }
  if (dr === 0 && cr === 0) {
    throw new VoucherInvariantError("Voucher totals are zero — refusing to save", context);
  }
  if (dr !== cr) {
    throw new VoucherInvariantError(
      `Voucher is unbalanced: debits ${dr} ≠ credits ${cr} (paise)`,
      { ...context, debit_paise: dr, credit_paise: cr, diff_paise: dr - cr },
    );
  }
}
