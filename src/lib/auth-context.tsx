import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ensureTechSession } from "./tech-user";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listener first (Supabase best practice).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    // Silent tech-user sign-in with a short timeout so an offline boot
    // doesn't block the UI forever. The sync worker will retry in the
    // background when the network returns.
    (async () => {
      try {
        await Promise.race([
          ensureTechSession(),
          new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      } catch {
        /* offline boot — leave session null, lock screen will fall back */
      } finally {
        setLoading(false);
        // Kick off the offline sync worker once the app is mounted.
        import("./offline/sync-worker").then((m) => m.startSyncWorker()).catch(() => undefined);
      }
    })();

    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signOut: async () => {
      // No-op for the client — we never want to actually sign out, that would
      // just trigger the silent re-sign-in path. Kept as a stable API surface.
      return;
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
