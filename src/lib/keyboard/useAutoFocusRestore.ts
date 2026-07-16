import { useCallback, useRef } from "react";

/**
 * Unified focus-restore behavior for Radix popup primitives (Dialog,
 * AlertDialog, Popover, DropdownMenu, Sheet, ...).
 *
 * Radix restores focus to the trigger by default, but only when the popup
 * was opened via that trigger. When a popup is opened programmatically
 * (state-driven `open` prop), no trigger is tracked and focus lands on
 * `<body>` after close. This hook fixes both cases uniformly:
 *
 *   • `onOpenAutoFocus`  → snapshot `document.activeElement` before Radix
 *                          moves focus into the popup.
 *   • `onCloseAutoFocus` → `preventDefault()` and refocus the snapshotted
 *                          element after React commits.
 *
 * Spread the returned handlers on the primitive's `<Content>` element. Any
 * user-provided handlers passed to the wrapper are still invoked, so this
 * layer composes rather than replaces.
 */
export function useAutoFocusRestore(
  userOnOpen?: (e: Event) => void,
  userOnClose?: (e: Event) => void,
) {
  const savedRef = useRef<HTMLElement | null>(null);

  const onOpenAutoFocus = useCallback(
    (e: Event) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body) savedRef.current = el;
      userOnOpen?.(e);
    },
    [userOnOpen],
  );

  const onCloseAutoFocus = useCallback(
    (e: Event) => {
      userOnClose?.(e);
      if (e.defaultPrevented) return;
      const el = savedRef.current;
      if (el && document.contains(el)) {
        e.preventDefault();
        queueMicrotask(() => {
          try {
            el.focus({ preventScroll: true });
          } catch {
            /* ignore */
          }
        });
      }
    },
    [userOnClose],
  );

  return { onOpenAutoFocus, onCloseAutoFocus };
}
