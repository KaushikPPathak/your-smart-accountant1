---
name: Auto-restore is silent
description: When live IndexedDB is empty but a valid snapshot exists, restore silently — never prompt. Prompt only for genuine ambiguity.
type: constraint
---
On every launch `runAutoRestore()` in `src/lib/auto-restore.ts` checks each
company's live row counts against the integrity manifest
(`src/lib/integrity.ts`). If manifest says N > 0 rows and live has 0 (or
< 50 %), it MUST restore the newest checksum-valid snapshot for that
company without asking. The user sees a non-blocking toast only.

Do NOT add a confirmation dialog, "review before restore" step, or
approval flow to this path. Financial data loss on launch causes user
panic — recovery must be automatic. `BackupInspectDialog` and
`RestoreFromFileDialog` are for user-initiated restores, not this path.

Prompts are allowed only when:
  - No manifest exists AND snapshots are found (fresh install with legacy files).
  - Multiple snapshot lineages disagree (different company IDs / GSTINs).

**Why:** July 2026 incident — users found empty companies after an update
and could not recover without support. Rule: any preventable data loss is
recovered before the UI even renders the empty state.
