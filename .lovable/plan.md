## Issue

GitHub Actions warns that `actions/upload-artifact@v5` and `softprops/action-gh-release@v2` still ship a `node20` runtime. We already set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'` so they execute on Node 24, but the deprecation banner still appears because the actions' own metadata declares `node20`. The fix is to swap in maintainers' implementations that target `node24` and remove the global force flag once everything is clean.

## Plan

Edit `.github/workflows/build-windows-installer.yml` only:

1. **Remove** the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env (no longer needed once actions are node24-native).
2. **Replace `softprops/action-gh-release@v2`** with the GitHub CLI (`gh release create`), which runs natively on the runner's Node 24 / shell and has no node20 dependency. It already supports uploading multiple files and auto-generated notes via `--generate-notes`.
3. **Keep `actions/upload-artifact@v5`** — v5 is the latest. The warning will disappear once GitHub publishes the node24 build of v5; in the meantime, pin to the current SHA and add a comment noting it's tracked upstream. (Alternative: drop the force flag and accept the single residual warning until v6 ships.)
4. **Confirm** `actions/checkout@v5` and `actions/setup-node@v5` are already node24-compatible — no change needed.

### Replacement snippet for the release step

```yaml
- name: Create GitHub Release
  if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')
  shell: bash
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    TAG="v1.0.0-${{ github.run_number }}"
    gh release create "$TAG" \
      YourMehtaji-Setup-1.0.0.exe \
      YourMehtaji-Portable-1.0.0.zip \
      --title "Your Mehtaji Setup (build ${{ github.run_number }})" \
      --generate-notes
```

## Question for you

For `actions/upload-artifact@v5`, do you want me to:
- **(a)** Leave it as-is and accept the single remaining node20 warning until GitHub ships v6, or
- **(b)** Also replace it with a manual upload step (e.g. `gh` CLI artifact upload via API), which is more code but kills the warning today?

I'd recommend **(a)** — it's the supported version and the warning is harmless until the deprecation date.
