# Device Smoke Checklist — Backup & Restore

Print this. Run through it on the real device before every release. Automated
tests can only prove what they simulate; this drill proves the app behaves
correctly on YOUR actual install.

Time required: ~5 minutes.
Signed off by: __________________________  Date: __________  Build: __________

---

## 0. Preconditions

- [ ] Device has at least THREE companies on it. If not, create dummies "Alpha",
      "Beta", "Gamma" with 2–3 vouchers each. The bug only shows up when other
      companies are present.
- [ ] Note the exact list on the login/company picker BEFORE starting:
      1. ___________________________
      2. ___________________________
      3. ___________________________
- [ ] Note voucher counts per company (open each, note total):
      Alpha: ____   Beta: ____   Gamma: ____

## 1. Backup

- [ ] Sign in, pick company "Alpha".
- [ ] Settings → Backup → "Download backup file".
- [ ] File downloads as `.laccbak` (or `.json`).
- [ ] File size is > 0 bytes. Note size: ______ KB.
- [ ] Move the file somewhere safe (Desktop, Drive, USB).

## 2. Corrupt (safe)

- [ ] Still on Alpha, delete ONE voucher (any voucher). Confirm the count
      dropped by 1.
- [ ] Do NOT touch Beta or Gamma.

## 3. Restore — the exact user scenario

- [ ] Settings → Backup → "Restore from file".
- [ ] Pick the Alpha backup file from step 1.
- [ ] The inspect dialog opens and shows a PREVIEW:
      - Company name: Alpha (matches)
      - Voucher count: matches original Alpha count from step 0
      - Checksum: green ✓
- [ ] Click Restore. Type Alpha's name to confirm.
- [ ] Toast: "Restored" (green).

## 4. Verify — the four things that must be true

- [ ] **Login / company picker still shows exactly 3 companies**:
      Alpha, Beta, Gamma. **NOT** 4, 5, or 6. **NO** duplicates.
- [ ] **Alpha voucher count** matches original from step 0 (not step 2's
      reduced count).
- [ ] **Beta voucher count** is UNCHANGED from step 0.
- [ ] **Gamma voucher count** is UNCHANGED from step 0.

If any of the above fails: **STOP. Do not release.** File a bug tagged
`restore-safety` and attach the backup file used.

## 5. Undo drill

- [ ] Settings → Backup → "Undo last restore" is visible and enabled
      (within 24h of the restore).
- [ ] Click Undo. Confirm.
- [ ] Alpha's voucher count is back to the "corrupted" count from step 2
      (i.e. the pre-restore state was captured).
- [ ] Beta and Gamma still unchanged.

## 6. Cleanup

- [ ] Restore Alpha again from the backup so the device is left in a good
      state.
- [ ] Confirm 3 companies, correct counts.

---

## Sign-off

I ran every step above on a real device build. Every checkbox is ticked.
No step was skipped or interpreted loosely.

Signature: __________________________  Device/OS: __________________________
