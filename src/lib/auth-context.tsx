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
    // 1. Dynamic trigger function to initialize background sync operations securely
    const initSyncEngine = (currentSession: Session | null) => {
      if (!currentSession) return; // Prevent worker from throwing 401 loops when offline/unsigned
      
      import("./offline/sync-worker")
        .then((m) => m.startSyncWorker())
        .catch(() => undefined);
    };

    // Listener first (Supabase best practice).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      // Catch sign-up or sign-in transitions dynamically
      if (newSession) {
        initSyncEngine(newSession);
      }
    });

    (async () => {
      // Pre-warm the local DB regardless of network.
      import("./offline/db").catch(() => undefined);
      
      let activeSession: Session | null = null;
      
      try {
        // Run the background sign-in attempt, but cut it off quickly at 1.5s if it hangs or is offline
        await Promise.race([
          ensureTechSession(),
          new Promise<void>((resolve) => setTimeout(resolve, 1500)),
        ]);
        
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          activeSession = data.session;
          setSession(data.session);
        }
      } catch {
        /* offline boot fallback — leave session null, lock screen falls back to cached creds */
        console.log("Network timeout or offline fallback active. Booting via cached local credentials.");
        setSession(null);
      } finally {
        setLoading(false);
        // 2. Only attempt background worker setup if an authenticated user session was successfully resolved
        if (activeSession) {
          initSyncEngine(activeSession);
        }
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
