// Offline build switch.
//
// The desktop app runs fully offline: no Supabase sign-in, no cloud session,
// and no internet connection is needed to open the app or use it. All books,
// logins and company data stay on this device.
//
// Keep this false. Set it to true only if cloud accounts are deliberately
// brought back; every cloud path is gated on this constant.
export const CLOUD_AUTH_ENABLED = false;
