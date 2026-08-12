import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "@/components/assistant/AssistantChat";

export const Route = createFileRoute("/app/assistant")({
  head: () => ({
    meta: [
      { title: "AI Assistant — Your Mehtaji" },
      {
        name: "description",
        content:
          "Offline in-app assistant that guides you through settings, options and features of Your Mehtaji.",
      },
    ],
  }),
  component: AssistantPage,
});

function AssistantPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Mate runs entirely inside the app — no internet required. Ask about any
          screen, setting or option, and Mate can also navigate or apply changes
          for you.
        </p>
      </div>
      <AssistantChat />
    </div>
  );
}
