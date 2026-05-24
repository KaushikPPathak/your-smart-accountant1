// Silent tech-user sign-in.
//
// The app no longer shows an email/password login screen. On boot we silently
// sign in as a single shared "technical user" so that Supabase RLS (which
// keys off auth.uid()) keeps working. The user-visible gate is the PIN lock
// screen (see staff-session.ts and /lock route).

import { supabase } from "@/integrations/supabase/client";
import { TECH_USER_EMAIL, TECH_USER_PASSWORD } from "./tech-user-credentials";
import { lockWorkspace as lockWorkspaceImpl } from "./staff-session";

let inflight: Promise<void> | null = null;

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
        console.error("[tech-user] silent sign-in failed:", error.message);
      }
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export { TECH_USER_EMAIL, TECH_USER_PASSWORD };

// Re-export the lock helper so legacy callers keep working.
export async function lockWorkspace() {
  lockWorkspaceImpl();
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
