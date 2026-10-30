import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

// Offline build: there is no cloud sign-in. The app identifies itself with a
// fixed local identity, the same id the offline Supabase stub reports, so
// every screen that reads a user id keeps working without a network call.
const LOCAL_USER = {
  id: "offline-local-user-id",
  aud: "local",
  app_metadata: {},
  user_metadata: {},
  created_at: "",
} as unknown as User;

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Pre-warm the local database and start local processing. Nothing here
        // touches the network.
        await import("./offline/db").catch(() => undefined);
        const { isLocalOnlyMode } = await import("./local-only-mode");
        if (isLocalOnlyMode()) {
          await import("./offline/sync-worker")
            .then((sw) => sw.startSyncWorker())
            .catch(() => undefined);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value: AuthContextValue = {
    session: null,
    user: LOCAL_USER,
    loading,
    signOut: async () => {
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
