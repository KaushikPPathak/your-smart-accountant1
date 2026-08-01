import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { findCitations, toolsToSources } from "@/lib/ai/citations";

interface Props {
  answer: string;
  question?: string;
  toolNames?: string[];
}

/**
 * Phase F — "Explain & teach" footer for an assistant answer: shows which
 * in-app reports the numbers came from, plus the statutory reference behind
 * the rule being applied so the user can verify rather than trust.
 */
export function AnswerProvenance({ answer, question = "", toolNames = [] }: Props) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const citations = findCitations(answer, question);
  const sources = toolsToSources(toolNames);

  if (!citations.length && !sources.length) return null;

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <BookOpen className="h-3 w-3" />
        Sources &amp; references
        <span className="opacity-60">({sources.length + citations.length})</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {sources.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {sources.map((s, i) =>
                s.to ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => navigate(s.to!)}
                    className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent"
                  >
                    {s.label}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                ) : (
                  <Badge key={i} variant="outline" className="text-[10px]">
                    {s.label}
                  </Badge>
                ),
              )}
            </div>
          )}

          {citations.map((c) => (
            <div key={c.id} className="rounded border border-border/70 bg-background/60 p-2">
              <div className="text-[11px] font-semibold">{c.ref}</div>
              <div className="text-[11px] text-muted-foreground">{c.title}</div>
              <p className="mt-1 text-[11px] leading-snug">{c.gist}</p>
            </div>
          ))}

          <p className="text-[10px] italic text-muted-foreground">
            References are for guidance; confirm the current text of the law before filing.
          </p>
        </div>
      )}
    </div>
  );
}
