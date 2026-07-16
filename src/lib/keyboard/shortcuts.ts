/**
 * Combo parsing + matching. Deliberately dependency-free so tests are trivial.
 */

export interface ParsedCombo {
  key: string; // lowercased key name, e.g. "s", "enter", "arrowdown", "f1"
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

const MOD_TOKENS = new Set(["alt", "ctrl", "control", "meta", "cmd", "command", "shift"]);

export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  // The last non-modifier part is the key; everything else may be modifiers.
  let key = "";
  const mods = { alt: false, ctrl: false, meta: false, shift: false };
  for (const p of parts) {
    if (MOD_TOKENS.has(p)) {
      if (p === "alt") mods.alt = true;
      else if (p === "ctrl" || p === "control") mods.ctrl = true;
      else if (p === "meta" || p === "cmd" || p === "command") mods.meta = true;
      else if (p === "shift") mods.shift = true;
    } else {
      key = p;
    }
  }
  return { key, ...mods };
}

export function matchCombo(e: KeyboardEvent, c: ParsedCombo): boolean {
  return (
    e.key.toLowerCase() === c.key &&
    e.altKey === c.alt &&
    e.ctrlKey === c.ctrl &&
    e.metaKey === c.meta &&
    e.shiftKey === c.shift
  );
}

/** True when the event target is a text-entry surface where shortcuts should
 *  normally be suppressed. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    // buttons/checkboxes/radios are not typing surfaces.
    return !["button", "submit", "reset", "checkbox", "radio", "file"].includes(type);
  }
  return false;
}
