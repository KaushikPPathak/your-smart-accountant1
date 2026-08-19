# Plan: Fix Missing "Go Back to Previous Version" UI for Legacy Environments

The user reports that the "Go back to previous version" screen (Rollback Offer) is not appearing in legacy environments like Windows 7. This is critical for users who need to revert updates that may cause issues on older hardware.

## Proposed Changes

### 1. Verification of Rollback Logic
- Inspect `src/lib/update-safety.ts` to ensure `checkUpdateSafety` correctly records `ROLLBACK_OFFER_KEY` across version changes.
- Verify that `currentVersion()` correctly identifies versions on legacy Windows runpoints (WebView2).

### 2. Visibility and Accessibility
- Update `UpdateRollbackBanner.tsx` to ensure it triggers correctly on launch if an offer exists.
- Add a manual "Check for Rollback" entry in **Settings → Administration** so users can access the rollback instructions even if the automatic banner was dismissed or failed to render.

### 3. Documentation Improvements
- Update the rollback instructions in `UpdateRollbackBanner.tsx` to explicitly mention Windows 7 compatibility and how to handle the installer in legacy environments.

## Technical Details
- The rollback offer is stored in `localStorage` under `ym_rollback_offer`.
- The `UpdateRollbackBanner` component in `src/routes/app.tsx` renders this banner based on the presence of that key.
- We will add a manual trigger in `src/routes/app.settings.administration.tsx` (if it exists) or a similar location to ensure visibility.

## User Review Required
- The banner only appears once after an update. If it was dismissed, the user currently has no way to see those instructions again within the app. I will add a manual button in Settings for this.
