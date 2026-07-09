import * as React from "react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ExternalLink, ClipboardCheck, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { lookupGstinViaSetu } from "@/lib/setu";
import { validateGSTIN } from "@/utils/gstinValidator";

interface GstinPortalButtonProps {
  gstin: string;
  disabled?: boolean;
  onDataFetched?: (data: {
    legalName: string;
    tradeName: string;
    status: string;
    gstin: string;
    address?: string;
  }) => void;
}

/**
 * Compact GSTIN action cluster:
 * - Zap: auto-fetch via Setu (if creds present + GSTIN valid).
 * - ExternalLink: copy GSTIN + open the official portal as fallback.
 * - Sparkles: paste portal response to auto-fill.
 * - Settings: edit Setu credentials.
 */
export function GstinPortalButton({ gstin, disabled, onDataFetched }: GstinPortalButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const [fetching, setFetching] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [parseError, setParseError] = React.useState("");
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  const cleanGstin = (gstin || "").trim().toUpperCase();
  const isValid = validateGSTIN(cleanGstin).valid;

  // Auto-fetch the first time a complete, valid GSTIN is typed.
  const autoFetchedRef = React.useRef<string>("");
  React.useEffect(() => {
    if (!isValid || autoFetchedRef.current === cleanGstin) return;
    autoFetchedRef.current = cleanGstin;
    void handleSetuFetch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanGstin, isValid]);

  const handleSetuFetch = async (silent = false) => {
    if (!cleanGstin) {
      if (!silent) toast.error("Enter a GSTIN first");
      return;
    }
    if (!isValid) {
      if (!silent) toast.error("Invalid GSTIN — fix format before fetching");
      return;
    }
    setFetching(true);
    try {
      const res = await lookupGstinViaSetu(cleanGstin);
      if (res.success) {
        onDataFetched?.({
          legalName: res.legalName,
          tradeName: res.tradeName,
          status: res.status,
          gstin: res.gstin,
          address: res.principalPlaceOfBusiness,
        });
        toast.success(`Fetched: ${res.legalName || res.tradeName}`);
      } else {
        if (!silent) {
          toast.error(res.error || "Setu lookup failed", {
            description: "You can still open the GST portal manually.",
          });
        }
      }
    } finally {
      setFetching(false);
    }
  };

  const openExternal = async (url: string) => {
    const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
    if (w.__TAURI_INTERNALS__) {
      try {
        const mod: any = await import(/* @vite-ignore */ "@tauri-apps/plugin-opener").catch(() => null);
        if (mod?.openUrl) { await mod.openUrl(url); return; }
        const shell: any = await import(/* @vite-ignore */ "@tauri-apps/plugin-shell").catch(() => null);
        if (shell?.open) { await shell.open(url); return; }
      } catch { /* fall through */ }
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

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
      /* ignore */
    }
    await openExternal("https://services.gst.gov.in/services/searchtp");
  };

  const handlePasteParsing = (text: string) => {
    setPasteText(text);
    setParseError("");
    if (!text.trim()) return;

    let legalName = "";
    let tradeName = "";
    let status = "";
    let address = "";
    const legalMatch = text.match(/Legal Name of Business\s*[:\-\t]?\s*([^\n\r\t]+)/i);
    if (legalMatch) legalName = legalMatch[1].trim();
    const tradeMatch = text.match(/Trade Name\s*[:\-\t]?\s*([^\n\r\t]+)/i);
    if (tradeMatch) tradeName = tradeMatch[1].trim();
    const statusMatch = text.match(/(?:Taxpayer\s*)?Status\s*[:\-\t]?\s*(Active|Cancelled|Suspended|Provisional)/i);
    if (statusMatch) status = statusMatch[1].trim();
    const addressMatch = text.match(/(?:Principal Place of Business|Address)\s*[:\-\t]?\s*([^\n\r]+(?:\n(?!\s*(?:Legal Name|Trade Name|Status|GSTIN)\b)[^\n\r]+)*)/i);
    if (addressMatch) address = addressMatch[1].replace(/\s+/g, " ").trim();

    if (legalName) {
      onDataFetched?.({
        legalName,
        tradeName: tradeName || legalName,
        status: status || "Active",
        gstin: cleanGstin,
        address,
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
        disabled={disabled || fetching}
        onClick={() => handleSetuFetch(false)}
        title={isValid ? `Fetch ${cleanGstin} via Setu` : "Enter a valid GSTIN to fetch"}
        aria-label="Fetch via Setu"
      >
        <Zap className={`h-4 w-4 ${fetching ? "animate-pulse text-amber-500" : "text-amber-500"}`} />
      </Button>

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

      {/* Setu credentials settings hidden from inline ledger form — managed centrally. */}
    </div>
  );
}
