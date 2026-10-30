/**
 * Utility to check if cloud synchronization (Supabase) is configured and available.
 */

import { CLOUD_AUTH_ENABLED } from "./app-mode";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Returns true if the environment variables required for Supabase are present.
 */
export function isCloudConfigured(): boolean {
  // Offline build: cloud is off regardless of environment keys.
  return CLOUD_AUTH_ENABLED && Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Returns a user-friendly status message about the cloud connection.
 */
export function getCloudStatusMessage(): string {
  if (!isCloudConfigured()) {
    return "Cloud sync unavailable — working offline.";
  }
  return "Cloud sync active.";
}
