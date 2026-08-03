import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicy,
});

const UPDATED = "3 August 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold">Your Mehtaji — Smart Accountant</span>
          <Link to="/" className="text-xs text-primary underline underline-offset-4">
            Back to app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
        <p className="mt-2 text-xs text-muted-foreground">Last updated: {UPDATED}</p>

        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          This policy explains what information Smart Accountant (&quot;Your Mehtaji&quot;, the
          &quot;App&quot;) handles, where that information is stored, and the choices available to
          you. The App is an offline-first desktop accounting application for Indian businesses.
        </p>

        <Section title="1. Data we do not collect">
          <p>
            We do not collect, transmit, sell, or share your accounting data. Companies, vouchers,
            invoices, ledgers, inventory items, customer and supplier details, tax computations and
            reports never leave your device through the App.
          </p>
          <p>
            The App contains no advertising, no third-party analytics or tracking SDKs, and no
            behavioural profiling.
          </p>
        </Section>

        <Section title="2. Local storage on your device">
          <p>
            All business data is written to local storage on the computer where the App is installed
            (a browser-engine IndexedDB database inside the App&apos;s own per-user application data
            folder), along with local settings, preferences and diagnostic logs.
          </p>
          <p>
            Backups you create are written only to the folder you choose. Uninstalling the App does
            not automatically delete your data folder, so your books remain available after a
            reinstall or upgrade.
          </p>
        </Section>

        <Section title="3. Optional account and cloud features">
          <p>
            Creating an optional online account stores only sign-in identifiers (such as an email
            address) and licensing information with our authentication provider. Business data is
            never included.
          </p>
          <p>
            Optional cloud backup, when you explicitly enable it, uploads an encrypted backup file
            to <em>your own</em> storage account (for example Google Drive, OneDrive or Dropbox).
            We do not receive a copy.
          </p>
        </Section>

        <Section title="4. Network use">
          <p>
            The App is fully functional without an internet connection. Network requests are made
            only when you explicitly trigger a feature that requires them — for example signing in,
            license activation, an optional cloud backup, a GST portal lookup, or an optional
            AI-assistant request. No silent background downloads or content updates occur.
          </p>
        </Section>

        <Section title="5. Diagnostics">
          <p>
            Crash and error information is kept in a bounded local log on your device to help you
            troubleshoot. It is not uploaded automatically. If you choose to send a diagnostic
            report to support, you control what is shared.
          </p>
        </Section>

        <Section title="6. Your rights">
          <p>
            Because your data is stored locally, you retain full control at all times. You may
            export a complete backup, inspect it, or permanently delete a company or the entire
            local database from within the App. Where an optional account exists, you may request
            access to, correction of, or deletion of that account and its licensing records.
          </p>
        </Section>

        <Section title="7. Children">
          <p>The App is business software and is not directed at children under 13.</p>
        </Section>

        <Section title="8. Changes to this policy">
          <p>
            Updates to this policy will be published on this page with a revised &quot;last
            updated&quot; date.
          </p>
        </Section>

        <Section title="9. Contact">
          <p>
            Questions or privacy requests:{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="mailto:acauntant@gmail.com?subject=Privacy%20request"
            >
              acauntant@gmail.com
            </a>
          </p>
        </Section>
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Your Mehtaji · Smart Accountant
      </footer>
    </div>
  );
}
