import { createFileRoute } from "@tanstack/react-router";
import { ItemVoucherForm } from "@/components/vouchers/ItemVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/sales_order")({
  head: () => ({ meta: [{ title: "New Sales Order — Your Mehtaji" }] }),
  component: () => <ItemVoucherForm voucherType="sales_order" />,
});
