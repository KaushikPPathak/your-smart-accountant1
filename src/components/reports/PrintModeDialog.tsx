import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, FileText, FileType2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { tReportText } from "@/lib/report-i18n-rules";

export type PrintMode = "preview" | "system" | "pdf" | "word";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (mode: PrintMode) => void;
  /** Disable the PDF / Word options when the host report has not wired them. */
  hasPdf?: boolean;
  hasWord?: boolean;
}

/**
 * Print mode picker — triggered by Ctrl+P inside a ReportViewer.
 */
export function PrintModeDialog({ open, onOpenChange, onPick, hasPdf = true, hasWord = true }: Props) {
  const { lang } = useI18n();
  const tt = (s: string) => tReportText(s, lang);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tt("Print this report")}</DialogTitle>
          <DialogDescription>
            {tt("Choose where to send the report.")} <kbd className="rounded border bg-muted px-1 text-xs">Esc</kbd>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 pt-2">
          <ModeButton
            icon={<Eye className="h-5 w-5" />}
            label={tt("Print Preview")}
            hint={tt("Opens a preview window with the report formatted for print.")}
            shortcut="V"
            onClick={() => onPick("preview")}
          />
          <ModeButton
            icon={<Printer className="h-5 w-5" />}
            label={tt("System Printer")}
            hint={tt("Opens the browser print dialog (your Windows default printer).")}
            shortcut="P"
            onClick={() => onPick("system")}
          />
          <ModeButton
            icon={<FileText className="h-5 w-5" />}
            label={tt("Save as PDF")}
            hint={tt("Generates a print-ready PDF in your Reports folder.")}
            shortcut="D"
            disabled={!hasPdf}
            onClick={() => onPick("pdf")}
          />
          <ModeButton
            icon={<FileType2 className="h-5 w-5" />}
            label={tt("Save as Word (.doc)")}
            hint={tt("Editable Word document with the same table layout.")}
            shortcut="W"
            disabled={!hasWord}
            onClick={() => onPick("word")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({
  icon,
  label,
  hint,
  shortcut,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  shortcut: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border border-border bg-background p-3 text-left transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "cursor-not-allowed opacity-50 hover:bg-background hover:text-foreground",
      )}
    >
      <div className="mt-0.5 text-primary">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{label}</span>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono">{shortcut}</kbd>
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </button>
  );
}
