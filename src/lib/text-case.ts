// Capitalize the first letter of every whitespace-separated word.
// Used for master name inputs (party/ledger/item) so entries look consistent.
// Only touches the leading letter of each word — the rest of the characters
// are preserved as typed, so acronyms like "GST" or "LLP" survive if the user
// types them in caps.
export function toTitleCaseOnType(value: string): string {
  if (!value) return value;
  return value.replace(/(^|\s)(\S)/g, (_m, sep, ch) => sep + ch.toUpperCase());
}
