import { createFileRoute } from "@tanstack/react-router";
import { Register } from "./app.reports.sales-register";

export const Route = createFileRoute("/app/reports/purchase-register")({
  head: () => ({ meta: [{ title: "Purchase Register — Reports" }] }),
  component: () => <Register kind="purchase" />,
});
