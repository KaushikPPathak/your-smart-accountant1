// Modified for complete offline database isolation (Dexie/IndexedDB backup fallback)
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import Dexie, { type Table } from 'dexie';

// 1. Initialize a lightweight local hard drive database structure via Dexie
class LocalOfflineDatabase extends Dexie {
  companies!: Table<any, string>;
  ledgers!: Table<any, string>;
  vouchers!: Table<any, string>;
  memberships!: Table<any, string>;

  constructor() {
    super('SmartAccountantLocalDB');
    this.version(1).stores({
      companies: 'id, name',
      ledgers: 'id, name, company_id',
      vouchers: 'id, date, company_id, voucher_type',
      memberships: 'id, user_id, company_id'
    });
  }
}

const localDb = new LocalOfflineDatabase();

// Mock builder to safely mimic Supabase query structures entirely on local hardware
const createLocalQueryChain = (tableName: string) => {
  const chain = {
    _filters: [] as Array<(item: any) => boolean>,
    
    select: () => chain,
    eq: (column: string, value: any) => {
      chain._filters.push((item) => item[column] === value);
      return chain;
    },
    maybeSingle: async () => {
      const records = await localDb.table(tableName).toArray();
      const filtered = records.filter(item => chain._filters.every(f => f(item)));
      return { data: filtered[0] || null, error: null };
    },
    single: async () => {
      const records = await localDb.table(tableName).toArray();
      const filtered = records.filter(item => chain._filters.every(f => f(item)));
      if (filtered.length === 0) return { data: null, error: { message: 'Not found' } };
      return { data: filtered[0], error: null };
    },
    insert: async (values: any) => {
      const payload = Array.isArray(values) ? values : [values];
      const prepared = payload.map(item => ({
        id: item.id || crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...item
      }));
      
      for (const record of prepared) {
        await localDb.table(tableName).put(record);
      }
      
      return {
        data: Array.isArray(values) ? prepared : prepared[0],
        error: null,
        select: () => ({
          maybeSingle: async () => ({ data: prepared[0], error: null })
        })
      };
    },
    update: async (values: any) => {
      const records = await localDb.table(tableName).toArray();
      const targets = records.filter(item => chain._filters.every(f => f(item)));
      for (const target of targets) {
        await localDb.table(tableName).update(target.id, values);
      }
      return { data: values, error: null };
    },
    then: async (onfulfilled?: (value: any) => any) => {
      const records = await localDb.table(tableName).toArray();
      const filtered = records.filter(item => chain._filters.every(f => f(item)));
      const result = { data: filtered, error: null };
      return onfulfilled ? onfulfilled(result) : result;
    }
  };
  return chain;
};

// 2. Client Fallback Definition
function createSupabaseClient() {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://local-isolated-vault.internal";
  const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "offline-token";

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== 'undefined' ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: false,
    }
  });
}

// 3. Isolated Proxy Engine
// Intercepts data fetching operations and processes them directly on the local hard disk
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(target, prop) {
    if (prop === 'from') {
      return (tableName: string) => createLocalQueryChain(tableName);
    }
    if (prop === 'auth') {
      return {
        getUser: async () => ({
          data: { user: { id: 'offline-user-session', email: 'kaushik@local.accountant' } },
          error: null
        }),
        getSession: async () => ({
          data: { session: { user: { id: 'offline-user-session' } } },
          error: null
        }),
        signInWithPassword: async () => ({
          data: { user: { id: 'offline-user-session' }, session: {} },
          error: null
        }),
        signOut: async () => ({ error: null })
      };
    }
    const instance = createSupabaseClient();
    return Reflect.get(instance, prop);
  },
});
