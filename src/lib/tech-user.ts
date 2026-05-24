// Silent tech-user sign-in.
//
// The app no longer shows a login screen. On boot we silently sign in as a
// single shared "technical user" so that Supabase RLS (which keys off
// auth.uid()) keeps working without the client ever seeing an auth UI.
//
// This is Phase A1 of the local-only migration: auth UI is gone, but Cloud
// is still the data backend. In later phases the SQLite layer replaces
// Supabase entirely and this whole file goes away.

import { supabase } from "@/integrations/supabase/client";
import { TECH_USER_EMAIL, TECH_USER_PASSWORD } from "./tech-user-credentials";

let inflight: Promise<void> | null = null;

/**
 * Make sure there is a valid Supabase session on this device. If one already
 * exists (persisted in localStorage), no-op. Otherwise sign in silently using
 * the shared tech-user credentials.
 *
 * Safe to call repeatedly — concurrent callers share the same in-flight
 * promise and the result is cached by Supabase's own session storage.
 */
export async function ensureTechSession(): Promise<void> {
  if (typeof window === "undefined") return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) return;
      const { error } = await supabase.auth.signInWithPassword({
        email: TECH_USER_EMAIL,
        password: TECH_USER_PASSWORD,
      });
      if (error) {
        // Don't throw — surface in console so the UI can still render an
        // error state via downstream queries. Hard-throwing here would blank
        // the entire app on a transient network blip.
        console.error("[tech-user] silent sign-in failed:", error.message);
      }
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

// Re-exported so legacy imports keep resolving.
export { TECH_USER_EMAIL, TECH_USER_PASSWORD };

/**
 * "Lock" the workspace: clear per-company unlock flags and the active company
 * id, then return the caller to the company picker. We deliberately do NOT
 * sign out of Supabase — signing out would force another silent sign-in on
 * the next page and there is no user-visible benefit.
 */
export async function lockWorkspace() {
  if (typeof window === "undefined") return;
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith("ym_unlocked_")) sessionStorage.removeItem(k);
  }
  localStorage.removeItem("ym_active_company_id");
}

const UNLOCK_KEY = (id: string) => `ym_unlocked_${id}`;

export function markCompanyUnlocked(companyId: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(UNLOCK_KEY(companyId), "1");
}

export function isCompanyUnlocked(companyId: string): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(UNLOCK_KEY(companyId)) === "1";
}
