import { createFileRoute } from "@tanstack/react-router";
import { ItemVoucherForm } from "@/components/vouchers/ItemVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/sales")({
  head: () => ({ meta: [{ title: "New Sales — Your Mehtaji" }] }),
  component: () => <ItemVoucherForm voucherType="sales" />,
});
