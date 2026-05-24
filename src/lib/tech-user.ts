// Per-company-password unlock helpers (UI-level gating only).
// Real authentication is now handled by Supabase Auth via the
// /login and /signup routes — see src/lib/auth-context.tsx.

import { supabase } from "@/integrations/supabase/client";

// Backwards-compatible no-op. Some legacy callers still invoke this on launch;
// it now does nothing because real users sign in via /login.
export async function ensureTechSession(): Promise<void> {
  return;
}

// Re-exported for any leftover imports — values are placeholders.
export const TECH_USER_EMAIL = "";
export const TECH_USER_PASSWORD = "";

/** "Lock" the workspace: sign the user out and clear unlock flags. */
export async function lockWorkspace() {
  if (typeof window === "undefined") return;
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith("ym_unlocked_")) sessionStorage.removeItem(k);
  }
  localStorage.removeItem("ym_active_company_id");
  await supabase.auth.signOut();
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
