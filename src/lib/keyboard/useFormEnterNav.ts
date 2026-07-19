import * as React from "react";

const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="combobox"]:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

interface Options {
  /**
   * Fired when Enter is pressed on the last field AND no primary-action button
   * is present inside the scope. When a `[data-primary-action="true"]` element
   * exists, Enter on the last field focuses that button instead; a second Enter
   * on the button clicks it (which is the expected submit path).
   */
  onLast?: () => void;
}

/**
 * Centralized Enter/Shift+Enter navigation for accounting forms. Belongs to the
 * keyboard engine so every voucher / master screen behaves identically:
 *
 *   Enter          → focus next field (never submits by accident)
 *   Shift+Enter    → focus previous field
 *   Enter on last  → focus `[data-primary-action="true"]` if present.
 *                    A second Enter on that button clicks (submits).
 *                    Fallback: `onLast()` when no such button is tagged.
 *   Enter in textarea → newline (unchanged)
 *   Enter on combobox → let Radix handle it; if closed and empty, open it.
 *   ArrowLeft at caret-0 (no selection) → focus previous field. Asymmetric
 *     back-nav only; ArrowRight is intentionally NOT bound so it can't
 *     conflict with dropdowns, the entry-row grid, or number editing.
 */
export function useFormEnterNav<T extends HTMLElement = HTMLDivElement>(opts: Options = {}) {
  const ref = React.useRef<T | null>(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const focusablesIn = (root: HTMLElement, current: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((el) => el.offsetParent !== null || el === current);

  const focusEl = (el: HTMLElement) => {
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try { el.select(); } catch { /* noop */ }
    }
  };

  const onKeyDown: React.KeyboardEventHandler<T> = (e) => {
    const t = e.target as HTMLElement;

    // ArrowLeft — asymmetric back-nav when the caret is at position 0 with
    // no selection. For non-text controls (button, combobox, checkbox…),
    // any ArrowLeft press qualifies since there is no caret to move.
    if (
      e.key === "ArrowLeft" &&
      !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
    ) {
      // Skip when a dropdown / popover is open — Radix owns ← in that context.
      const insideOpenPopup = t.closest('[data-state="open"]');
      // Skip inside contentEditable regions.
      const editable = t.isContentEditable;
      if (!insideOpenPopup && !editable) {
        let atStart = true;
        if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
          const type = (t as HTMLInputElement).type;
          // Some input types don't support selection APIs (number, date…).
          // For those we can't safely detect caret-0, so bail out.
          const noCaretApi = ["number", "date", "time", "datetime-local", "month", "week", "email", "range", "color"].includes(type);
          if (noCaretApi) {
            atStart = false;
          } else {
            const s = t.selectionStart;
            const eSel = t.selectionEnd;
            atStart = s === 0 && eSel === 0;
          }
        }
        if (atStart) {
          const root = ref.current;
          if (root) {
            const list = focusablesIn(root, t);
            const idx = list.indexOf(t);
            if (idx > 0) {
              e.preventDefault();
              focusEl(list[idx - 1]);
              return;
            }
          }
        }
      }
    }

    if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = t.tagName;
    if (tag === "TEXTAREA") return;

    // Primary-action button: Enter here clicks it (submits).
    if (t.getAttribute("data-primary-action") === "true") return;

    // Regular buttons keep native Enter-to-activate.
    if (tag === "BUTTON" && t.getAttribute("role") !== "combobox") return;

    // Radix combobox / Select trigger.
    if (t.getAttribute("role") === "combobox") {
      if (t.getAttribute("aria-expanded") === "true") return;
      const hasValue =
        (t.getAttribute("data-has-value") === "true") ||
        !!t.getAttribute("data-value");
      if (!hasValue && !e.shiftKey) {
        e.preventDefault();
        t.click();
        return;
      }
    }

    const root = ref.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null || el === t);
    const idx = focusables.indexOf(t);
    if (idx === -1) return;

    e.preventDefault();
    const step = e.shiftKey ? -1 : 1;
    const nextIdx = idx + step;

    if (nextIdx >= 0 && nextIdx < focusables.length) {
      const next = focusables[nextIdx];
      next.focus();
      if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
        try { next.select(); } catch { /* noop */ }
      }
      return;
    }

    // Off the end. Shift+Enter at the top → do nothing.
    if (e.shiftKey) return;

    // Past the last field: prefer focusing the primary-action button so a
    // second Enter submits deliberately. Fall back to legacy onLast() when
    // the form has not yet been tagged.
    const primary = root.querySelector<HTMLElement>('[data-primary-action="true"]:not([disabled])');
    if (primary) {
      primary.focus();
      return;
    }
    optsRef.current.onLast?.();
  };

  return { ref, onKeyDown };
}
