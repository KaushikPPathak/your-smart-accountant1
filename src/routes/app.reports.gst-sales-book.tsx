import { createFileRoute } from "@tanstack/react-router";
import { GstBook } from "@/components/reports/GstBook";

export const Route = createFileRoute("/app/reports/gst-sales-book")({
  head: () => ({ meta: [{ title: "GST Sales Book — Reports" }] }),
  component: () => <GstBook kind="sales" />,
});