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

const sessionTimeoutFallback = { data: { session: null }, error: null } as Awaited<ReturnType<typeof supabase.auth.getSession>>;

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
    // IMPORTANT: ignore TOKEN_REFRESHED and INITIAL_SESSION events. Those fire
    // every time the tab regains focus (and roughly hourly when the access
    // token is refreshed). Calling setSession on them swaps the context value
    // by reference, re-rendering every consumer and blowing away half-filled
    // forms ("page reload on tab switch" bug). Only react to true identity
    // transitions.
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") {
        return;
      }
      setSession((prev) => {
        if (prev?.user?.id === newSession?.user?.id && prev?.access_token === newSession?.access_token) {
          return prev;
        }
        return newSession;
      });
      if (newSession && event === "SIGNED_IN") {
        // Seed the "last successful cloud handshake" clock so the offline
        // session-refresh watcher never false-warns immediately after a
        // fresh sign-in.
        import("./offline/session-refresh").then(m => m.markSessionFresh()).catch(() => undefined);
        initSyncEngine(newSession);
      }
    });

    (async () => {
      // Pre-warm the local DB regardless of network.
      import("./offline/db").catch(() => undefined);

      const isOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;
      let activeSession: Session | null = null;

      try {
        // Read any cached session immediately so the lock screen unblocks fast.
        // Add a small timeout for the initial session check to avoid blocking render on slow networks.
        const { data } = await Promise.race<Awaited<ReturnType<typeof supabase.auth.getSession>>>([
          supabase.auth.getSession(),
          new Promise((resolve) => setTimeout(() => resolve(sessionTimeoutFallback), 700))
        ]);
        if (data.session) {
          activeSession = data.session;
          setSession(data.session);
        }
      } catch {
        /* ignore — fall through to lock screen */
      } finally {
        // Release the UI as soon as we know the cached state. Don't block on network.
        setLoading(false);
        if (activeSession) {
          // Cached session already exists — seed the refresh clock so the
          // auto-refresh watcher knows when this device last talked to the cloud.
          import("./offline/session-refresh").then(m => m.markSessionFresh()).catch(() => undefined);
          initSyncEngine(activeSession);
        }
      }

      // Background: only attempt tech sign-in if we're actually online and have no session.
      if (isOnline && !activeSession) {
        Promise.race([
          ensureTechSession(),
          new Promise<void>((resolve) => setTimeout(resolve, 800)),
        ])
          .then(async () => {
            const { data } = await supabase.auth.getSession();
            if (data.session) {
              setSession(data.session);
              initSyncEngine(data.session);
            }
          })
          .catch(() => undefined);
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
