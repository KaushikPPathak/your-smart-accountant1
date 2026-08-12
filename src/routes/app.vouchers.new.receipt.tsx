import { createFileRoute } from "@tanstack/react-router";
import { EntryVoucherForm } from "@/components/vouchers/EntryVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/receipt")({
  head: () => ({ meta: [{ title: "Receipt — Your Mehtaji" }] }),
  component: () => <EntryVoucherForm voucherType="receipt" />,
});
