// Vitest setup: install a fake IndexedDB into the Node global so Dexie
// (used by src/lib/offline/db.ts) can run in the test environment.
import "fake-indexeddb/auto";
