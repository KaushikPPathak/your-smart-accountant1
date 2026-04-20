import { createFileRoute } from "@tanstack/react-router";
import { EntryVoucherForm } from "@/components/vouchers/EntryVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/payment")({
  head: () => ({ meta: [{ title: "Payment — Your Mehtaji" }] }),
  component: () => <EntryVoucherForm voucherType="payment" />,
});
