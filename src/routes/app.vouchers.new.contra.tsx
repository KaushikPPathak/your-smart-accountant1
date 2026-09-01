import { createFileRoute } from "@tanstack/react-router";
import { EntryVoucherForm } from "@/components/vouchers/EntryVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/contra")({
  head: () => ({ meta: [{ title: "Contra — Your Mehtaji" }] }),
  component: () => <EntryVoucherForm voucherType="contra" />,
});
