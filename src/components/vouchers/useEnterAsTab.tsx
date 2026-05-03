import * as React from "react";

/**
 * Tally/Busy-style: Enter behaves like Tab inside the wrapped form.
 * Pressing Enter on the last focusable input fires `onLast` (save).
 * - Allows Enter in <textarea> (real newline).
 * - Skips disabled/hidden elements.
 * - Lets Radix Select / Popover handle Enter on themselves.
 */
export function useEnterAsTab(onLast?: () => void) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    const tag = t.tagName;
    if (tag === "TEXTAREA") return; // newline
    if (tag === "BUTTON") return; // let buttons activate
    // Radix Select trigger has role=combobox; Enter opens it — leave alone unless closed
    if (t.getAttribute("role") === "combobox" && t.getAttribute("aria-expanded") === "true") return;

    const root = ref.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === t);
    const idx = focusables.indexOf(t);
    if (idx === -1) return;
    e.preventDefault();
    const next = focusables[idx + 1];
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
        try { next.select(); } catch { /* noop */ }
      }
    } else if (onLast) {
      onLast();
    }
  };

  return { ref, onKeyDown };
}
