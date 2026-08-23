
/**
 * Internal system utilities for Smart Accountant.
 */

/**
 * Generate a new random UUID.
 */
export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Get current UTC timestamp in ISO format.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Safely resolve a database instance from dynamic imports.
 */
export async function getDbInstance() {
  const module = await import("@/lib/offline/db");
  return module.default || module.offlineDb || (module as any).db;
}
