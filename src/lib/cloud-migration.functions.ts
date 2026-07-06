// Server function: releases the current user's business data from the
// cloud. For each company the user is a member of, their membership row is
// deleted. When no members remain, the company itself is deleted, which
// cascades to every business table (vouchers, ledgers, items, settings,
// etc.) via foreign keys.
//
// This is called exactly once per device by the client migration-down
// driver, after all cloud data has already been pulled into local
// IndexedDB.
//
// Safety: acts as the signed-in user via RLS. Companies with other members
// (shared companies) are left intact — each member wipes their own copy
// when they migrate on their own device.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const purgeMyCloudData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // 1) Find companies I'm a member of.
    const { data: memberships, error: mErr } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId);
    if (mErr) throw new Error(`Failed to list memberships: ${mErr.message}`);

    const companyIds = Array.from(
      new Set((memberships ?? []).map((r) => r.company_id as string)),
    );

    let removedCompanies = 0;
    let releasedMemberships = 0;
    const errors: string[] = [];

    for (const companyId of companyIds) {
      // Drop my own membership first.
      const { error: delMemErr } = await supabase
        .from("company_members")
        .delete()
        .eq("company_id", companyId)
        .eq("user_id", userId);
      if (delMemErr) {
        errors.push(`membership ${companyId}: ${delMemErr.message}`);
        continue;
      }
      releasedMemberships++;

      // If no members remain, delete the company. FK cascade removes all
      // dependent business data.
      const { count, error: cntErr } = await supabase
        .from("company_members")
        .select("*", { count: "exact", head: true })
        .eq("company_id", companyId);
      if (cntErr) {
        errors.push(`count ${companyId}: ${cntErr.message}`);
        continue;
      }
      if ((count ?? 0) === 0) {
        const { error: delCoErr } = await supabase
          .from("companies")
          .delete()
          .eq("id", companyId);
        if (delCoErr) {
          errors.push(`company ${companyId}: ${delCoErr.message}`);
          continue;
        }
        removedCompanies++;
      }
    }

    return {
      ok: errors.length === 0,
      companiesConsidered: companyIds.length,
      releasedMemberships,
      removedCompanies,
      errors,
    };
  });
