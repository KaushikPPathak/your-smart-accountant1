import { createFileRoute } from "@tanstack/react-router";
import { EntryVoucherForm } from "@/components/vouchers/EntryVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/journal")({
  head: () => ({ meta: [{ title: "Journal — Your Mehtaji" }] }),
  component: () => <EntryVoucherForm voucherType="journal" />,
});
