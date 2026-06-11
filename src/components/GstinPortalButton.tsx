import * as React from "react";
import { Button } from "./ui/button"; // Adjust path to matching your file structure if needed
import { ExternalLink, ClipboardCheck, Clipboard, ChevronDown, ChevronUp, Sparkles } from "lucide-react";

interface GstinPortalButtonProps {
  gstin: string;
  onDataFetched?: (data: {
    legalName: string;
    tradeName: string;
    status: string;
    gstin: string;
  }) => void;
}

export function GstinPortalButton({ gstin, onDataFetched }: GstinPortalButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [parseError, setParseError] = React.useState("");

  // Simple regex validation for Indian GSTIN format
  const isValidGstin = React.useMemo(() => {
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return gstinRegex.test(gstin.trim().toUpperCase());
  }, gstin);

  const handlePortalRedirect = async () => {
    if (!gstin) return;
    
    const cleanGstin = gstin.trim().toUpperCase();

    try {
      // Step A: Write to system clipboard
      await navigator.clipboard.writeText(cleanGstin);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);

      // Step B: Trigger native alert/toast fallback since we are out of Lovable components context
      // Replace with your app's custom toast trigger if you use shadcn sonner/toast!
      alert(`GSTIN [${cleanGstin}] copied to clipboard!\n\nOpening GST Portal. Please solve the CAPTCHA and press Ctrl+V to search.`);

      // Step C: Redirect to official GST taxpayer search page
      window.open("https://services.gst.gov.in/services/searchtp", "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Failed to copy text to clipboard", err);
      // Fallback open if clipboard permission blocks it
      window.open("https://services.gst.gov.in/services/searchtp", "_blank", "noopener,noreferrer");
    }
  };

  // Step 3: Parse copied portal data back into local app structure
  const handlePasteParsing = (text: string) => {
    setPasteText(text);
    setParseError("");

    if (!text.trim()) return;

    // Heuristic parsing parameters for raw text copied from the portal tables
    let legalName = "";
    let tradeName = "";
    let status = "";

    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const currentLine = lines[i].toLowerCase();
      
      // Match common layouts found on the portal output tables
      if (currentLine.includes("legal name of business")) {
        legalName = lines[i + 1]?.trim() || lines[i].split(/business/i)[1]?.replace(/[:\-\t]/g, "").trim();
      }
      if (currentLine.includes("trade name")) {
        tradeName = lines[i + 1]?.trim() || lines[i].split(/name/i)[1]?.replace(/[:\-\t]/g, "").trim();
      }
      if (currentLine.includes("taxpayer type") || currentLine.includes("constitution of business")) {
        // Just checking context structures if needed
      }
      if (currentLine.includes("gstr-3b") || currentLine.includes("status")) {
        if (currentLine.includes("active")) status = "Active";
        if (currentLine.includes("cancelled")) status = "Cancelled";
        if (currentLine.includes("suspended")) status = "Suspended";
      }
    }

    // Secondary inline regex extraction backup if line splitting breaks on specific browser layouts
    if (!legalName) {
      const legalMatch = text.match(/Legal Name of Business\s*[:\-\t]?\s*([^\n\r\t]+)/i);
      if (legalMatch) legalName = legalMatch[1].trim();
    }
    if (!tradeName) {
      const tradeMatch = text.match(/Trade Name\s*[:\-\t]?\s*([^\n\r\t]+)/i);
      if (tradeMatch) tradeName = tradeMatch[1].trim();
    }
    if (!status) {
      const statusMatch = text.match(/Taxpayer Status\s*[:\-\t]?\s*(Active|Cancelled|Suspended)/i);
      if (statusMatch) status = statusMatch[1].trim();
    }

    // Default status backup if parsed implicitly
    if (text.toLowerCase().includes("active") && !status) {
      status = "Active";
    }

    // Validate result and pass upstream to local SQLite update pipeline
    if (legalName) {
      if (onDataFetched) {
        onDataFetched({
          legalName: legalName.replace(/^[:\s]+/, ""),
          tradeName: tradeName ? tradeName.replace(/^[:\s]+/, "") : legalName.replace(/^[:\s]+/, ""),
          status: status || "Active",
          gstin: gstin.trim().toUpperCase()
        });
        
        // Success cleanup
        setPasteText("");
        setIsOpen(false);
        alert("🎉 Party details parsed and synced to local SQLite brain successfully!");
      }
    } else {
      setParseError("Could not find matching GST fields. Please copy the whole summary table from the portal page and try again.");
    }
  };

  return (
    <div className="w-full max-w-md p-4 border border-border rounded-lg bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-mono font-bold tracking-wider text-muted-foreground uppercase">
            GSTIN Verification
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isValidGstin ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'}`}>
            {isValidGstin ? "Valid Format" : "Invalid Format"}
          </span>
        </div>

        {/* Action verification trigger using base Button structure */}
        <Button
          type="button"
          onClick={handlePortalRedirect}
          disabled={!isValidGstin}
          variant={isValidGstin ? "default" : "outline"}
          className="w-full flex items-center justify-center gap-2 font-medium"
        >
          {copied ? (
            <>
              <ClipboardCheck className="w-4 h-4 text-green-400" />
              GSTIN Copied to Clipboard
            </>
          ) : (
            <>
              <ExternalLink className="w-4 h-4" />
              Verify on GST Portal
            </>
          )}
        </Button>

        {/* Collapsible Manual Sync Panel */}
        <div className="mt-2 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground py-1 focus:outline-none"
          >
            <span className="flex items-center gap-1 font-medium">
              <Sparkles className="w-3 h-3 text-indigo-400" />
              Sync portal layout manually back to ledger
            </span>
            {isOpen ? <ChevronUp className="w-3. h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {isOpen && (
            <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                After solving the portal CAPTCHA, select and copy the resulting details block from your browser window, then paste it right here:
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => handlePasteParsing(e.target.value)}
                placeholder="Paste raw text here... (e.g. Legal Name: ABC Exports Private Limited...)"
                className="w-full min-h-[80px] text-xs p-2 rounded border border-input bg-background font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              />
              {parseError && (
                <p className="text-[11px] text-destructive font-medium">{parseError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
