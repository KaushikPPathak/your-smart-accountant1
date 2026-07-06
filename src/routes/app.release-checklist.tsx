import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/release-checklist")({
  head: () => ({
    meta: [
      { title: "Release Checklist — Your Mehtaji" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReleaseChecklistPage,
});

// Layer 7 — printable release checklist. The source of truth lives at
// docs/RELEASE_CHECKLIST.md; this page mirrors it so an owner can print
// and hand-sign it before every release.

interface Section {
  title: string;
  intro?: string;
  items: string[];
}

const SECTIONS: Section[] = [
  {
    title: "1. Automated gates (must all be green)",
    items: [
      "bun run test — all tests pass (100% green, 0 skipped)",
      "bunx tsgo --noEmit — zero type errors",
      "bun run build — production build succeeds",
      "CI build on the release branch is green",
      "Stress test (stress-10k.test.ts) stays inside every budget",
    ],
  },
  {
    title: "2. Data safety — manual (10 minutes, mandatory)",
    intro: "Do this against a real company with at least 1 year of vouchers.",
    items: [
      "Backup the company from the previous release",
      "Install the new release over the previous one",
      "Open the app — company list still shows every company",
      "Open the tested company — voucher count matches",
      "Open Trial Balance — every ledger balance matches to the paisa",
      "Open Balance Sheet — total assets = total liabilities",
      "Open Profit & Loss — net figure matches previous release",
      "Restore the pre-upgrade backup on top of the new install — no rows lost",
      "Diagnostics shows no new failures during the drill",
    ],
  },
  {
    title: "3. Statutory correctness (spot check)",
    intro: "Pick one recent voucher of each type and verify:",
    items: [
      "Sales invoice — CGST+SGST correct for intra-state, IGST for inter-state",
      "Purchase with ineligible ITC — GST capitalised into purchase account",
      "Payment voucher — party ledger reduced by exact amount",
      "Receipt voucher — bank/cash increased by exact amount",
      "Journal — Dr = Cr on posting",
      "Credit note — reverses the original sale correctly",
    ],
  },
  {
    title: "4. Reports parity",
    items: [
      "Day Book prints without column overflow",
      "Ledger statement prints with correct opening + closing balance",
      "GSTR-1 summary JSON validates against schema",
      "Print/PDF invoice matches the customer's usual template",
    ],
  },
  {
    title: "5. Rollout plan",
    items: [
      "Release notes drafted (user-facing, plain language)",
      "Beta channel receives the build first",
      "Wait 72 hours on beta before promoting to stable",
      "Feature flags for risky new code set to correct starting percentage",
      "Rollback plan written: previous installer + last known-good backup filed",
    ],
  },
  {
    title: "6. Communication",
    items: [
      "Support inbox notified of the release window",
      "Known issues from beta listed in release notes",
      "User-facing changelog published",
    ],
  },
];

function ReleaseChecklistPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Release Checklist</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Print, tick each box by hand, and file with the release notes.
            Every release must be signed off against this list.
          </p>
        </div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" /> Print
        </Button>
      </div>

      <div className="rounded-lg border bg-background p-6 print:border-0 print:p-0">
        <h2 className="text-xl font-semibold">Release Checklist — Your Mehtaji</h2>
        <p className="mt-1 text-sm">
          Every release must be signed off against this list before it goes to users.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>Release version: <span className="inline-block min-w-[10rem] border-b border-foreground/40">&nbsp;</span></div>
          <div>Date: <span className="inline-block min-w-[10rem] border-b border-foreground/40">&nbsp;</span></div>
          <div>Released by: <span className="inline-block min-w-[10rem] border-b border-foreground/40">&nbsp;</span></div>
          <div>Signed: <span className="inline-block min-w-[10rem] border-b border-foreground/40">&nbsp;</span></div>
        </div>

        <hr className="my-6" />

        {SECTIONS.map((section) => (
          <section key={section.title} className="mb-6 break-inside-avoid">
            <h3 className="text-base font-semibold">{section.title}</h3>
            {section.intro && (
              <p className="mt-1 text-sm text-muted-foreground">{section.intro}</p>
            )}
            <ul className="mt-2 space-y-1.5 text-sm">
              {section.items.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-0.5 inline-block h-4 w-4 flex-shrink-0 rounded border border-foreground/60"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <hr className="my-6" />

        <section className="break-inside-avoid">
          <h3 className="text-base font-semibold">Sign-off</h3>
          <p className="mt-1 text-sm">
            By signing below, I confirm every box above is ticked and I have
            personally verified the data-safety drill in section 2 against a
            real company file.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>Release owner: <span className="inline-block min-w-[12rem] border-b border-foreground/40">&nbsp;</span></div>
            <div>Date: <span className="inline-block min-w-[8rem] border-b border-foreground/40">&nbsp;</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
