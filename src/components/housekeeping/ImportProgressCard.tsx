import { Loader2, FileText, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { estimateBand } from "@/lib/tally-busy-import";

interface Props {
  fileName: string;
  fileSize: number;
  stage: string;
  done?: number;
  total?: number;
  warn?: boolean;
  counts?: { ledgers: number; items: number; vouchers: number; unknown: number };
}

export function ImportProgressCard({
  fileName, fileSize, stage, done, total, warn, counts,
}: Props) {
  const mb = (fileSize / (1024 * 1024)).toFixed(2);
  const band = estimateBand(fileSize);
  const pct = total && total > 0 ? Math.round(((done ?? 0) / total) * 100) : null;

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm font-medium">{fileName}</span>
          <Badge variant="outline" className="text-[10px]">{mb} MB</Badge>
        </div>
        <Badge variant={warn || band.warn ? "destructive" : "secondary"} className="text-[10px]">
          Est: {band.label}
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="text-muted-foreground">{stage}</span>
        {pct !== null && <span className="ml-auto font-mono text-xs">{pct}%</span>}
      </div>
      {pct !== null && <Progress value={pct} className="h-1.5" />}
      {counts && (counts.ledgers + counts.items + counts.vouchers + counts.unknown > 0) && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant="outline" className="text-[10px]">{counts.ledgers} ledgers</Badge>
          <Badge variant="outline" className="text-[10px]">{counts.items} items</Badge>
          <Badge variant="outline" className="text-[10px]">{counts.vouchers} vouchers</Badge>
          {counts.unknown > 0 && <Badge variant="outline" className="text-[10px]">{counts.unknown} ?</Badge>}
        </div>
      )}
      {(warn || band.warn) && (
        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground pt-1">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>Large file — please don't close this tab. The browser may briefly look unresponsive while parsing.</span>
        </div>
      )}
    </div>
  );
}