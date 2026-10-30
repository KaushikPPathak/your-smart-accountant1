import { fmtIndianDate } from "@/lib/format-date";
import { usePrintPreparing } from "@/lib/print-prepare";
import { groupBookRowsByDate, type BookPrintRow } from "@/lib/print-layout";

const amt = (p: number) =>
  p ? (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
const bal = (p: number) => {
  const v = (Math.abs(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return p === 0 ? "0.00" : `${v} ${p > 0 ? "Dr" : "Cr"}`;
};

/**
 * Print-only, date-bound book: every date starts on a fresh page with its own
 * header, day totals and (for Cash/Bank) balance brought / carried forward.
 * Rendered only while the print engine captures the report.
 */
export function DateBoundPrintBook({ rows, opening, withBalance }: {
  rows: BookPrintRow[];
  opening?: number;
  withBalance: boolean;
}) {
  const printing = usePrintPreparing();
  if (!printing) return null;
  const days = groupBookRowsByDate(rows, withBalance ? opening ?? 0 : undefined);
  const cols = withBalance ? 8 : 7;
  return (
    <div data-print-only className="hidden">
      {days.length === 0 && <p>No entries in this period.</p>}
      {days.map((day, idx) => (
        <section key={day.date} style={{ breakBefore: idx > 0 ? "page" : "auto", pageBreakBefore: idx > 0 ? "always" : "auto" }}>
          <div style={{ fontWeight: 700, margin: "4pt 0" }}>Date: {fmtIndianDate(day.date)}</div>
          <table className="report-data-table" style={{ tableLayout: "fixed", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: "10%" }}>Date</th>
                <th style={{ width: "9%" }}>Vch No</th>
                <th style={{ width: "9%" }}>Vch Type</th>
                <th style={{ width: withBalance ? "20%" : "24%" }}>Particulars</th>
                <th>Narration</th>
                <th className="num" style={{ width: "11%" }}>Debit</th>
                <th className="num" style={{ width: "11%" }}>Credit</th>
                {withBalance && <th className="num" style={{ width: "12%" }}>Balance</th>}
              </tr>
            </thead>
            <tbody>
              {withBalance && (
                <tr className="row-bold"><td colSpan={cols - 1}>Opening Balance b/f</td><td className="num">{bal(day.opening ?? 0)}</td></tr>
              )}
              {day.rows.map((row) => (
                <tr key={row.key}>
                  <td>{fmtIndianDate(row.date)}</td>
                  <td>{row.vchNo}</td>
                  <td>{row.vchType}</td>
                  <td>{row.particulars}</td>
                  <td>{row.narration}</td>
                  <td className="num">{amt(row.debit)}</td>
                  <td className="num">{amt(row.credit)}</td>
                  {withBalance && <td className="num">{bal(row.balance ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="row-bold">
                <td colSpan={5}>Day Total</td>
                <td className="num">{amt(day.debit) || "0.00"}</td>
                <td className="num">{amt(day.credit) || "0.00"}</td>
                {withBalance && <td />}
              </tr>
              {withBalance && (
                <tr className="row-bold"><td colSpan={cols - 1}>Closing Balance c/f</td><td className="num">{bal(day.closing ?? 0)}</td></tr>
              )}
            </tfoot>
          </table>
        </section>
      ))}
    </div>
  );
}
