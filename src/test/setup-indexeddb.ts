// Vitest setup: install a fake IndexedDB and minimal browser stubs so
// modules that reference `localStorage`/`window` at import time (e.g. the
// Supabase client) don't crash in the Node test environment.
import "fake-indexeddb/auto";

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
}

const g = globalThis as unknown as Record<string, unknown>;
if (!g.localStorage) g.localStorage = new MemoryStorage();
if (!g.sessionStorage) g.sessionStorage = new MemoryStorage();
if (!g.window) g.window = globalThis;
