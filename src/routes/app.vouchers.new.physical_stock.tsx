import { createFileRoute } from "@tanstack/react-router";
import { PhysicalStockForm } from "@/components/vouchers/PhysicalStockForm";

export const Route = createFileRoute("/app/vouchers/new/physical_stock")({
  head: () => ({ meta: [{ title: "Physical Stock — Your Mehtaji" }] }),
  component: () => <PhysicalStockForm />,
});
