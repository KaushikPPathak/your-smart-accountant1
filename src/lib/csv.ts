// Minimal CSV exporter — routes through the desktop saver when available.
import { saveExport } from "./desktop-save";

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}

export function downloadCsv(filename: string, rows: (string | number)[][], subFolder = "Reports"): void {
  void saveExport({
    subFolder,
    fileName: filename,
    contents: toCsv(rows),
    mime: "text/csv;charset=utf-8",
  });
}
