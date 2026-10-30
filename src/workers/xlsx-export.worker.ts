// Off-main-thread XLSX writer. All heavy ExcelJS work happens here so the
// UI thread stays responsive when exporting large ledgers (100 MB+ workbooks
// were freezing the app when the same work ran on the main thread).
//
// Contract:
//   postMessage({ sheets, anyStyled }) -> ArrayBuffer via Transferable
//   Progress:  { type: "progress", stage, rowsDone }
//   Success:   { type: "done", buffer }
//   Failure:   { type: "error", message }

import { writeSpreadsheet, type SheetCell, type WriteSheet } from "../lib/spreadsheet";

export type WorkerCell = SheetCell;

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

self.addEventListener("message", async (ev: MessageEvent<WorkerRequest>) => {
  try {
    const { sheets, anyStyled } = ev.data;
    const buffer = await writeSpreadsheet(sheets as WriteSheet[], {
      styled: anyStyled,
      onProgress: (rowsDone, stage) => {
        (self as unknown as Worker).postMessage({ type: "progress", stage, rowsDone });
      },
    });
    (self as unknown as Worker).postMessage({ type: "done", buffer }, [buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
