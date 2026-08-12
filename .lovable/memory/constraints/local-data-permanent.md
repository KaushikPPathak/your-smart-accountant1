---
name: Local data is permanent
description: The app never auto-deletes user backups/snapshots. No day-count, no rotation, no config switch. Only the user can delete files.
type: constraint
---
Local snapshots (`%LOCALAPPDATA%\com.smartaccountant.app\snapshots\`) and
backups are kept forever on the user's device. Do NOT add prune/rotate/TTL
logic against local storage. Retention constants in `backup-policy.ts` are
recommendations for OFFSITE (USB/cloud) copies only, not enforced against
disk. The pre-restore safety snapshot in `restore-safety.ts` has a 24h TTL
— that is a separate, tiny undo buffer inside IndexedDB `meta`, not a
user-facing backup, and its TTL is intentional.

**Why:** basic accounting principle — user's books must survive until the
user themselves decides to delete them.
