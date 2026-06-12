import * as React from "react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ExternalLink, ClipboardCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface GstinPortalButtonProps {
  gstin: string;
  disabled?: boolean;
  onDataFetched?: (data: {
    legalName: string;
    tradeName: string;
    status: string;
    gstin: string;
  }) => void;
}

/**
 * Compact icon-button for verifying a GSTIN on the official portal.
 * - Single-click: copy GSTIN to clipboard and open the GST taxpayer search.
 * - Optional popover lets users paste the portal response back to auto-fill ledger fields.
 * Designed to sit inline next to a GSTIN input without crowding the form row.
 */
export function GstinPortalButton({ gstin, disabled, onDataFetched }: GstinPortalButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [parseError, setParseError] = React.useState("");
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  const cleanGstin = (gstin || "").trim().toUpperCase();

  const handlePortalRedirect = async () => {
    if (!cleanGstin) {
      toast.error("Enter a GSTIN first");
      return;
    }
    try {
      await navigator.clipboard.writeText(cleanGstin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success(`GSTIN ${cleanGstin} copied — paste it on the portal search`);
    } catch {
      // ignore clipboard errors and still open portal
    }
    window.open("https://services.gst.gov.in/services/searchtp", "_blank", "noopener,noreferrer");
  };

  const handlePasteParsing = (text: string) => {
    setPasteText(text);
    setParseError("");
    if (!text.trim()) return;

    let legalName = "";
    let tradeName = "";
    let status = "";

    const legalMatch = text.match(/Legal Name of Business\s*[:\-\t]?\s*([^\n\r\t]+)/i);
    if (legalMatch) legalName = legalMatch[1].trim();
    const tradeMatch = text.match(/Trade Name\s*[:\-\t]?\s*([^\n\r\t]+)/i);
    if (tradeMatch) tradeName = tradeMatch[1].trim();
    const statusMatch = text.match(/(?:Taxpayer\s*)?Status\s*[:\-\t]?\s*(Active|Cancelled|Suspended|Provisional)/i);
    if (statusMatch) status = statusMatch[1].trim();

    if (legalName) {
      onDataFetched?.({
        legalName,
        tradeName: tradeName || legalName,
        status: status || "Active",
        gstin: cleanGstin,
      });
      toast.success("Ledger fields filled from portal data");
      setPasteText("");
      setPopoverOpen(false);
    } else {
      setParseError("Could not detect GST fields. Copy the full summary block from the portal.");
    }
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        onClick={handlePortalRedirect}
        title={cleanGstin ? `Verify ${cleanGstin} on GST Portal` : "Verify on GST Portal"}
        aria-label="Verify on GST Portal"
      >
        {copied ? (
          <ClipboardCheck className="h-4 w-4 text-green-500" />
        ) : (
          <ExternalLink className="h-4 w-4" />
        )}
      </Button>

      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Paste portal response to auto-fill"
            aria-label="Paste portal response"
          >
            <Sparkles className="h-4 w-4 text-indigo-400" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-2">
          <p className="text-xs text-muted-foreground">
            After solving the portal CAPTCHA, copy the result block and paste here to auto-fill ledger fields.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => handlePasteParsing(e.target.value)}
            placeholder="Paste portal text… (Legal Name, Trade Name, Status)"
            className="w-full min-h-[100px] text-xs p-2 rounded border border-input bg-background font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-y"
          />
          {parseError && <p className="text-[11px] text-destructive">{parseError}</p>}
        </PopoverContent>
      </Popover>
    </div>
  );
}
