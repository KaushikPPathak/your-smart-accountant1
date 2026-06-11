import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const GST_PORTAL_URL = "https://services.gst.gov.in/services/searchtp";

async function openInSystemBrowser(url: string) {
  // Prefer Tauri opener plugin when present, then shell, finally web fallback.
  try {
    const mod: any = await import(/* @vite-ignore */ ("@tauri-apps/plugin-opener" as string));
    if (mod && typeof mod.open === "function") {
      await mod.open(url);
      return;
    }
  } catch { /* not installed in this build */ }
  try {
    const shell = await import("@tauri-apps/plugin-shell");
    if (shell && typeof shell.open === "function") {
      await shell.open(url);
      return;
    }
  } catch { /* not in tauri runtime */ }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

interface Props {
  /** The GSTIN currently in the field — copied to clipboard on click for easy paste on the portal. */
  gstin?: string;
  className?: string;
  disabled?: boolean;
}

export function GstinPortalButton({ gstin, className, disabled }: Props) {
  const handleClick = async () => {
    const value = (gstin || "").trim().toUpperCase();
    if (value) {
      const copied = await copyToClipboard(value);
      if (copied) {
        toast.success("GSTIN copied — paste it on the GST portal", { duration: 3500 });
      }
    }
    await openInSystemBrowser(GST_PORTAL_URL);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={className}
          onClick={() => void handleClick()}
          aria-label="Verify on GST Portal"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {gstin ? "Copy GSTIN & open GST Portal" : "Open GST Portal"}
      </TooltipContent>
    </Tooltip>
  );
}
