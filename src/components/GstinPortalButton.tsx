import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const GST_PORTAL_URL = "https://services.gst.gov.in/services/searchtp";

async function openInSystemBrowser(url: string) {
  // Prefer Tauri opener plugin when present, then shell, finally web fallback.
  try {
    const mod = await import(/* @vite-ignore */ "@tauri-apps/plugin-opener");
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

interface Props {
  className?: string;
  disabled?: boolean;
}

export function GstinPortalButton({ className, disabled }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={className}
          onClick={() => void openInSystemBrowser(GST_PORTAL_URL)}
          aria-label="Verify on GST Portal"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Verify on GST Portal</TooltipContent>
    </Tooltip>
  );
}
