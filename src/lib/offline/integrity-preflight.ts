// Shared pre-flight integrity check used before backup export and before
// restore. UI layer only — no writes. Emits a toast when issues found.
// See src/lib/offline/integrity-scan.ts for the underlying scanner.

import { toast } from "sonner";
import { runIntegrityScan, totalIssues } from "./integrity-scan";

export async function preflightIntegrityToast(
  companyId: string | null | undefined,
  when: "backup" | "restore",
): Promise<{ issueCount: number }> {
  if (!companyId) return { issueCount: 0 };
  try {
    const issues = await runIntegrityScan(companyId);
    const n = totalIssues(issues);
    if (n > 0) {
      const top = issues
        .filter((i) => i.count > 0)
        .slice(0, 2)
        .map((i) => `${i.issue} (${i.count})`)
        .join("; ");
      toast.warning(
        when === "backup"
          ? `Integrity scan found ${n} issue(s) before backup: ${top}. Backup will proceed — fix from Data Health when convenient.`
          : `Integrity scan found ${n} issue(s) in current data before restore: ${top}.`,
        { duration: 7000 },
      );
    }
    return { issueCount: n };
  } catch {
    return { issueCount: 0 };
  }
}
