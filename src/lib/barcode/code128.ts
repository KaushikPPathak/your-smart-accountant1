/**
 * Code 128 (Code Set B) encoder for item barcodes and shelf labels.
 *
 * Set B covers printable ASCII (space to ~), which is what item codes use.
 * The output is the module string: "1" is a bar, "0" a space, including the
 * start code, the checksum and the stop pattern.
 */
import { CODE128_PATTERNS } from "./code128-patterns";

const START_B = 104;
const STOP = 106;

/** True when the text can be encoded in Code Set B. */
export function canEncodeCode128B(text: string): boolean {
  return text.length > 0 && /^[\x20-\x7e]+$/.test(text);
}

/** Module string (bars and spaces) for the text. Throws for characters Set B cannot encode. */
export function code128Modules(text: string): string {
  if (!canEncodeCode128B(text)) {
    throw new Error("Barcode text must be printable ASCII (letters, digits, symbols; no accents).");
  }
  const values = [START_B];
  for (const ch of text) values.push(ch.charCodeAt(0) - 32);
  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  values.push(STOP);
  return values.map((v) => CODE128_PATTERNS[v]).join("");
}
