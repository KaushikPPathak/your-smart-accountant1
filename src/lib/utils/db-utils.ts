
/**
 * Authoritative database utility wrappers for Dexie/IndexedDB.
 * Standardizes transactions, reads, and error handling.
 */

import { db } from "@/lib/offline/db";
import { type Table, type Transaction } from "dexie";

/**
 * Perform a database operation within a read-only transaction.
 */
export async function withReadTransaction<T>(
  tables: string[],
  fn: (transaction: Transaction) => Promise<T>
): Promise<T> {
  try {
    return await db.transaction("r", tables, fn);
  } catch (error) {
    console.error("Database read transaction failed:", error);
    throw error;
  }
}

/**
 * Perform a database operation within a read-write transaction.
 */
export async function withWriteTransaction<T>(
  tables: string[],
  fn: (transaction: Transaction) => Promise<T>
): Promise<T> {
  try {
    return await db.transaction("rw", tables, fn);
  } catch (error) {
    console.error("Database write transaction failed:", error);
    throw error;
  }
}

/**
 * Safely read a single record by ID.
 */
export async function readById<T>(table: Table<T, string>, id: string): Promise<T | undefined> {
  return await table.get(id);
}

/**
 * Safely delete records by a criteria.
 */
export async function deleteByCriteria<T>(
  table: Table<T, any>,
  criteria: Record<string, any>
): Promise<number> {
  return await table.where(criteria).delete();
}
