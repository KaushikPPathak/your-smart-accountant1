// Offline unlock helpers.
//
// The app has no cloud sign-in. The only gate is the local PIN/password lock
// screen (see staff-session.ts and the /lock route). The shared technical
// Supabase account and its hardcoded credentials were removed.

import { lockWorkspace as lockWorkspaceImpl } from "./staff-session";

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
