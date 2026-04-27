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
      const txt = tc.items
        .map((it) => ("str" in it ? (it as { str: string }).str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
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
        if ((pages[p - 1] ?? "").length < data.text.length) pages[p - 1] = data.text;
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
