// One-time cloud → local migration and cloud wipe.
//
// The app is now local-only: every business record lives in IndexedDB on
// this device. Users who upgrade from an older version may still have data
// sitting on our servers from before the switch. This module runs once per
// device to (1) pull all that data down into local IndexedDB and then (2)
// release/delete it from the cloud so nothing of theirs lingers server-side.
//
// The whole flow is idempotent: a `meta` flag is set on success and the
// migration is skipped forever after. If any step fails, the flag is not
// set, so the next launch retries.

import { supabase } from "@/integrations/supabase/client";
import { pullCompanySnapshot } from "./offline/snapshot";
import { getMeta, setMeta } from "./offline/db";

const MIGRATION_FLAG = "cloud_migration_v1_done";

export interface MigrationResult {
  alreadyDone: boolean;
  pulledCompanies: number;
  releasedMemberships: number;
  removedCompanies: number;
  errors: string[];
}

export async function isCloudMigrationDone(): Promise<boolean> {
  const v = await getMeta<{ at: number }>(MIGRATION_FLAG);
  return Boolean(v?.at);
}

/**
 * Pull all cloud business data for the signed-in user into local
 * IndexedDB, then delete their membership from every company. When a
 * company is left with no members, delete the company row too — foreign-
 * key cascades wipe every dependent business table.
 *
 * Companies that still have other members (shared companies) are kept
 * intact on the server so those other members can migrate on their own
 * devices later.
 */
export async function runOneTimeCloudMigrationDown(): Promise<MigrationResult> {
  const result: MigrationResult = {
    alreadyDone: false,
    pulledCompanies: 0,
    releasedMemberships: 0,
    removedCompanies: 0,
    errors: [],
  };

  if (await isCloudMigrationDone()) {
    result.alreadyDone = true;
    return result;
  }

  // Must be online + signed in — otherwise defer to a future launch.
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    result.errors.push("Offline; will retry when online.");
    return result;
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    result.errors.push("Not signed in; will retry after next sign-in.");
    return result;
  }
  const userId = userData.user.id;

  // 1) Discover memberships.
  const { data: memberships, error: mErr } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId);
  if (mErr) {
    result.errors.push(`Failed to list memberships: ${mErr.message}`);
    return result;
  }

  const companyIds = Array.from(
    new Set((memberships ?? []).map((r) => r.company_id as string)),
  );

  // Nothing on the cloud → mark done immediately.
  if (companyIds.length === 0) {
    await setMeta(MIGRATION_FLAG, { at: Date.now(), note: "no cloud data" });
    return result;
  }

  // 2) Pull every company's data into local IndexedDB.
  //    pullCompanySnapshot uses the exact-verified path when the local
  //    cache has never been fully hydrated for that company, which is
  //    exactly what we want here.
  for (const companyId of companyIds) {
    try {
      const snap = await pullCompanySnapshot(companyId, {
        full: true,
        forceExact: true,
        notify: false,
      });
      if (snap && Object.keys(snap.errors).length === 0) {
        result.pulledCompanies++;
      } else {
        result.errors.push(
          `Pull failed for company ${companyId}: ${
            snap ? Object.values(snap.errors).join("; ") : "no result"
          }`,
        );
      }
    } catch (e) {
      result.errors.push(
        `Pull threw for company ${companyId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // If any pull failed, do NOT delete anything. We'll retry on next launch.
  if (result.errors.length > 0) return result;

  // 3) Release/delete on the cloud.
  for (const companyId of companyIds) {
    // Drop my own membership.
    const { error: delMemErr } = await supabase
      .from("company_members")
      .delete()
      .eq("company_id", companyId)
      .eq("user_id", userId);
    if (delMemErr) {
      result.errors.push(`Release membership ${companyId}: ${delMemErr.message}`);
      continue;
    }
    result.releasedMemberships++;

    // If no members remain, delete the company (cascade removes children).
    const { count, error: cntErr } = await supabase
      .from("company_members")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId);
    if (cntErr) {
      result.errors.push(`Count members ${companyId}: ${cntErr.message}`);
      continue;
    }
    if ((count ?? 0) === 0) {
      const { error: delCoErr } = await supabase
        .from("companies")
        .delete()
        .eq("id", companyId);
      if (delCoErr) {
        result.errors.push(`Delete company ${companyId}: ${delCoErr.message}`);
        continue;
      }
      result.removedCompanies++;
    }
  }

  // Mark done only if there were no hard errors. Partial success on
  // shared companies (membership released, company kept because others
  // remain) still counts as complete.
  if (result.errors.length === 0) {
    await setMeta(MIGRATION_FLAG, {
      at: Date.now(),
      pulled: result.pulledCompanies,
      released: result.releasedMemberships,
      removed: result.removedCompanies,
    });
  }
  return result;
}

/**
 * Kick off the migration in the background — non-blocking. Safe to call
 * on every launch; it self-guards via the meta flag and swallows errors
 * (they'll be logged for follow-up but never crash the app).
 */
export function scheduleCloudMigrationDown(): void {
  if (typeof window === "undefined") return;
  // Bypass the local-only guard by calling pullCompanySnapshot directly —
  // the guard is only on the background sync tick and the wrapper
  // pullSnapshot(), not on pullCompanySnapshot itself.
  void (async () => {
    try {
      if (await isCloudMigrationDone()) return;
      // Slight delay so we don't compete with initial paint.
      await new Promise((r) => setTimeout(r, 5_000));
      const res = await runOneTimeCloudMigrationDown();
      if (res.alreadyDone) return;
      if (res.errors.length === 0) {
        try {
          const { toast } = await import("sonner");
          if (res.pulledCompanies > 0 || res.releasedMemberships > 0) {
            toast.success("Your data is now stored on this device only", {
              description:
                res.removedCompanies > 0
                  ? `Removed ${res.removedCompanies} company / companies from the cloud.`
                  : "Cloud copies released.",
            });
          }
        } catch { /* ignore */ }
      } else {
        console.warn("[cloud-migration] deferred:", res.errors);
      }
    } catch (e) {
      console.warn("[cloud-migration] threw:", e);
    }
  })();
}
