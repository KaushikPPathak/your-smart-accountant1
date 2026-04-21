import { createFileRoute } from "@tanstack/react-router";
import { ItemVoucherForm } from "@/components/vouchers/ItemVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/delivery_note")({
  head: () => ({ meta: [{ title: "New Delivery Challan — Your Mehtaji" }] }),
  component: () => <ItemVoucherForm voucherType="delivery_note" />,
});
