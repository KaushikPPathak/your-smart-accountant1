import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssistantChat } from "@/components/assistant/AssistantChat";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "AI Assistant (Offline) — Your Mehtaji" },
      {
        name: "description",
        content:
          "Offline diagnostics & guidance assistant. Works without signing in or opening a company — use it to diagnose sync, data and connectivity issues.",
      },
    ],
  }),
  component: StandaloneAssistantPage,
});

function StandaloneAssistantPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/10 p-1.5 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">AI Assistant</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Offline diagnostics · no company required
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl p-4 md:p-6">
        <div className="mb-4 rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
          You can use Mate here without signing in or opening a company — ask
          about synchronisation problems, offline data, login issues, or any
          other diagnostic question.
        </div>
        <AssistantChat />
      </main>
    </div>
  );
}
