import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureTechSession } from "./tech-user";
const AuthContext = createContext(undefined);
const sessionTimeoutFallback = { data: { session: null }, error: null };
export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        // 1. Dynamic trigger function to initialize background sync operations securely
        const initSyncEngine = (currentSession) => {
            if (!currentSession)
                return; // Prevent worker from throwing 401 loops when offline/unsigned
            import("./offline/sync-worker")
                .then((m) => m.startSyncWorker())
                .catch(() => undefined);
            // One-time cloud-to-local migration for users upgrading from the
            // old cloud-primary version. Idempotent, non-blocking.
            import("./cloud-migration")
                .then((m) => m.scheduleCloudMigrationDown())
                .catch(() => undefined);
        };
        // Listener first (Supabase best practice).
        const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
            if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") {
                return;
            }
            setSession((prev) => {
                if (prev?.user?.id === newSession?.user?.id && prev?.access_token === newSession?.access_token) {
                    return prev;
                }
                // Only trigger update if identity actually changed
                return newSession;
            });
            if (newSession && event === "SIGNED_IN") {
                // Seed the "last successful cloud handshake" clock
                import("./offline/session-refresh").then(m => m.markSessionFresh()).catch(() => undefined);
                initSyncEngine(newSession);
            }
        });
        (async () => {
            // Pre-warm the local DB regardless of network.
            import("./offline/db").catch(() => undefined);
            const isOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;
            let activeSession = null;
            try {
                const { isCloudConfigured } = await import("./cloud-adapter");
                if (isCloudConfigured()) {
                    // Read any cached session immediately
                    const { data } = await Promise.race([
                        supabase.auth.getSession(),
                        new Promise((resolve) => setTimeout(() => resolve(sessionTimeoutFallback), 700))
                    ]);
                    if (data?.session) {
                        activeSession = data.session;
                        setSession(data.session);
                    }
                }
                else {
                    console.log("Supabase not configured, starting in local-only mode.");
                }
            }
            catch (err) {
                console.warn("Auth initialization failed:", err);
            }
            finally {
                setLoading(false);
                if (activeSession) {
                    import("./offline/session-refresh").then(m => m.markSessionFresh()).catch(() => undefined);
                    initSyncEngine(activeSession);
                }
                else {
                    // In local-only mode or no cloud session, still start worker for local processing
                    import("./local-only-mode").then(m => {
                        if (m.isLocalOnlyMode()) {
                            import("./offline/sync-worker").then(sw => sw.startSyncWorker()).catch(() => undefined);
                        }
                    }).catch(() => undefined);
                }
            }
            // Background: only attempt tech sign-in if we're actually online and have no session.
            const { isCloudConfigured: isCloudOk } = await import("./cloud-adapter");
            if (isOnline && !activeSession && isCloudOk()) {
                Promise.race([
                    ensureTechSession(),
                    new Promise((resolve) => setTimeout(resolve, 800)),
                ])
                    .then(async () => {
                    const { data } = await supabase.auth.getSession();
                    if (data?.session) {
                        setSession(data.session);
                        initSyncEngine(data.session);
                    }
                })
                    .catch(() => undefined);
            }
        })();
        return () => sub.subscription.unsubscribe();
    }, []);
    const value = {
        session,
        user: session?.user ?? null,
        loading,
        signOut: async () => {
            return;
        },
    };
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx)
        throw new Error("useAuth must be used inside AuthProvider");
    return ctx;
}
