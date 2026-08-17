/**
 * Utility to check if cloud synchronization (Supabase) is configured and available.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
/**
 * Returns true if the environment variables required for Supabase are present.
 */
export function isCloudConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_KEY);
}
/**
 * Returns a user-friendly status message about the cloud connection.
 */
export function getCloudStatusMessage() {
    if (!isCloudConfigured()) {
        return "Cloud sync unavailable — working offline.";
    }
    return "Cloud sync active.";
}
