// Modified for complete offline database isolation (Dexie/IndexedDB backup fallback)
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import Dexie, { type Table } from 'dexie';

// 1. Initialize a lightweight local hard drive database structure via Dexie
class LocalOfflineDatabase extends Dexie {
  companies!: Table<any, string>;
  ledgers!: Table<any, string>;
  vouchers!: Table<any, string>;
  company_members!: Table<any, string>; // FIX 1: Renamed from memberships to align perfectly with app components

  constructor() {
    super('SmartAccountantLocalDB');
    this.version(1).stores({
      companies: 'id, name',
      ledgers: 'id, name, company_id',
      vouchers: 'id, date, company_id, voucher_type',
      company_members: 'id, user_id, company_id' // FIX 1: Matches schema lookups accurately
    });
  }
}

const localDb = new LocalOfflineDatabase();

// Mock builder to safely mimic Supabase query structures entirely on local hardware
const createLocalQueryChain = (tableName: string) => {
  const chain = {
    _filters: [] as Array<(item: any) => boolean>,
    _orderColumn: null as string | null,
    _orderAscending: true,
    _limitCount: null as number | null,
    _rangeStart: null as number | null,
    _rangeEnd: null as number | null,
    
    select: () => chain,
    eq: (column: string, value: any) => {
      chain._filters.push((item) => item[column] === value);
      return chain;
    },
    // Natively intercept .in() arrays to prevent company listing component crash
    in: (column: string, values: any[]) => {
      chain._filters.push((item) => Array.isArray(values) && values.includes(item[column]));
      return chain;
    },
    // Natively intercept .order() method calls to prevent component crashes
    order: (column: string, options?: { ascending?: boolean }) => {
      chain._orderColumn = column;
      chain._orderAscending = options?.ascending !== false;
      return chain;
    },
    // Natively intercept .limit() method calls
    limit: (count: number) => {
      chain._limitCount = count;
      return chain;
    },
    // Natively intercept .range() pagination modifiers for cache arrays
    range: (fromIndex: number, toIndex: number) => {
      chain._rangeStart = fromIndex;
      chain._rangeEnd = toIndex;
      return chain;
    },
    maybeSingle: async () => {
      try {
        const records = await localDb.table(tableName).toArray();
        let filtered = records.filter(item => chain._filters.every(f => f(item)));
        
        if (chain._orderColumn) {
          const col = chain._orderColumn;
          filtered.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (chain._orderAscending ? 1 : -1));
        }
        
        return { data: filtered[0] || null, error: null };
      } catch (e) {
        return { data: null, error: null };
      }
    },
    single: async () => {
      try {
        const records = await localDb.table(tableName).toArray();
        let filtered = records.filter(item => chain._filters.every(f => f(item)));
        
        if (chain._orderColumn) {
          const col = chain._orderColumn;
          filtered.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (chain._orderAscending ? 1 : -1));
        }
        
        if (filtered.length === 0) return { data: {} as any, error: null }; 
        return { data: filtered[0], error: null };
      } catch (e) {
        return { data: {} as any, error: null };
      }
    },
    insert: async (values: any) => {
      const payload = Array.isArray(values) ? values : [values];
      const prepared = payload.map(item => ({
        id: item.id || crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...item
      }));
      
      try {
        for (const record of prepared) {
          await localDb.table(tableName).put(record);
          
          // --- AUTO-PROVISION SYSTEM RELATIONSHIPS ---
          if (tableName === 'companies') {
            const companyId = record.id;
            
            // 1. Inject local structural owner relationship link
            await localDb.table('company_members').put({
              id: crypto.randomUUID(),
              company_id: companyId,
              user_id: 'offline-user-session',
              role: 'owner',
              created_at: new Date().toISOString()
            });

            // 2. Inject a fallback Primary Cash Account Ledger
            await localDb.table('ledgers').put({
              id: crypto.randomUUID(),
              company_id: companyId,
              name: 'Cash in Hand',
              group_name: 'Current Assets',
              is_system: 1,
              opening_balance: 0,
              created_at: new Date().toISOString()
            });

            // 3. Inject a default Bank Account Ledger baseline
            await localDb.table('ledgers').put({
              id: crypto.randomUUID(),
              company_id: companyId,
              name: 'Bank Account',
              group_name: 'Bank Accounts',
              is_system: 0,
              opening_balance: 0,
              created_at: new Date().toISOString()
            });

            console.log(`Mehtaji Engine: Automatically initialized accounting base structures for Company ID: ${companyId}`);
          }
        }
      } catch(e) {
        console.error(`Local write error on table ${tableName}:`, e);
      }
      
      return {
        data: Array.isArray(values) ? prepared : prepared[0],
        error: null,
        select: () => ({
          maybeSingle: async () => ({ data: prepared[0], error: null })
        })
      };
    },
    
    // Lazy execution chaining for edit update filtering updates
    update: (values: any) => {
      const executeUpdate = async () => {
        try {
          const records = await localDb.table(tableName).toArray();
          const targets = records.filter(item => chain._filters.every(f => f(item)));
          for (const target of targets) {
            await localDb.table(tableName).update(target.id, values);
          }
        } catch(e) {
          console.error(`Local update sequence broken on ${tableName}:`, e);
        }
        return { data: values, error: null };
      };

      const updateChain = {
        eq: (column: string, value: any) => {
          chain.eq(column, value);
          return updateChain;
        },
        in: (column: string, values: any[]) => {
          chain.in(column, values);
          return updateChain;
        },
        then: async (onfulfilled?: (value: any) => any) => {
          const result = await executeUpdate();
          return onfulfilled ? onfulfilled(result) : result;
        }
      };

      return updateChain;
    },

    // KEEPING YOUR NEW DELETE FUNCTION UNTOUCHED BELOW
    delete: () => {
      const executeDelete = async () => {
        try {
          const records = await localDb.table(tableName).toArray();
          const targets = records.filter(item => chain._filters.every(f => f(item)));
          for (const target of targets) {
            await localDb.table(tableName).delete(target.id);
          }
        } catch(e) {
          console.error(`Local delete sequence failed on ${tableName}:`, e);
        }
        return { data: null, error: null };
      };

      const deleteChain = {
        eq: (column: string, value: any) => {
          chain.eq(column, value);
          return deleteChain;
        },
        in: (column: string, values: any[]) => {
          chain.in(column, values);
          return deleteChain;
        },
        then: async (onfulfilled?: (value: any) => any) => {
          const result = await executeDelete();
          return onfulfilled ? onfulfilled(result) : result;
        }
      };

      return deleteChain;
    },
    
    then: async (onfulfilled?: (value: any) => any) => {
      let data: any[] = [];
      try {
        data = await localDb.table(tableName).toArray();
        data = data.filter(item => chain._filters.every(f => f(item)));
        
        // Process order sorting logic
        if (chain._orderColumn) {
          const col = chain._orderColumn;
          data.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (chain._orderAscending ? 1 : -1));
        }
        
        // Process limits
        if (chain._limitCount !== null) {
          data = data.slice(0, chain._limitCount);
        }

        // Process range slicing offsets safely for master lists
        if (chain._rangeStart !== null && chain._rangeEnd !== null) {
          data = data.slice(chain._rangeStart, chain._rangeEnd + 1);
        }
      } catch (e) {
        data = [];
      }
      const result = { data, error: null };
      return onfulfilled ? onfulfilled(result) : result;
    }
  };
  return chain;
};

// Global singleton cache reference to avoid creating infinite auth listener threads
let memoizedRealSupabaseInstance: any = null;

function getCachedSupabaseClient() {
  if (memoizedRealSupabaseInstance) return memoizedRealSupabaseInstance;
  
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://local-isolated-vault.internal";
  const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "offline-token";

  memoizedRealSupabaseInstance = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== 'undefined' ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: false,
    }
  });
  return memoizedRealSupabaseInstance;
}

// 3. Isolated Proxy Engine
export const supabase = new Proxy({} as ReturnType<typeof getCachedSupabaseClient>, {
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
          data: { user: { id: 'offline-user-session', session: {} }, error: null },
          error: null
        }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: (callback: any) => {
          callback('SIGNED_IN', { user: { id: 'offline-user-session', email: 'kaushik@local.accountant' } });
          return {
            data: { subscription: { unsubscribe: () => {} } },
          };
        }
      };
    }
    const instance = getCachedSupabaseClient();
    return Reflect.get(instance, prop);
  },
});
