// Off-main-thread XLSX writer. All heavy SheetJS work happens here so the
// UI thread stays responsive when exporting large ledgers (100 MB+ workbooks
// were freezing the app when the same work ran on the main thread).
//
// Contract:
//   postMessage({ sheets, anyStyled, headerHints }) -> ArrayBuffer via Transferable
//   Progress:  { type: "progress", stage, rowsDone, rowsTotal }
//   Success:   { type: "done", buffer }
//   Failure:   { type: "error", message }

import type * as XLSXType from "xlsx";

type CellObject = XLSXType.CellObject;
export type WorkerCell = string | number | CellObject;

export interface WorkerSheet {
  name: string;
  rows: WorkerCell[][];
  autoFilterHeaderRow?: number | null;
  styling?: "gstn";
}

export interface WorkerRequest {
  sheets: WorkerSheet[];
  anyStyled: boolean;
}

async function loadXlsx(styled: boolean): Promise<typeof XLSXType> {
  if (styled) {
    try {
      const mod = (await import("xlsx-js-style")) as unknown as
        { default?: typeof XLSXType } & typeof XLSXType;
      return (mod.default ?? mod) as typeof XLSXType;
    } catch {
      /* fall through */
    }
  }
  return await import("xlsx");
}

self.addEventListener("message", async (ev: MessageEvent<WorkerRequest>) => {
  try {
    const { sheets, anyStyled } = ev.data;
    const XLSX = await loadXlsx(anyStyled);

    // Total rows for progress
    const totalRows = sheets.reduce((s, sh) => s + sh.rows.length, 0);
    let rowsDone = 0;
    const emitProgress = (stage: string) => {
      (self as unknown as Worker).postMessage({
        type: "progress", stage, rowsDone, rowsTotal: totalRows,
      });
    };
    emitProgress("preparing");

    const wb = XLSX.utils.book_new();

    for (const s of sheets) {
      // Build sheet in row chunks so we can yield to the event loop and
      // report progress on very large data sets.
      const ws = XLSX.utils.aoa_to_sheet([]) as XLSXType.WorkSheet;
      const CHUNK = 2000;
      for (let i = 0; i < s.rows.length; i += CHUNK) {
        const slice = s.rows.slice(i, i + CHUNK);
        XLSX.utils.sheet_add_aoa(ws, slice as unknown[][], { origin: i === 0 ? "A1" : { r: i, c: 0 } });
        rowsDone += slice.length;
        emitProgress(`sheet:${s.name}`);
        // Yield so postMessage flushes and the worker can be terminated if needed.
        await new Promise((r) => setTimeout(r, 0));
      }

      // Column widths from header row
      const headerRowIdx = s.autoFilterHeaderRow ?? 0;
      const header = s.rows[headerRowIdx] ?? s.rows[0] ?? [];
      ws["!cols"] = header.map((cell) => {
        const text =
          typeof cell === "string" ? cell : (cell as CellObject)?.v ?? "";
        const len = String(text).length;
        return { wch: Math.max(10, Math.min(40, len + 4)) };
      });

      if (s.autoFilterHeaderRow !== null && header.length > 0) {
        const lastCol = header.length - 1;
        const lastRow = Math.max(headerRowIdx, s.rows.length - 1);
        const start = XLSX.utils.encode_cell({ r: headerRowIdx, c: 0 });
        const end = XLSX.utils.encode_cell({ r: lastRow, c: lastCol });
        ws["!autofilter"] = { ref: `${start}:${end}` };
      }

      if (s.styling === "gstn" && anyStyled && header.length > 0) {
        const HEADER_FILL = { patternType: "solid", fgColor: { rgb: "FF305496" } };
        const HEADER_FONT = { bold: true, color: { rgb: "FFFFFFFF" }, sz: 11, name: "Calibri" };
        const TITLE_FONT = { bold: true, sz: 14, color: { rgb: "FF000000" }, name: "Calibri" };
        const SUB_FONT = { bold: true, sz: 11, color: { rgb: "FF000000" }, name: "Calibri" };
        const CENTER = { horizontal: "center", vertical: "center" } as const;
        const BORDER_THIN = { style: "thin", color: { rgb: "FF9BB6D8" } };
        const CELL_BORDER = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
        for (let c = 0; c < header.length; c++) {
          const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
          const cell = (ws as Record<string, unknown>)[addr] as Record<string, unknown> | undefined;
          if (cell) {
            (cell as { s?: unknown }).s = {
              fill: HEADER_FILL, font: HEADER_FONT,
              alignment: { ...CENTER, wrapText: true }, border: CELL_BORDER,
            };
          }
        }
        if (headerRowIdx >= 1) {
          const t = (ws as Record<string, unknown>)[XLSX.utils.encode_cell({ r: 0, c: 0 })] as Record<string, unknown> | undefined;
          if (t) (t as { s?: unknown }).s = { font: TITLE_FONT, alignment: { horizontal: "left" } };
          ws["!merges"] = [
            ...((ws["!merges"] as XLSXType.Range[] | undefined) ?? []),
            { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, header.length - 1) } },
          ];
        }
        if (headerRowIdx >= 2) {
          for (let c = 0; c < 2; c++) {
            const cell = (ws as Record<string, unknown>)[XLSX.utils.encode_cell({ r: 1, c })] as Record<string, unknown> | undefined;
            if (cell) (cell as { s?: unknown }).s = { font: SUB_FONT };
          }
        }
        ws["!freeze"] = { xSplit: 0, ySplit: headerRowIdx + 1 } as unknown as never;
        (ws as Record<string, unknown>)["!views"] = [{ state: "frozen", ySplit: headerRowIdx + 1 }];
        const rowH: XLSXType.RowInfo[] = [];
        rowH[0] = { hpt: 22 };
        rowH[headerRowIdx] = { hpt: 30 };
        ws["!rows"] = rowH;
      }

      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    }

    emitProgress("writing");
    const buffer = XLSX.write(wb, {
      bookType: "xlsx",
      type: "array",
      cellStyles: anyStyled,
      compression: true,
    }) as ArrayBuffer;

    (self as unknown as Worker).postMessage({ type: "done", buffer }, [buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
