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
      const sess = data.session;
      const now = Math.floor(Date.now() / 1000);
      // Treat session as valid only if it has > 60s of life left. Otherwise
      // the persisted token in localStorage is expired/near-expired and any
      // PostgREST call will 403 with "token has invalid claims: token is
      // expired" before autoRefresh kicks in.
      if (sess && sess.expires_at && sess.expires_at - now > 60) return;

      // Try refresh first (cheaper, keeps user id stable).
      if (sess?.refresh_token) {
        const { data: r, error: rerr } = await supabase.auth.refreshSession();
        if (!rerr && r.session) return;
      }

      // Fall back to a fresh sign-in. Clear any stale persisted token first
      // so the new session fully replaces it.
      try { await supabase.auth.signOut({ scope: "local" } as never); } catch { /* ignore */ }
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
