// KeyStore backed by the OS keychain (Windows Credential Manager on desktop).
//
// Keys are passed to the Rust commands sync_key_get / sync_key_set /
// sync_key_delete as base64 text. If the keychain is unavailable, every call
// fails with a clear error. Keys are never written to localStorage or files.

import type { KeyStore } from "@/lib/sync/sync-crypto";
import { fromBase64, toBase64 } from "@/lib/sync/sync-crypto";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export class KeychainUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeychainUnavailableError";
  }
}

export function createKeychainKeyStore(invoke: Invoke): KeyStore {
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw new KeychainUnavailableError(
        e instanceof Error ? e.message : "Secure key storage is not available",
      );
    }
  };
  return {
    get: (companyId) =>
      wrap(async () => {
        const v = await invoke<string | null>("sync_key_get", { companyId });
        return v ? fromBase64(v) : null;
      }),
    set: (companyId, rawKey) =>
      wrap(async () => {
        await invoke<void>("sync_key_set", { companyId, keyBase64: toBase64(rawKey) });
      }),
    delete: (companyId) =>
      wrap(async () => {
        await invoke<void>("sync_key_delete", { companyId });
      }),
  };
}

/** Default store for the running app. Throws if Tauri is not present (e.g. in a browser). */
export async function defaultKeychainKeyStore(): Promise<KeyStore> {
  const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (!hasTauri) {
    throw new KeychainUnavailableError("Secure key storage needs the desktop app");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return createKeychainKeyStore(invoke as Invoke);
}
