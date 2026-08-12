import { Link } from "@tanstack/react-router";
import { AlertTriangle, KeyRound } from "lucide-react";
import { useLicenseState } from "@/lib/license/hook";

export function LicenseNagBanner() {
  const state = useLicenseState();

  if (state.mode === "licensed") return null;

  if (state.mode === "trial") {
    // Low-key strip when there's still plenty of time; louder near the end.
    const soon = state.daysLeft <= 7;
    return (
      <div
        className={`flex items-center justify-between gap-3 border-b px-4 py-1.5 text-xs ${
          soon
            ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            : "border-border bg-muted/50 text-muted-foreground"
        }`}
      >
        <div className="flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5" />
          <span>
            Trial &mdash; <strong>{state.daysLeft}</strong>{" "}
            {state.daysLeft === 1 ? "day" : "days"} left.
            {soon ? " Enter a license key to keep creating vouchers after the trial ends." : ""}
          </span>
        </div>
        <Link
          to="/app/settings/license"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Enter license key
        </Link>
      </div>
    );
  }

  // expired
  return (
    <div className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive-foreground dark:bg-destructive/20">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span>
          <strong>Trial ended.</strong> Reports are read-only and PDF/Excel
          exports are watermarked. Enter a license key to continue.
        </span>
      </div>
      <Link
        to="/app/settings/license"
        className="rounded-md bg-destructive px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/90"
      >
        Enter license key
      </Link>
    </div>
  );
}
