// Post-login migration + sync-readiness UI.
//
// After a user signs in on top of a local-first install we (a) re-tag
// their local companies to the new account id and (b) tell them whether
// cloud backup is ready. This helper drives a single sonner toast that
// morphs through the steps so the user always knows what's happening.

import { toast } from "sonner";
import { linkLocalCompaniesToAccount } from "./link-local-to-account";
import { getLastUserCloudBackup } from "./user-cloud-backup";

export interface PostLoginMigrationResult {
  moved: number;
  cloudBackupReady: boolean;
  lastBackupAt: string | null;
}

/**
 * Runs after a successful sign-in / sign-up. Shows a live toast that
 * walks the user through:
 *   1. Linking local companies to the account
 *   2. Cloud backup readiness
 *
 * Returns the migration summary so callers can react (e.g. skip on
 * fresh accounts with no local data).
 */
export async function runPostLoginMigration(
  accountId: string,
  userName: string | null,
): Promise<PostLoginMigrationResult> {
  const toastId = `post-login-${accountId}`;
  const who = userName?.trim() || "you";

  toast.loading("Preparing your workspace…", {
    id: toastId,
    description: `Linking local companies to ${who}'s account.`,
  });

  let moved = 0;
  try {
    const res = await linkLocalCompaniesToAccount(accountId);
    moved = res.moved;
  } catch (err) {
    console.warn("Local company migration failed:", err);
    // Never block the user on this — surface a non-blocking notice and
    // keep them moving. Their local data is untouched.
    toast.message("Signed in", {
      id: toastId,
      description:
        "You're in. We couldn't fully link your local companies just now — you can retry from Settings → Connect account.",
      duration: 6000,
    });
    return { moved: 0, cloudBackupReady: false, lastBackupAt: null };
  }

  let lastBackupAt: string | null = null;
  try {
    lastBackupAt = getLastUserCloudBackup();
  } catch { /* ignore */ }
  const cloudBackupReady = !!lastBackupAt;

  // Compose a single, clear "you're all set" toast summarising what
  // just happened and where the user stands on cloud backup.
  const linkedMsg =
    moved === 0
      ? "No local companies needed migrating."
      : `Linked ${moved} local ${moved === 1 ? "company" : "companies"} to your account.`;

  let backupWhen = "";
  if (cloudBackupReady && lastBackupAt) {
    try { backupWhen = new Date(lastBackupAt).toLocaleString(); } catch { backupWhen = ""; }
  }
  const backupMsg = cloudBackupReady
    ? `Cloud backup is ready${backupWhen ? `. Last backup: ${backupWhen}` : ""}.`
    : "Cloud backup is not configured yet. Set it up from Settings → Cloud backup.";

  toast.success(`Welcome, ${who}`, {
    id: toastId,
    description: `${linkedMsg} ${backupMsg}`,
    duration: 6000,
  });

  return { moved, cloudBackupReady, lastBackupAt };
}
