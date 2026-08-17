# Redesign for True Local-First Desktop Application

The application will be refactored to prioritize local data and ensure successful startup even when Supabase configuration is missing or unreachable. Supabase will become an optional cloud provider.

## User-facing changes
- **Offline Reliability**: The app will launch instantly without waiting for cloud handshakes.
- **Improved Status**: Clear "Cloud sync unavailable" messaging instead of fatal errors when offline.
- **Local Autonomy**: All accounting features will remain fully functional without internet.

## Technical Details

### 1. Abstracting the Supabase Client
- Modify `src/integrations/supabase/client.ts` (manually overriding the "do not edit" warning for this architectural shift) to handle missing environment variables gracefully.
- Return a "Null/No-op Client" proxy if `VITE_SUPABASE_URL` is missing. This prevents the `supabaseUrl is required` exception at module load time.

### 2. Guarding Context Providers
- **AuthContext (`src/lib/auth-context.tsx`)**: Refactor to handle a null or non-functional Supabase client. If Supabase is unavailable, it will default to a "Local Guest" session or read from the local credential cache immediately.
- **Sync Worker (`src/lib/offline/sync-worker.ts`)**: Ensure it short-circuits all server-bound operations if Supabase is not configured, focusing solely on local outbox materialization.

### 3. Desktop Startup Sequence
- **Root Route (`src/routes/__root.tsx`)**: Explicitly verify that local discovery, DB initialization, and data-root resolution happen BEFORE any cloud-related effects.
- Ensure the "Branded Loading State" is robust and appears even if dynamic imports for Supabase-related modules fail.

### 4. Optional Cloud Adapter
- Create `src/lib/cloud-adapter.ts` to encapsulate the availability check: `isCloudConfigured()`.
- UI components that rely on Supabase (like Cloud Backup) will use this check to show appropriate "Offline" states or hide buttons.

### 5. Data Preservation
- Preserve `C:\smartaccountant` and existing snapshot discovery logic.
- Ensure the Electron legacy build uses the existing local accounting data root via IPC.

## Acceptance Criteria
- App starts with a blank `.env` (no Supabase keys).
- Local companies load from IndexedDB/Snapshots.
- Vouchers and reports work entirely offline.
- Re-enabling keys enables background sync without requiring code changes.
