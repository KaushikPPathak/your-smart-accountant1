import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Generic voucher-draft persistence.
 *
 * - Restores once on mount (or when `key` first becomes available).
 * - Debounces writes to localStorage (400 ms).
 * - Clears when the caller reports the snapshot is "empty" (blank form).
 * - Provides `discard()` for an explicit "Draft recovered — Discard" UX.
 *
 * The hook is intentionally storage-agnostic about the snapshot shape: the
 * form owns the state, this hook only handles serialization + timing.
 */
export function useVoucherDraft<T>(
  key: string | null,
  snapshot: T,
  apply: (draft: T) => void,
  isEmpty: (snap: T) => boolean,
): { restored: boolean; discard: () => void } {
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Restore once when key becomes available.
  useEffect(() => {
    if (!key || restoredRef.current) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        restoredRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as T;
      applyRef.current(parsed);
      restoredRef.current = true;
      setRestored(true);
    } catch {
      /* corrupt draft — ignore */
      restoredRef.current = true;
    }
  }, [key]);

  // Debounced persist.
  useEffect(() => {
    if (!key) return;
    if (isEmpty(snapshot)) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return;
    }
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(snapshot));
      } catch {
        /* quota — ignore */
      }
    }, 400);
    return () => clearTimeout(t);
    // We intentionally re-run whenever the snapshot reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, snapshot]);

  const discard = useCallback(() => {
    if (key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
    setRestored(false);
  }, [key]);

  return { restored, discard };
}

/** Clear a draft after a successful save. Safe to call with a null key. */
export function clearVoucherDraft(key: string | null): void {
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
