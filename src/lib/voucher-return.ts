/**
 * Tracks where the user opened a voucher detail page from, so the Back
 * button (and post-delete navigation) can return them to that exact screen
 * — Day Book, Ledger, Sales Register, Vouchers list, Bank, etc. — instead
 * of always dumping them on /app/vouchers.
 *
 * Implementation: any caller that navigates into /app/vouchers/$voucherId
 * first calls markVoucherOrigin(). The voucher edit screen then uses
 * goBackFromVoucher() which prefers window.history.back() (so TanStack
 * Router's scrollRestoration restores the prior scroll position) and falls
 * back to /app/vouchers when there is no in-app history.
 */
const KEY = "voucherOrigin";

export function markVoucherOrigin(): void {
  if (typeof window === "undefined") return;
  try {
    const href = window.location.pathname + window.location.search;
    sessionStorage.setItem(KEY, href);
  } catch {
    /* ignore storage errors */
  }
}

export function hasVoucherOrigin(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!sessionStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function clearVoucherOrigin(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Navigate the user back to the screen that opened the voucher.
 * Uses history.back() so TanStack scrollRestoration kicks in.
 * Falls back to /app/vouchers if there's no recorded origin.
 */
export function goBackFromVoucher(fallback: () => void): void {
  if (hasVoucherOrigin()) {
    clearVoucherOrigin();
    window.history.back();
    return;
  }
  fallback();
}

/**
 * Single helper for "open a voucher detail page from anywhere".
 * Records the originating screen so the back button returns to it
 * (with scroll position preserved by TanStack scrollRestoration).
 *
 * Usage:
 *   const navigate = useNavigate();
 *   onClick={() => openVoucherDetail(navigate, voucherId)}
 *
 * The `navigate` argument is typed as a generic callable to avoid
 * pulling TanStack types into this module — every TanStack
 * `useNavigate()` return value is compatible with this signature.
 */
type NavigateFn = (opts: {
  to: "/app/vouchers/$voucherId";
  params: { voucherId: string };
}) => void | Promise<unknown>;

export function openVoucherDetail(navigate: NavigateFn, voucherId: string): void {
  markVoucherOrigin();
  void navigate({ to: "/app/vouchers/$voucherId", params: { voucherId } });
}
