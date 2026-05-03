import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { FyDatePicker } from "@/components/ui/fy-date-picker";

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
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      {!hideDates && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <FyDatePicker value={from} onChange={onFrom} className="w-[170px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <FyDatePicker value={to} onChange={onTo} className="w-[170px]" />
          </div>
        </>
      )}
      {extra}
      <div className="ml-auto flex gap-2">
        {onExportCsv && (
          <Button variant="outline" size="sm" onClick={onExportCsv}>
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
        )}
        {onExportXlsx && (
          <Button variant="outline" size="sm" onClick={onExportXlsx}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
          </Button>
        )}
        {onExportPdf && (
          <Button variant="outline" size="sm" onClick={onExportPdf}>
            <FileText className="mr-1 h-4 w-4" /> PDF
          </Button>
        )}
        {onPrint && (
          <Button variant="outline" size="sm" onClick={onPrint}>
            <Printer className="mr-1 h-4 w-4" /> Print
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
