import { createFileRoute } from "@tanstack/react-router";
import { Outstanding } from "./app.reports.receivables";

export const Route = createFileRoute("/app/reports/payables")({
  head: () => ({ meta: [{ title: "Outstanding Payables — Reports" }] }),
  component: () => <Outstanding mode="payables" />,
});
