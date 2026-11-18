import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataGrid, type DGColumn } from "@/components/data-grid/DataGrid";
import type { ReportView } from "@/components/reports/ViewSwitcher";

type Cell = string | number;
interface GridRow { __i: number; [k: string]: Cell }

function toNumber(c: Cell): number {
  if (typeof c === "number") return c;
  // Strip ₹, commas, % for number parsing
  const cleaned = String(c).replace(/[₹,\s%]/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : NaN;
}

export function GstSectionTable({
  title,
  headers,
  rows,
  view,
  reportId,
  numericFromCol = 3,
  height = 360,
}: {
  title: string;
  headers: string[];
  rows: Cell[][];
  view: ReportView;
  /** Used for grid state persistence key (combined with title) */
  reportId: string;
  /** Columns at this index and beyond are right-aligned/numeric. Default 3. */
  numericFromCol?: number;
  height?: number;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3 font-medium">{title}</div>
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No records.</div>
        ) : view === "grid" ? (
          <div className="p-3">
            <DataGrid<GridRow>
              reportId={`${reportId}::${title.replace(/\s+/g, "_").slice(0, 24)}`}
              rows={rows.map((r, i) => {
                const o: GridRow = { __i: i };
                headers.forEach((h, k) => { o[h] = r[k] ?? ""; });
                return o;
              })}
              columns={headers.map((h, idx) => {
                const isNumeric = idx >= numericFromCol;
                const col: DGColumn<GridRow> = isNumeric
                  ? {
                      id: h,
                      header: h,
                      type: "number",
                      width: 140,
                      align: "right",
                      accessor: (r) => toNumber(r[h]),
                      cell: (r) => String(r[h] ?? ""),
                      aggregator: "sum",
                    }
                  : {
                      id: h,
                      header: h,
                      type: "text",
                      width: idx === 0 ? 160 : 140,
                      accessor: (r) => String(r[h] ?? ""),
                      groupable: true,
                    };
                return col;
              })}
              globalSearch={(r) => headers.map((h) => String(r[h] ?? "")).join(" ")}
              height={height}
            />
          </div>
        ) : (
          <>
          {/* Phone: one readable card per row. The table is shown from 640px up. */}
          <div className="space-y-2 p-3 sm:hidden">
            {rows.map((r, i) => (
              <div key={i} className="rounded-lg border bg-card p-3">
                <div className="break-words text-sm font-semibold">{r[0]}</div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-sm tabular-nums">
                  {headers.slice(1).map((h, k) => (
                    <div key={k} className="min-w-0">
                      <dt className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">{h}</dt>
                      <dd className="break-words">{r[k + 1]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((h, i) => (
                  <TableHead key={i} className={i >= numericFromCol ? "text-right" : ""}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  {r.map((c, j) => (
                    <TableCell key={j} className={`${j >= numericFromCol ? "text-right font-mono" : "font-mono text-xs"}`}>{c}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
