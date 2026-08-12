// Silent tech-user sign-in.
//
// The app no longer shows an email/password login screen. On boot we silently
// sign in as a single shared "technical user" so that Supabase RLS (which
// keys off auth.uid()) keeps working. The user-visible gate is the PIN lock
// screen (see staff-session.ts and /lock route).

import { supabase } from "@/integrations/supabase/client";
import { TECH_USER_EMAIL, TECH_USER_PASSWORD } from "./tech-user-credentials";
import { lockWorkspace as lockWorkspaceImpl } from "./staff-session";

export type TechSessionResult = { ok: true } | { ok: false; reason: string };

let inflight: Promise<TechSessionResult> | null = null;

export async function ensureTechSession(force = false): Promise<TechSessionResult> {
  if (typeof window === "undefined") return { ok: true };
  if (inflight && !force) return inflight;

  inflight = (async (): Promise<TechSessionResult> => {
    try {
      const { data } = await supabase.auth.getSession();
      const sess = data.session;
      const now = Math.floor(Date.now() / 1000);
      if (!force && sess && sess.expires_at && sess.expires_at - now > 60) {
        return { ok: true };
      }

      // Try refresh first (cheaper, keeps user id stable).
      if (sess?.refresh_token) {
        const { data: r, error: rerr } = await supabase.auth.refreshSession();
        if (!rerr && r.session) return { ok: true };
      }

      // Fall back to a fresh sign-in. Clear any stale persisted token first.
      try { await supabase.auth.signOut({ scope: "local" } as never); } catch { /* ignore */ }
      const { error } = await supabase.auth.signInWithPassword({
        email: TECH_USER_EMAIL,
        password: TECH_USER_PASSWORD,
      });
      if (error) {
        console.error("[tech-user] silent sign-in failed:", error.message);
        return { ok: false, reason: error.message };
      }
      return { ok: true };
    } catch (e) {
      const reason = (e as { message?: string })?.message ?? "Unknown error";
      return { ok: false, reason };
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
