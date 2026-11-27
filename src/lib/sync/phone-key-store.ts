// KeyStore for the Android app. Keys are kept by the secure-key plugin, which
// wraps them with a hardware-backed Android Keystore key.

import { createKeychainKeyStore } from "@/lib/sync/keychain-store";
import type { KeyStore } from "@/lib/sync/sync-crypto";

const COMMANDS: Record<string, string> = {
  sync_key_get: "plugin:secure-key|get_key",
  sync_key_set: "plugin:secure-key|set_key",
  sync_key_delete: "plugin:secure-key|delete_key",
};

export async function phoneKeyStore(): Promise<KeyStore> {
  const { invoke } = await import("@tauri-apps/api/core");
  return createKeychainKeyStore((cmd, args) => {
    const target = COMMANDS[cmd];
    if (!target) return Promise.reject(new Error(`Unknown key command ${cmd}`));
    return invoke(target, args);
  });
}
