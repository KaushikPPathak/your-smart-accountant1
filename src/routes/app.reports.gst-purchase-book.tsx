import { createFileRoute } from "@tanstack/react-router";
import { GstBook } from "@/components/reports/GstBook";

export const Route = createFileRoute("/app/reports/gst-purchase-book")({
  head: () => ({ meta: [{ title: "GST Purchase Book — Reports" }] }),
  component: () => <GstBook kind="purchase" />,
});