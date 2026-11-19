// Phone-only report title for GST screens: company, report name and period, so
// the screen (and the in-app report view) has a heading at the top. Hidden from
// Windows layouts and from print.
import { useCompany } from "@/lib/company-context";
import { fmtIndianDate } from "@/lib/format-date";

export function PhoneReportHeading({ title, from, to }: { title: string; from?: string; to?: string }) {
  const { activeMembership } = useCompany();
  const company = activeMembership?.companies?.name ?? "";
  return (
    <div className="mb-3 text-center sm:hidden print:hidden">
      <div className="text-base font-bold uppercase tracking-wide text-[#002060]">{company || " "}</div>
      <div className="text-sm font-semibold">{title}</div>
      {from && to && (
        <div className="text-xs text-muted-foreground">
          {fmtIndianDate(from)} to {fmtIndianDate(to)}
        </div>
      )}
    </div>
  );
}
