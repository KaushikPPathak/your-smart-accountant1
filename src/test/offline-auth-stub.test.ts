import { describe, expect, it } from "vitest";
import { supabase } from "@/integrations/supabase/client";

describe("offline auth stub", () => {
  it("never reports a sign-in or sign-up as successful", async () => {
    const a = await supabase.auth.signInWithPassword({ email: "x@example.com", password: "pw" } as never);
    const b = await supabase.auth.signUp({ email: "x@example.com", password: "pw" } as never);
    for (const r of [a, b] as Array<{ data: { session: unknown }; error: { code?: string } | null }>) {
      expect(r.data.session).toBeNull();
      expect(r.error?.code).toBe("AUTH_DISABLED");
    }
  });
});
