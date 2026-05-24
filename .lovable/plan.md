
# Going Local-Only — Available Paths

You've ruled out the "do it all in one shot" approach (too risky, big breakage window, half-broken .exe in between). Below are the **realistic remaining options**, ordered from safest to fastest.

---

## Option A — Phased migration (Recommended)

Split the work into 6 small phases. After each phase the app still runs end-to-end. You test, approve, then move to the next.

| Phase | Delivers | Effort | Risk |
|---|---|---|---|
| **A1. Strip auth + SSR + Electron** | App boots straight to company list. No login. Tauri only. Still uses Cloud as backend. | 1 session | Low |
| **A2. Local SQLite data layer** | New `src/lib/db/` mirrors Supabase API. Feature flag `LOCAL_MODE` added. Cloud still default. | 2 sessions | Low |
| **A3. Migrate all reads** | Reports, lists, lookups read from SQLite. Writes still go to Cloud. | 2–3 sessions | Medium |
| **A4. Migrate all writes + RPCs** | Vouchers, masters, year-end. Rewrite 15 PL/pgSQL functions in TypeScript. | 3–4 sessions | Medium-High |
| **A5. Online helpers + packaging** | GSTIN/IRP/OCR as direct `fetch`. First-launch backup folder prompt + daily auto-backup. Build `.exe`. | 1 session | Low |
| **A6. Cleanup** | Delete `supabase/`, server fns, web preview, types regeneration. | ½ session | Low |

**Total:** ~10–12 sessions over 2–3 weeks of part-time work.
**Pros:** App never breaks. You can ship to a pilot client after A5 even if A6 isn't done. Easy to roll back any phase.
**Cons:** Cloud cost continues until A6.

---

## Option B — Dual-mode forever (Cloud + Local toggle)

Don't remove Cloud. Add local SQLite as a parallel backend the user picks at first launch.

- Phases A1 (skip — keep auth as optional), A2, A3, A4 only.
- Skip A6 cleanup entirely.
- Each install asks: "Cloud sync (multi-device) or Local-only (this PC)?"

**Effort:** ~8–10 sessions.
**Pros:** Clients who later want sync can flip a switch. Web preview keeps working as a demo. You keep one codebase for both desktop and web.
**Cons:** ~2× the code paths to maintain. Every new feature needs both implementations. Cloud cost stays.

---

## Option C — Snapshot now, fork later

Keep building the current Cloud version normally. When a paying client actually asks for a local-only build, fork the repo and strip Cloud in that fork only.

- Zero work today.
- The fork is a one-time 20–40 hour project, paid for by the first client who wants it.

**Pros:** No disruption. Web product keeps improving. Local-only effort only happens when revenue justifies it.
**Cons:** The fork eventually diverges from the main repo — bug fixes have to be backported manually.

---

## Option D — Hybrid: Local-first, Cloud-as-backup-bucket

App runs 100% on local SQLite (like Option A's end state), but **encrypted backup `.zip` files** upload to your Cloud storage on a schedule. The client's data is on their PC; the backup is offsite. They never log in — backups use a per-install device key.

- Same effort as Option A (~10–12 sessions) plus 1 session for backup-upload helper.
- Strong selling point for Indian clients: "Your data never leaves your PC, but if your PC dies you call us and we ship you back the encrypted backup."

**Pros:** Best of both worlds. Disaster recovery without trust issues. You keep a small Cloud footprint.
**Cons:** Slightly more code. You're responsible for storing encrypted blobs.

---

## My recommendation

**Option A (phased migration).** Reasons:

1. You've already said clients want local-only and don't trust cloud.
2. Phasing keeps the app working at every checkpoint — no scary "broken for two weeks" window.
3. After A5 you can hand a working `.exe` to a pilot client while A6 cleanup happens in the background.
4. If anything goes wrong in A3 or A4, you roll back one phase, not the whole project.

**If budget/credits matter most:** Option C (do nothing until a client pays).
**If you might want multi-device later:** Option B.
**If clients want "local + offsite safety net":** Option D.

---

## Questions before I write the detailed Phase A1 plan

1. Which option — **A, B, C, or D**?
2. If A or D: should Phase A1 also **delete the login/signup/forgot-password/reset-password routes I just created**, or keep them dormant in case you change your mind?
3. If A: when A6 runs and the web preview goes down, do you want a **simple "Download the desktop app" landing page** at `your-smart-accountant.lovable.app`, or full takedown?
