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
    // Buttons normally activate on Enter, but our Combo trigger uses
    // <button role="combobox"> and should advance like a field once a value
    // is selected (popover closed). Submit/icon buttons fall through.
    if (tag === "BUTTON" && t.getAttribute("role") !== "combobox") return;
    // Radix Select / Combo trigger has role=combobox.
    //  - Expanded → let it handle Enter (pick option).
    //  - Closed but NO value selected yet → open it instead of skipping past.
    //    This prevents a double-Enter after the date field from jumping over
    //    an empty bank/party combo.
    if (t.getAttribute("role") === "combobox") {
      if (t.getAttribute("aria-expanded") === "true") return;
      const hasValue =
        (t.getAttribute("data-has-value") === "true") ||
        !!t.getAttribute("data-value") ||
        // Fallback: consider it "empty" if it exposes an aria-label that still
        // matches the placeholder pattern. Safer default is to open when we
        // can't confirm a value is set.
        false;
      if (!hasValue) {
        e.preventDefault();
        t.click();
        return;
      }
    }

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
