// Loads and registers the Noto Sans Gujarati font into a jsPDF instance so
// reports/invoices can render Gujarati glyphs. The TTF binaries live in
// src/assets/fonts and are fetched on demand (cached after first call).
import type jsPDF from "jspdf";
import regularUrl from "@/assets/fonts/NotoSansGujarati-Regular.ttf?url";
import boldUrl from "@/assets/fonts/NotoSansGujarati-Bold.ttf?url";
import { getStoredLang, type LangCode } from "@/lib/i18n";

export const GU_FONT_FAMILY = "NotoGujarati";

let cache: Promise<{ regular: string; bold: string }> | null = null;

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load font ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  // base64 encode without blowing the call stack on large buffers
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function loadGujaratiFontData() {
  if (!cache) {
    cache = Promise.all([fetchAsBase64(regularUrl), fetchAsBase64(boldUrl)]).then(
      ([regular, bold]) => ({ regular, bold }),
    );
  }
  return cache;
}

/** Register the Gujarati font on the given jsPDF instance (no-op if already registered). */
export async function ensureGujaratiFont(doc: jsPDF): Promise<void> {
  const fonts = doc.getFontList?.() || {};
  if (fonts[GU_FONT_FAMILY]?.length) return;
  const { regular, bold } = await loadGujaratiFontData();
  doc.addFileToVFS("NotoSansGujarati-Regular.ttf", regular);
  doc.addFont("NotoSansGujarati-Regular.ttf", GU_FONT_FAMILY, "normal");
  doc.addFileToVFS("NotoSansGujarati-Bold.ttf", bold);
  doc.addFont("NotoSansGujarati-Bold.ttf", GU_FONT_FAMILY, "bold");
}

/** Returns the font family that should be used for the active language. */
export function reportFontFamily(lang: LangCode = getStoredLang()): string {
  return lang === "gu" ? GU_FONT_FAMILY : "helvetica";
}

/** Convenience: ensure font loaded (only if needed) and return the family. */
export async function prepareReportFont(doc: jsPDF, lang: LangCode = getStoredLang()): Promise<string> {
  if (lang === "gu") {
    await ensureGujaratiFont(doc);
    return GU_FONT_FAMILY;
  }
  return "helvetica";
}
