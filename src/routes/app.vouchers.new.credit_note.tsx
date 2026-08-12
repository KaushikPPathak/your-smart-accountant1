import { createFileRoute } from "@tanstack/react-router";
import { ItemVoucherForm } from "@/components/vouchers/ItemVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/credit_note")({
  head: () => ({ meta: [{ title: "Credit Note — Your Mehtaji" }] }),
  component: () => <ItemVoucherForm voucherType="credit_note" />,
});
