import { createFileRoute } from "@tanstack/react-router";
import { ItemVoucherForm } from "@/components/vouchers/ItemVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/debit_note")({
  head: () => ({ meta: [{ title: "Debit Note — Your Mehtaji" }] }),
  component: () => <ItemVoucherForm voucherType="debit_note" />,
});
