// Byte and text helpers shared by the Tally XML readers.
//
// Tally writes UTF-8 or UTF-16 (LE/BE, with a BOM), and its exports can contain
// characters that XML 1.0 forbids (raw control bytes, references such as &#4;).
// Strict XML parsers reject those files, so the readers here tolerate them.

export type TallyTextEncoding = "utf-8" | "utf-16le" | "utf-16be";

/** Encoding from the first two bytes (byte-order mark). Defaults to UTF-8. */
export function encodingFromBom(bom: Uint8Array): TallyTextEncoding {
  if (bom[0] === 0xff && bom[1] === 0xfe) return "utf-16le";
  if (bom[0] === 0xfe && bom[1] === 0xff) return "utf-16be";
  return "utf-8";
}

export async function detectFileEncoding(file: Blob): Promise<TallyTextEncoding> {
  return encodingFromBom(new Uint8Array(await file.slice(0, 2).arrayBuffer()));
}

// XML 1.0 forbids these code points, including the two non-characters.
const FORBIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function stripInvalidXmlChars(text: string): string {
  return text.replace(FORBIDDEN_CHARS, "");
}

function isXmlChar(cp: number): boolean {
  return cp === 0x9 || cp === 0xa || cp === 0xd
    || (cp >= 0x20 && cp <= 0xd7ff)
    || (cp >= 0xe000 && cp <= 0xfffd)
    || (cp >= 0x10000 && cp <= 0x10ffff);
}

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/**
 * Decode XML entities in one pass. Numeric references that name a forbidden
 * character (for example &#4;) are dropped instead of throwing.
 */
export function decodeXmlText(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const hex = ref[1] === "x" || ref[1] === "X";
      const cp = hex ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return isXmlChar(cp) ? String.fromCodePoint(cp) : "";
    }
    return NAMED[ref] ?? whole;
  });
}

/**
 * Read the whole file as text, chunk by chunk. Only one chunk is held at a
 * time, so files well over 100 MB are never loaded in one piece.
 */
export async function* readTextChunks(file: Blob): AsyncGenerator<string> {
  const encoding = await detectFileEncoding(file);
  const decoder = new TextDecoder(encoding);
  const reader = file.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) yield stripInvalidXmlChars(text);
  }
  const tail = decoder.decode();
  if (tail) yield stripInvalidXmlChars(tail);
}

/** First bytes of the file as text, for format detection. */
export async function readHeadText(file: Blob, bytes = 8192): Promise<string> {
  const encoding = await detectFileEncoding(file);
  const raw = new Uint8Array(await file.slice(0, bytes).arrayBuffer());
  return stripInvalidXmlChars(new TextDecoder(encoding).decode(raw));
}
