/**
 * Keyboard engine types. Kept intentionally small — the engine grows by adding
 * more scope tags, not by widening these interfaces.
 */

export type ShortcutScope =
  | "global"
  | "voucher"
  | "report"
  | "grid"
  | "dialog"
  | "menubar";

export interface ShortcutBinding {
  /** Stable id (usually a useId() value). */
  id: string;
  /** Human combo string, e.g. "Alt+S", "F1", "Ctrl+Enter", "Shift+?". */
  combo: string;
  /** Only fires when this scope is active or scope === "global". */
  scope: ShortcutScope;
  /** If true, the shortcut still fires while the user is typing in a field. */
  allowInField?: boolean;
  /** Handler. Call e.preventDefault() to stop further bindings. */
  handler: (e: KeyboardEvent) => void;
  /** Optional label for a future cheatsheet UI. */
  description?: string;
}
