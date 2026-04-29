// Single shared technical Supabase user. The app auto-signs-in as this user
// on launch so RLS keeps working. Per-company passwords (verified via the
// `verify_company_password` RPC) gate access in the UI, not at the DB level.
//
// These are NOT secrets in the security sense — anyone with the app can read
// them. That is intentional: the picker is open by design (the user chose
// "Per-company password (optional)"). To raise the bar, set a password on
// each company in Settings → Company access.

import { supabase } from "@/integrations/supabase/client";

export const TECH_USER_EMAIL = "acauntant@gmail.com";
export const TECH_USER_PASSWORD = "Pathak*123*";

let signInPromise: Promise<void> | null = null;

export async function ensureTechSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;

  if (!signInPromise) {
    signInPromise = (async () => {
      const { error } = await supabase.auth.signInWithPassword({
        email: TECH_USER_EMAIL,
        password: TECH_USER_PASSWORD,
      });
      if (error) {
        console.error("Auto sign-in failed:", error);
        throw error;
      }
    })().finally(() => {
      signInPromise = null;
    });
  }
  await signInPromise;
}

/** "Lock" the workspace: clear unlock flags, return to the picker.
 *  We keep the Supabase session so reopening a company is one click. */
export function lockWorkspace() {
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