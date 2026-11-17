import { createFileRoute } from "@tanstack/react-router";
import { desktopOnly } from "@/components/phone/DesktopOnlyNotice";
import { ManufacturingVoucherForm } from "@/components/vouchers/ManufacturingVoucherForm";

export const Route = createFileRoute("/app/vouchers/new/manufacturing")({
  head: () => ({ meta: [{ title: "New Manufacturing Journal — Your Mehtaji" }] }),
  component: desktopOnly("Manufacturing journal", ManufacturingVoucherForm),
});
