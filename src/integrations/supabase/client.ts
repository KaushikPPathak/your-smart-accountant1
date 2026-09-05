// Manual architectural override: Making Supabase client optional for local-first desktop.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Define a permanent offline session to bypass login locks
const offlineSession = {
  access_token: 'offline-token',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'offline-refresh',
  user: { 
    id: 'offline-local-user-id', 
    email: 'local@offline.com', 
    role: 'authenticated',
    aud: 'authenticated'
  }
};

// No-op proxy handler for when Supabase is not configured
const noopHandler: ProxyHandler<any> = {
  get: (target, prop) => {
    if (prop === 'auth') {
      return {
        // 1. Force the app to always see an active session on load
        getSession: async () => ({ data: { session: offlineSession }, error: null }),
        getUser: async () => ({ data: { user: offlineSession.user }, error: null }),
        
        // 2. Immediately tell the router the user is signed in
        onAuthStateChange: (callback: any) => {
          setTimeout(() => callback('SIGNED_IN', offlineSession), 10);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        
        // 3. Prevent crashes if login/signup buttons are accidentally clicked
        signInWithPassword: async () => ({ data: { session: offlineSession, user: offlineSession.user }, error: null }),
        signUp: async () => ({ data: { session: offlineSession, user: offlineSession.user }, error: null }),
        signOut: async () => ({ error: null }),
      };
    }
    if (prop === 'functions') {
      return {
        invoke: async (functionName: string) => {
          // Return a safe dummy response for the AI chat to prevent it from crashing the UI
          if (functionName === "ai-chat" || functionName.includes("ai")) {
            return { data: { reply: "I am offline. Please connect to the cloud to use AI features." }, error: null };
          }
          return { data: null, error: { message: 'Cloud functions not available in local-only mode' } };
        }
      };
    }
    if (prop === 'channel') {
      return () => ({
        on: function() { return this; },
        subscribe: function() { return this; },
        unsubscribe: async () => {},
        send: async () => {},
      });
    }
    if (prop === 'from') {
      // Create a chainable query mock so .update().eq() works
      const createQuery = () => {
        const query: any = {
          select: () => query,
          match: () => query,
          order: () => query,
          limit: () => query,
          range: () => query,
          eq: () => query,
          neq: () => query,
          gt: () => query,
          gte: () => query,
          lt: () => query,
          lte: () => query,
          like: () => query,
          ilike: () => query,
          is: () => query,
          in: () => query,
          contains: () => query,
          containedBy: () => query,
          rangeGt: () => query,
          rangeGte: () => query,
          rangeLt: () => query,
          rangeLte: () => query,
          rangeAdjacent: () => query,
          overlaps: () => query,
          textSearch: () => query,
          filter: () => query,
          or: () => query,
          single: () => Promise.resolve({ data: null, error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          csv: () => query,
          then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
        };
        return query;
      };
      return () => ({
        select: createQuery,
        insert: createQuery,
        update: createQuery,
        upsert: createQuery,
        delete: createQuery,
      });
    }
    // Return a dummy function for everything else to avoid "not a function" crashes
    return () => ({
      from: () => ({
        select: () => ({ match: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
        insert: () => Promise.resolve({ data: null, error: null }),
        update: () => Promise.resolve({ data: null, error: null }),
        delete: () => Promise.resolve({ data: null, error: null }),
      }),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => ({
        on: function() { return this; },
        subscribe: function() { return this; },
      }),
    });
  }
};

/**
 * The Supabase client. 
 * If VITE_SUPABASE_URL is missing, returns a no-op Proxy to prevent startup crashes.
 */
export const supabase = (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)
  ? createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        persistSession: true,
        autoRefreshToken: true,
      }
    })
  : (new Proxy({}, noopHandler) as any);
