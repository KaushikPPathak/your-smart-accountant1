// Lock-screen / PIN session state.
//
// Sits on top of the silent Supabase "tech user" sign-in (Phase A1). This is
// the local-workstation gate the user actually sees on launch.

const UNLOCK_KEY = "ym_unlocked";
const STAFF_ID_KEY = "ym_active_staff_id";
const STAFF_NAME_KEY = "ym_active_staff_name";
const STAFF_ROLE_KEY = "ym_active_staff_role";

export type StaffRole = "admin" | "staff";

export function isUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(UNLOCK_KEY) === "1";
}

export function markUnlocked(staff: { id: string; name: string; role: StaffRole }) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(UNLOCK_KEY, "1");
  localStorage.setItem(STAFF_ID_KEY, staff.id);
  localStorage.setItem(STAFF_NAME_KEY, staff.name);
  localStorage.setItem(STAFF_ROLE_KEY, staff.role);
}

export function lockWorkspace() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(UNLOCK_KEY);
  // Clear per-company unlock flags so company password is asked again.
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith("ym_unlocked_")) sessionStorage.removeItem(k);
  }
  localStorage.removeItem("ym_active_company_id");
  // Keep the staff identity in localStorage as a hint for "last user", but
  // they'll still have to re-enter the PIN.
}

export function getActiveStaff(): { id: string; name: string; role: StaffRole } | null {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem(STAFF_ID_KEY);
  if (!id) return null;
  return {
    id,
    name: localStorage.getItem(STAFF_NAME_KEY) ?? "",
    role: (localStorage.getItem(STAFF_ROLE_KEY) as StaffRole) ?? "staff",
  };
}
