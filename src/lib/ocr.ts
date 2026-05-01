// 100% offline document text extraction.
// PDFs → pdfjs-dist (text layer); falls back to Tesseract OCR per page if no text.
// Images (PNG/JPG/etc) → Tesseract OCR.
// Bundled assets so the desktop .exe works with zero internet.
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker, type Worker as TWorker } from "tesseract.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface OcrProgress {
  stage: "loading" | "pdf-text" | "ocr" | "done";
  page?: number;
  totalPages?: number;
  pct?: number; // 0-100
}

export type OcrProgressCb = (p: OcrProgress) => void;

let _worker: TWorker | null = null;
async function getWorker(onProgress?: OcrProgressCb): Promise<TWorker> {
  if (_worker) return _worker;
  _worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (onProgress && (m.status === "recognizing text" || m.status === "loading"))
        onProgress({ stage: "ocr", pct: Math.round(m.progress * 100) });
    },
  });
  return _worker;
}

/** Render a PDF page to a canvas at 2× scale and return as ImageData URL for Tesseract. */
async function pageToImageData(page: pdfjsLib.PDFPageProxy): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

function isReadablePdfText(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 30) return false;
  const asciiLetters = compact.match(/[A-Za-z]/g)?.length ?? 0;
  const controls = compact.match(/[\u0000-\u001f\u007f-\u009f]/g)?.length ?? 0;
  const commonWords = text.match(/\b(balance|sheet|trial|account|assets?|liabilit(y|ies)|funds?|total|amount|cash|bank)\b/gi)?.length ?? 0;
  return controls / compact.length < 0.08 && (asciiLetters >= 20 || commonWords >= 2);
}

// ---------------------------------------------------------------------------
// Coordinate-aware text reconstruction.
// Many Indian balance sheets (Tally / Busy print-outs) are TWO columns:
// "Liabilities | Assets" side-by-side. A naive join("\n") merges both columns
// into one line, so the trial-balance parser sees garbage. We group glyphs by
// their Y position into visual rows, detect a vertical column split (either an
// explicit "|" glyph or a wide X-gap that repeats across rows), then emit the
// left column first and the right column afterwards as separate lines.
// ---------------------------------------------------------------------------
interface PdfGlyph { x: number; y: number; w: number; s: string }

function reconstructPageText(items: { str: string; transform: number[]; width?: number }[]): string {
  const glyphs: PdfGlyph[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    glyphs.push({
      x: it.transform[4],
      y: it.transform[5],
      w: it.width ?? it.str.length * 4,
      s: it.str,
    });
  }
  if (glyphs.length === 0) return "";

  // Bucket glyphs into rows by Y (tolerance of a few points).
  const rows = new Map<number, PdfGlyph[]>();
  const yTol = 3;
  for (const g of glyphs) {
    let key = -1;
    for (const k of rows.keys()) if (Math.abs(k - g.y) <= yTol) { key = k; break; }
    if (key === -1) key = Math.round(g.y);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key)!.push(g);
  }
  // Top → bottom (PDF Y grows upwards).
  const sortedRows = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, arr]) => {
    arr.sort((a, b) => a.x - b.x);
    return arr;
  });

  // Detect a vertical column split.
  // 1. Explicit "|" glyph that appears in many rows at roughly the same x.
  // 2. Otherwise a consistent wide X-gap inside a row, present in ≥40% of rows.
  const pageMaxX = Math.max(...glyphs.map((g) => g.x + g.w));
  let splitX: number | null = null;

  const pipeXs: number[] = [];
  for (const row of sortedRows) for (const g of row) if (g.s.trim() === "|") pipeXs.push(g.x);
  if (pipeXs.length >= Math.max(3, sortedRows.length * 0.25)) {
    pipeXs.sort((a, b) => a - b);
    splitX = pipeXs[Math.floor(pipeXs.length / 2)];
  } else {
    // Look for a wide gap shared by many rows.
    const gapVotes = new Map<number, number>();
    for (const row of sortedRows) {
      if (row.length < 2) continue;
      let bestGap = 0; let bestMid = 0;
      for (let i = 1; i < row.length; i++) {
        const gap = row[i].x - (row[i - 1].x + row[i - 1].w);
        if (gap > bestGap) { bestGap = gap; bestMid = (row[i].x + row[i - 1].x + row[i - 1].w) / 2; }
      }
      // Gap must be >12% of page width to be a column separator.
      if (bestGap > pageMaxX * 0.12) {
        const bucket = Math.round(bestMid / 20) * 20;
        gapVotes.set(bucket, (gapVotes.get(bucket) || 0) + 1);
      }
    }
    let bestBucket = 0; let bestVotes = 0;
    for (const [b, v] of gapVotes) if (v > bestVotes) { bestVotes = v; bestBucket = b; }
    if (bestVotes >= Math.max(4, sortedRows.length * 0.4)) splitX = bestBucket;
  }

  const rowToText = (row: PdfGlyph[]) =>
    row.map((g) => g.s).join(" ").replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();

  if (splitX === null) {
    // Single-column page — emit rows top-to-bottom.
    return sortedRows.map(rowToText).filter(Boolean).join("\n");
  }

  // Two-column: split each row, emit ALL left rows first, then ALL right rows.
  // This way the trial-balance parser walks Liabilities top-to-bottom, then
  // Assets top-to-bottom — without amounts from the opposite column polluting
  // the line.
  const leftLines: string[] = [];
  const rightLines: string[] = [];
  for (const row of sortedRows) {
    const left = row.filter((g) => g.x < splitX! && g.s.trim() !== "|");
    const right = row.filter((g) => g.x >= splitX! && g.s.trim() !== "|");
    const lt = rowToText(left);
    const rt = rowToText(right);
    if (lt) leftLines.push(lt);
    if (rt) rightLines.push(rt);
  }
  return [...leftLines, ...rightLines].filter(Boolean).join("\n");
}

export async function extractTextFromFile(
  file: File,
  onProgress?: OcrProgressCb,
): Promise<string> {
  onProgress?.({ stage: "loading" });
  const buf = new Uint8Array(await file.arrayBuffer());
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages: string[] = [];
    let needOcr = false;
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.({ stage: "pdf-text", page: p, totalPages: pdf.numPages });
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const textItems = tc.items
        .filter((it) => "str" in it && "transform" in it)
        .map((it) => {
          const ti = it as { str: string; transform: number[]; width?: number };
          return { str: ti.str, transform: ti.transform, width: ti.width };
        });
      const txt = reconstructPageText(textItems);
      if (!isReadablePdfText(txt)) needOcr = true;
      pages.push(txt);
    }
    // If most pages had no text layer (scanned PDF), OCR them.
    if (needOcr) {
      const w = await getWorker(onProgress);
      for (let p = 1; p <= pdf.numPages; p++) {
        onProgress?.({ stage: "ocr", page: p, totalPages: pdf.numPages });
        const page = await pdf.getPage(p);
        const canvas = await pageToImageData(page);
        const { data } = await w.recognize(canvas);
        if (!isReadablePdfText(pages[p - 1] ?? "") || (pages[p - 1] ?? "").length < data.text.length) {
          pages[p - 1] = data.text;
        }
      }
    }
    onProgress?.({ stage: "done" });
    return pages.join("\n\n--- PAGE BREAK ---\n\n");
  }

  // Image: OCR directly
  const w = await getWorker(onProgress);
  const url = URL.createObjectURL(file);
  try {
    const { data } = await w.recognize(url);
    onProgress?.({ stage: "done" });
    return data.text;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function terminateOcrWorker(): Promise<void> {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
  }
}
