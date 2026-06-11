import * as React from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, ClipboardCheck, Search, HelpCircle, X, ShieldCheck, FileText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface GstinPortalWindowProps {
  gstin: string;
  onDataFetched?: (data: { legalName: string; tradeName: string; status: string; gstin: string }) => void;
}

export function GstinPortalWindow({ gstin, onDataFetched }: GstinPortalWindowProps) {
  const [copied, setCopied] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [parseError, setParseError] = React.useState("");
  const [isOpen, setIsOpen] = React.useState(false);

  const cleanGstin = gstin.trim().toUpperCase();
  const isValidGstin = cleanGstin.length === 15;

  const handleCopyAndRedirect = async () => {
    if (!cleanGstin) return;
    try {
      await navigator.clipboard.writeText(cleanGstin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      
      // Open the GST portal tracking desk safely in a beautifully centered mini-window
      window.open("https://services.gst.gov.in/services/searchtp", "_blank", "noopener,noreferrer");
    } catch (err) {
      window.open("https://services.gst.gov.in/services/searchtp", "_blank", "noopener,noreferrer");
    }
  };

  const handleParsing = (text: string) => {
    setPasteText(text);
    setParseError("");
    if (!text.trim()) return;

    let legalName = "";
    let tradeName = "";
    let status = "";

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes("legal name of business")) {
        legalName = lines[i + 1]?.trim() || lines[i].split(/business/i)[1]?.replace(/[:\-]/g, "").trim();
      }
      if (line.includes("trade name")) {
        tradeName = lines[i + 1]?.trim() || lines[i].split(/name/i)[1]?.replace(/[:\-]/g, "").trim();
      }
      if (line.includes("active") || text.toLowerCase().includes("active")) {
        status = "Active";
      }
    }

    if (legalName) {
      if (onDataFetched) {
        onDataFetched({
          legalName: legalName.replace(/^[:\s]+/, ""),
          tradeName: tradeName ? tradeName.replace(/^[:\s]+/, "") : legalName.replace(/^[:\s]+/, ""),
          status: status || "Active",
          gstin: cleanGstin
        });
      }
      setPasteText("");
      setIsOpen(false); 
    } else {
      setParseError("Could not parse. Ensure you copied the entire results window from the GST site.");
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!isValidGstin}
          className={`h-9 px-4 gap-2 border shadow-sm font-medium rounded-md transition-all duration-300 ${
            isValidGstin 
              ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200 text-emerald-700 hover:from-emerald-100 hover:to-teal-100 hover:border-emerald-300 shadow-emerald-100/50" 
              : "bg-secondary/40 border-muted text-muted-foreground"
          }`}
        >
          <Search className={`w-4 h-4 transition-transform duration-300 ${isValidGstin ? "text-emerald-600 group-hover:scale-110" : ""}`} />
          Verify Live
        </Button>
      </PopoverTrigger>
      
      <PopoverContent 
        side="right" 
        align="start" 
        sideOffset={14}
        className="w-[340px] p-0 overflow-hidden bg-white/95 backdrop-blur-md border border-slate-200 shadow-2xl rounded-xl z-[9999] animate-in fade-in slide-in-from-left-3 duration-200"
      >
        {/* Color Accent Bar */}
        <div className="h-1 w-full bg-gradient-to-r from-emerald-400 via-teal-500 to-indigo-500" />
        
        <div className="p-4 space-y-4">
          {/* Header Block */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-emerald-50 border border-emerald-100">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-800 tracking-wide uppercase">GSTIN Assistant</span>
                <span className="text-[10px] text-slate-400 font-medium">Instant ledger sync protocol</span>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600 rounded-full p-1 hover:bg-slate-50 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Action Step 1 */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">1</span>
              <span className="text-xs font-semibold text-slate-700">Launch Verification Desk</span>
            </div>
            <Button
              type="button"
              onClick={handleCopyAndRedirect}
              className={`w-full text-xs h-9 gap-2 font-medium transition-all duration-300 shadow-sm ${
                copied 
                  ? "bg-teal-600 hover:bg-teal-700 text-white" 
                  : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100"
              }`}
            >
              {copied ? (
                <>
                  <ClipboardCheck className="w-4 h-4 animate-bounce" />
                  Copied! Launching Portal...
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4" />
                  Copy GSTIN & Search
                </>
              )}
            </Button>
          </div>

          {/* Action Step 2 */}
          <div className="space-y-2 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">2</span>
                <span className="text-xs font-semibold text-slate-700">Auto-Fill Form Data</span>
              </div>
              <span className="text-[10px] text-slate-400 flex items-center gap-1 font-normal bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                <HelpCircle className="w-3 h-3 text-slate-400" /> Ctrl + V to sync
              </span>
            </div>
            
            <div className="relative group">
              <textarea
                value={pasteText}
                onChange={(e) => handleParsing(e.target.value)}
                placeholder="After searching on the portal, press Ctrl+A to select everything, copy it, and paste it completely inside this window box..."
                className="w-full min-h-[75px] text-xs p-2.5 pr-8 rounded-lg border border-slate-200 bg-slate-50/50 group-hover:bg-slate-50/20 font-mono text-[11px] leading-relaxed transition-all focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-slate-600 placeholder:text-slate-400 resize-none"
              />
              <FileText className="absolute right-2.5 bottom-2.5 w-4 h-4 text-slate-300 group-focus-within:text-indigo-400 pointer-events-none transition-colors" />
            </div>
            
            {parseError && (
              <div className="p-2 rounded bg-rose-50 border border-rose-100 animate-head-shake">
                <p className="text-[10px] text-rose-600 font-semibold leading-normal">{parseError}</p>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
