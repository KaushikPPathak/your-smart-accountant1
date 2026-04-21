import { createFileRoute } from "@tanstack/react-router";
import { ItemVoucherForm } from "@/components/vouchers/ItemVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/quotation")({
  head: () => ({ meta: [{ title: "New Quotation — Your Mehtaji" }] }),
  component: () => <ItemVoucherForm voucherType="quotation" />,
});
