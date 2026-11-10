import { flushSync } from "react-dom";

/**
 * Keyboard save (Ctrl+S) and Escape can fire while a field still holds an
 * uncommitted edit. Many fields commit on blur, not on keystroke, so running
 * the action directly would save the previous value. This blurs the focused
 * field inside flushSync (so its onBlur state update is applied synchronously),
 * then runs the action.
 */
export function commitActiveFieldThen(run: () => void): void {
  const el = document.activeElement as HTMLElement | null;
  if (
    el &&
    (el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement)
  ) {
    try {
      flushSync(() => el.blur());
    } catch {
      el.blur();
    }
  }
  run();
}
