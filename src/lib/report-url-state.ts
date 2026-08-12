/**
 * Single shared return-state mechanism for every report screen that
 * supports drill-down into a voucher (Cash & Bank Book, Ledger Statement,
 * Day Book, Sales Register, etc.).
 *
 * Why this exists
 * ---------------
 * When the user drills from a report into a voucher and comes back, the
 * report component re-mounts. The only reliable place to keep its
 * "selected ledger + date range + view mode" is the URL search string,
 * because that is what `window.history.back()` (via TanStack scroll
 * restoration) restores. If any report keeps that state only in
 * `useState`, the round-trip loses it and the user lands on a blank
 * screen — which has been reported repeatedly.
 *
 * Instead of re-implementing the same "mirror state to URL" `useEffect`
 * on every report, all reports call `useReportUrlSync` with:
 *   - `to`      : the route id (e.g. "/app/reports/ledger")
 *   - `current` : the current parsed search object (from
 *                 `Route.useSearch()`)
 *   - `next`    : the live state that should be reflected in the URL
 *
 * The hook diffs `current` vs `next` and issues a single
 * `navigate({ replace: true })` when they differ. That is the ONE place
 * where report state gets pushed into the URL — so drill / back always
 * restores exactly what the user was seeing.
 */
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

type Primitive = string | number | boolean | undefined | null;
type SearchLike = Record<string, Primitive>;

function shallowEqual(a: SearchLike, b: SearchLike): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    // Treat undefined / null / "" as equivalent so we don't churn URLs.
    const aEmpty = av === undefined || av === null || av === "";
    const bEmpty = bv === undefined || bv === null || bv === "";
    if (aEmpty && bEmpty) continue;
    if (av !== bv) return false;
  }
  return true;
}

export function useReportUrlSync<T extends SearchLike>(opts: {
  to: string;
  current: T;
  next: T;
  /** When false, skip syncing (e.g. before the initial data is loaded). */
  enabled?: boolean;
}): void {
  const { to, current, next, enabled = true } = opts;
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return;
    if (shallowEqual(current, next)) return;
    void navigate({ to: to as never, search: next as never, replace: true });
    // We intentionally depend on the JSON serialization of next so we
    // don't have to enumerate every field at each call-site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, to, JSON.stringify(current), JSON.stringify(next)]);
}
