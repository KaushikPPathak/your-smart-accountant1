// Client-side stubs for what used to be server-rendered tech-user admin ops.
// In the pure-SPA build there is no service-role context — the tech user is
// expected to already exist in Supabase. Calling this is a no-op success.

export async function ensureTechnicalUser(): Promise<{ ok: boolean; created: boolean }> {
  return { ok: true, created: false };
}
