// Move keyboard focus to the next field in DOM order.
// Used for auto-advance after a dropdown or picker choice, so the cursor
// moves on without the user pressing Tab or Enter.

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus the field after `from` (or stay on `from` if it is the last one). */
export function focusNextField(from: Element | null): void {
  if (!(from instanceof HTMLElement)) return;
  const root =
    (from.closest("form") as HTMLElement | null) ||
    (from.closest("[data-fast-form]") as HTMLElement | null) ||
    document.body;
  const list = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === from,
  );
  const idx = list.indexOf(from);
  const target = idx >= 0 && list[idx + 1] ? list[idx + 1] : from;
  target.focus();
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    try { target.select(); } catch { /* not selectable */ }
  }
}

/**
 * After a dropdown choice. Radix returns focus to the trigger when the list
 * closes, which happens just after the value changes, so wait one tick first.
 */
export function focusNextAfterChoice(): void {
  window.setTimeout(() => focusNextField(document.activeElement), 30);
}
