import { createFileRoute } from "@tanstack/react-router";
import { ItemVoucherForm } from "@/components/vouchers/ItemVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/purchase")({
  head: () => ({ meta: [{ title: "New Purchase — Your Mehtaji" }] }),
  component: () => <ItemVoucherForm voucherType="purchase" />,
});
