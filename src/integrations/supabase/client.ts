// Manual architectural override: Making Supabase client optional for local-first desktop.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// No-op proxy handler for when Supabase is not configured
const noopHandler: ProxyHandler<any> = {
  get: (target, prop) => {
    if (prop === 'auth') {
      return {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        signOut: async () => {},
      };
    }
    if (prop === 'from') {
      return () => ({
        select: () => ({
          match: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }), range: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }), range: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
          range: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          order: () => ({ range: () => Promise.resolve({ data: [], error: null }) }),
          in: () => Promise.resolve({ data: [], error: null }),
          eq: () => ({ gte: () => ({ is: () => Promise.resolve({ data: [], error: null }) }), is: () => Promise.resolve({ data: [], error: null }) }),
        }),
        insert: () => Promise.resolve({ data: null, error: null }),
        update: () => Promise.resolve({ data: null, error: null }),
        delete: () => Promise.resolve({ data: null, error: null }),
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
