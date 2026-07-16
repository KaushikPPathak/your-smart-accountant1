import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { FyDatePicker, useFyRange } from "@/components/ui/fy-date-picker";
import { format } from "date-fns";
import * as React from "react";
import { useI18n } from "@/lib/i18n";
import { tReportText } from "@/lib/report-i18n-rules";
import { useShortcut, useOptionalKeyboard } from "@/lib/keyboard";


interface Props {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onExportCsv?: () => void;
  onExportPdf?: () => void;
  onExportXlsx?: () => void;
  onPrint?: () => void;
  extra?: React.ReactNode;
  hideDates?: boolean;
}

export function ReportToolbar({
  from,
  to,
  onFrom,
  onTo,
  onExportCsv,
  onExportPdf,
  onExportXlsx,
  onPrint,
  extra,
  hideDates,
}: Props) {
  const { lang } = useI18n();
  const tt = (s: string) => tReportText(s, lang);

  // Push a "report" scope while this toolbar is mounted so report-scoped
  // shortcuts win over global bindings on report screens.
  const kb = useOptionalKeyboard();
  React.useEffect(() => {
    if (!kb) return;
    return kb.pushScope("report");
  }, [kb]);

  // Centralized report shortcuts. Never fire while typing in date pickers /
  // filter inputs (allowInField defaults to false).
  useShortcut("Ctrl+P", (e) => {
    if (!onPrint) return;
    e.preventDefault();
    onPrint();
  }, { scope: "report", description: "Print report" });
  useShortcut("Ctrl+E", (e) => {
    const fn = onExportXlsx ?? onExportCsv ?? onExportPdf;
    if (!fn) return;
    e.preventDefault();
    fn();
  }, { scope: "report", description: "Export report" });
  useShortcut("Ctrl+Shift+E", (e) => {
    if (!onExportCsv) return;
    e.preventDefault();
    onExportCsv();
  }, { scope: "report", description: "Export CSV" });

  return (

    <div className="flex flex-wrap items-end gap-3 print:hidden">
      {!hideDates && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">{tt("From Date")}</Label>
            <FyDatePicker value={from} onChange={onFrom} className="w-[170px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{tt("To Date")}</Label>
            <FyDatePicker value={to} onChange={onTo} className="w-[170px]" />
          </div>
        </>
      )}
      {extra}
      <div className="ml-auto flex gap-2">
        {onExportCsv && (
          <Button variant="outline" size="sm" onClick={onExportCsv}>
            <Download className="mr-1 h-4 w-4" /> {tt("CSV")}
          </Button>
        )}
        {onExportXlsx && (
          <Button variant="outline" size="sm" onClick={onExportXlsx}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> {tt("Excel")}
          </Button>
        )}
        {onExportPdf && (
          <Button variant="outline" size="sm" onClick={onExportPdf}>
            <FileText className="mr-1 h-4 w-4" /> {tt("PDF")}
          </Button>
        )}
        {onPrint && (
          <Button variant="outline" size="sm" onClick={onPrint}>
            <Printer className="mr-1 h-4 w-4" /> {tt("Print")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function defaultFyRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

/** Returns from/to ISO strings for the active company's financial year.
 *  Falls back to the calendar-derived FY when no company is loaded. */
export function useFyRangeStrings(): { from: string; to: string } {
  const { start, end } = useFyRange();
  return React.useMemo(
    () => ({ from: format(start, "yyyy-MM-dd"), to: format(end, "yyyy-MM-dd") }),
    [start, end],
  );
}

/** Reactive [from, to] state seeded from the active company's FY.
 *  Auto-resyncs to the FY when the company changes, unless the user has
 *  manually edited the values. */
export function useFyRangeState(initialFrom?: string, initialTo?: string): {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
} {
  const fy = useFyRangeStrings();
  const [from, setFromState] = React.useState(initialFrom ?? fy.from);
  const [to, setToState] = React.useState(initialTo ?? fy.to);
  const lastFy = React.useRef(fy);
  const userEdited = React.useRef(!!(initialFrom || initialTo));
  React.useEffect(() => {
    if (lastFy.current.from === fy.from && lastFy.current.to === fy.to) return;
    lastFy.current = fy;
    if (!userEdited.current) {
      setFromState(fy.from);
      setToState(fy.to);
    }
  }, [fy]);
  const setFrom = React.useCallback((v: string) => { userEdited.current = true; setFromState(v); }, []);
  const setTo = React.useCallback((v: string) => { userEdited.current = true; setToState(v); }, []);
  return { from, to, setFrom, setTo };
}

/** Reactive single-date state, defaulting to today if it's inside the FY,
 *  otherwise to the FY end date. */
export function useFyAsOfState(): { asOf: string; setAsOf: (v: string) => void } {
  const fy = useFyRangeStrings();
  const compute = React.useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (today >= fy.from && today <= fy.to) return today;
    return fy.to;
  }, [fy]);
  const [asOf, setAsOfState] = React.useState(compute);
  const lastFy = React.useRef(fy);
  const userEdited = React.useRef(false);
  React.useEffect(() => {
    if (lastFy.current.from === fy.from && lastFy.current.to === fy.to) return;
    lastFy.current = fy;
    if (!userEdited.current) setAsOfState(compute());
  }, [fy, compute]);
  const setAsOf = React.useCallback((v: string) => { userEdited.current = true; setAsOfState(v); }, []);
  return { asOf, setAsOf };
}
