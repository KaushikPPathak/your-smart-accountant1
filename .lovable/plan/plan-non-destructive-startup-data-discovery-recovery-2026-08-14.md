# Plan: Non-Destructive Startup Data Discovery & Recovery

Implement a robust, idempotent discovery mechanism to recover existing company data from local snapshots when the IndexedDB state is lost or reset.

## User Review Required

> [!IMPORTANT]
> This repair is non-destructive. It uses existing snapshot files at `%LOCALAPPDATA%\com.smartaccountant.app\snapshots\` as authoritative sources to rebuild the company list if it's missing.

- **Idempotency**: Existing companies will not be duplicated.
- **Data Integrity**: Original UUIDs for companies, vouchers, and ledgers are preserved.
- **Safety**: A safety backup of current local state is created before any restoration.
- **Priority**: Discovery runs before any deduplication or onboarding logic.

## Technical Details

### 1. Snapshot Discovery Engine
- **File**: `src/lib/offline/snapshot-discovery.ts` (New)
- **Logic**: 
    - Scans the `snapshots/` root directory for the most recent snapshots.
    - Parses company metadata (ID, Name, Mode) from JSON payloads.
    - Injects missing companies into the IndexedDB `companies` and `cache_companies` tables.
    - Returns a list of "Found but Unloaded" companies.

### 2. Guarded Startup Sequence
- **File**: `src/routes/__root.tsx`
- **Change**: Call `discoverCompaniesFromSnapshots()` inside `LockGate` before the app decides whether to show the Welcome screen or Dashboard.
- **File**: `src/lib/auto-restore.ts`
- **Change**: Ensure `runAutoRestore` can target newly discovered IDs. Add a safety check against `integrity.json` to prevent overwriting newer data with older snapshots.

### 3. Safety & Cleanup
- **File**: `src/lib/update-safety.ts`
- **Change**: Delay `dedupeLocalCompaniesOnce` until after discovery.
- **File**: `src/lib/native-bridge.ts`
- **Change**: Add `listDirectoriesNative` to support scanning the `snapshots/` folder.

## Safeguards
- No changes to `src/lib/invoice-pdf.ts` (WhatsApp filename fix preserved).
- No changes to voucher numbering or workflow logic.
- Automated tests will verify: Fresh install behavior, discovery from empty DB, and duplicate prevention.

---
*Self-correction during planning: I will ensure the discovery scanner looks for the "latest" version of a snapshot per company ID to avoid multiple restores of the same company from different dates.*
