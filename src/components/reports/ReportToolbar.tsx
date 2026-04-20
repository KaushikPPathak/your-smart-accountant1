import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";

interface Props {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onExport?: () => void;
  onPrint?: () => void;
  extra?: React.ReactNode;
}

export function ReportToolbar({ from, to, onFrom, onTo, onExport, onPrint, extra }: Props) {
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="space-y-1">
        <Label className="text-xs">From</Label>
        <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="h-9 w-[160px]" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">To</Label>
        <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="h-9 w-[160px]" />
      </div>
      {extra}
      <div className="ml-auto flex gap-2">
        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
        )}
        {onPrint && (
          <Button variant="outline" size="sm" onClick={() => (onPrint ? onPrint() : window.print())}>
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
