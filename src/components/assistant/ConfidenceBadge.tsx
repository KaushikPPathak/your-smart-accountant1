import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Trust label attached to every AI-produced number.
 *  green  = deterministic aggregator (SQL/ledger arithmetic — 100% verifiable)
 *  amber  = LLM answer cross-checked against a verifier fact
 *  red    = LLM only — user should verify
 */
export type Confidence = "green" | "amber" | "red";

export interface ConfidenceInfo {
  confidence: Confidence;
  source: "aggregator" | "llm+verified" | "llm";
  /** Optional one-line reason (why this level). */
  reason?: string;
}

const meta: Record<Confidence, { label: string; hint: string; className: string; Icon: typeof ShieldCheck }> = {
  green: {
    label: "Verified",
    hint: "Computed directly from your ledger — deterministic.",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
    Icon: ShieldCheck,
  },
  amber: {
    label: "LLM + check",
    hint: "AI-generated and matched against a verifier — spot-check before relying on it.",
    className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
    Icon: ShieldAlert,
  },
  red: {
    label: "AI only",
    hint: "Model-generated without a deterministic check — please verify from the report.",
    className: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
    Icon: ShieldX,
  },
};

export function ConfidenceBadge({
  confidence, source, reason, className,
}: ConfidenceInfo & { className?: string }) {
  const m = meta[confidence];
  const Icon = m.Icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn("gap-1 h-5 px-1.5 text-[10px] font-medium cursor-help", m.className, className)}
          aria-label={`${m.label}: ${m.hint}`}
        >
          <Icon className="h-3 w-3" aria-hidden />
          {m.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        <p className="font-medium mb-0.5">{m.label} — source: {source}</p>
        <p className="opacity-90">{reason ?? m.hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Decide the badge for a structured answer card. Deterministic retrievers
 *  (party_balance, cash_bank, profit_loss, gstr1 etc.) all emit `facts`
 *  computed from the ledger; those are green. When we only have prose from
 *  the LLM, downgrade to red. */
export function inferConfidence(hasCard: boolean, hasFacts: boolean): ConfidenceInfo {
  if (hasCard && hasFacts) return { confidence: "green", source: "aggregator", reason: "Card computed from your ledger." };
  if (hasFacts) return { confidence: "amber", source: "llm+verified", reason: "AI answer matched against ledger facts." };
  return { confidence: "red", source: "llm", reason: "No deterministic verifier — please cross-check." };
}
