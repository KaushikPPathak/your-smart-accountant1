// Minimal CSV exporter — routes through the desktop saver when available.
// Serializes in row chunks with async yields so multi-million-cell exports
// (yearly ledgers, GST books) don't freeze the UI thread.
import { saveExport } from "./desktop-save";
import { showExportProgress } from "./export-progress";

const CHUNK_ROWS = 5_000;

const escapeCell = (cell: unknown): string => {
  const s = String(cell ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Synchronous — kept for callers that pass small row sets. Prefer toCsvAsync. */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\n");
}

/** Chunked, yielding CSV builder. Reports progress via the provided callback. */
export async function toCsvAsync(
  rows: (string | number)[][],
  onProgress?: (rowsDone: number) => void,
): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const slice = rows.slice(i, i + CHUNK_ROWS);
    parts.push(slice.map((r) => r.map(escapeCell).join(",")).join("\n"));
    onProgress?.(Math.min(i + CHUNK_ROWS, rows.length));
    // Yield to the event loop so the main thread stays responsive.
    await new Promise((r) => setTimeout(r, 0));
  }
  return parts.join("\n");
}

export function downloadCsv(filename: string, rows: (string | number)[][], subFolder = "Reports"): void {
  void (async () => {
    const progress = showExportProgress(filename, rows.length);
    const csv = await toCsvAsync(rows, (n) => progress.update(n));
    progress.done();
    await saveExport({
      subFolder,
      fileName: filename,
      contents: csv,
      mime: "text/csv;charset=utf-8",
    });
  })();
}
