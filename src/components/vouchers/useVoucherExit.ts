import { useCallback, useRef } from "react";

import { clearVoucherDraft } from "@/hooks/useVoucherDraft";
import { useShortcut } from "@/lib/keyboard/useShortcut";

interface Options {
  /** True when the voucher holds anything the user typed and not yet saved. */
  isDirty: () => boolean;
  /** Draft key to clear once the user confirms discarding. */
  draftKey?: string | null;
  /** Leave the voucher screen. */
  leave: () => void;
  /** Confirmation text shown when the voucher is dirty. */
  discardMessage: string;
}

/**
 * One exit path for every voucher form. Escape and the Cancel button both go
 * through `exit`, so the discard confirmation cannot be skipped.
 *
 * Escape calls preventDefault on every path it handles. That stops the app's
 * global staged-Escape ladder from also running (which, on a voucher route,
 * navigated back to the list and bypassed the discard prompt). It also skips
 * when an overlay such as a dropdown or dialog already consumed the key.
 */
export function useVoucherExit(opts: Options) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const exit = useCallback((): boolean => {
    const o = optsRef.current;
    if (o.isDirty()) {
      if (!window.confirm(o.discardMessage)) return false;
      clearVoucherDraft(o.draftKey ?? null);
    }
    o.leave();
    return true;
  }, []);

  useShortcut(
    "Escape",
    (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      exit();
    },
    { scope: "voucher", allowInField: true, description: "Cancel and return" },
  );

  return exit;
}
