import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { useCompany } from "@/lib/company-context";

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
  // Remount per company so each company shows only its own conversation.
  const { activeCompanyId } = useCompany();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Mehtaji is your data entry assistant. Describe a receipt, payment, sale
          or purchase in one line. It prepares a preview, and nothing is saved
          until you confirm.
        </p>
      </div>
      <AssistantChat key={activeCompanyId ?? "none"} />
    </div>
  );
}
