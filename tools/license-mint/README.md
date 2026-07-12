# License minting tool

This folder contains the tools **you** (the seller) use to generate license
keys for buyers. It is **not** shipped inside the app. Keep `private.key` on
your PC only — treat it like the master key to your business.

## One-time setup (30 seconds)

```bash
bun run tools/license-mint/keygen.ts
```

This produces two files:

- `tools/license-mint/private.key` &mdash; keep this on your PC. Also copy it
  to a USB stick or password manager. **Never commit it. Never share it.**
- `src/lib/license/public-key.ts` &mdash; auto-updated. This is safe to
  commit; it gets baked into every build of the app.

After running keygen, rebuild the app (`bun run tauri:build`). Every copy
of the app that ships from that point on can verify licenses signed by
your private key &mdash; fully offline, no server.

> If you ever lose `private.key`, you cannot mint new keys with the same
> public key. Old keys already in the wild still work, but you'll have to
> keygen again + ship an update to all customers with the new public key.

## Minting a key for a customer (30 seconds per sale)

```bash
bun run tools/license-mint/mint.ts \
  --name "Ramesh Traders" \
  --email ramesh@example.com \
  --devices 2 \
  --plan pro \
  --expires 2027-07-12
```

Arguments:

- `--name`    Customer name (shown inside the app after activation).
- `--email`   Customer email.
- `--devices` How many PCs this one key may activate on. Use `1` for a
              single-device key, `3` for a small office, etc.
- `--plan`    `basic` &middot; `pro` &middot; `lifetime`.
              - `basic`     &mdash; vouchers + reports only.
              - `pro`       &mdash; everything (GSTR-1 JSON, e-invoice,
                cloud backup, multi-company).
              - `lifetime`  &mdash; same as `pro`, never expires.
- `--expires` ISO date (`YYYY-MM-DD`). Omitted for `lifetime`. Typical for
              a 1-year `pro` sale: 365 days from today.

The command prints a single line of text starting with `SMAC-PRO-...`.
Send that to the buyer (WhatsApp / email). They open the app, go to
**Settings &rarr; License**, paste it, click **Activate**. Done &mdash; no
internet check, no account creation.

## Selling flow, end to end

1. Buyer downloads and installs the app; the 30-day trial starts.
2. Buyer pays you (UPI / bank transfer / whatever).
3. You run `mint.ts` on your PC with their details, copy the output.
4. You send them the key.
5. They activate it inside the app. All features unlock immediately.

## Device-reset support ticket

If a buyer says "I bought a new laptop, my key won't activate anymore",
just re-mint their key with a bumped `--devices` value (or the same value
&mdash; their old device list gets replaced when they paste a fresh key
with the same license id... actually, the app treats a re-mint with a new
`id` as a new key). Simplest ops: always re-mint with a new date-based id
and send them the new string. The old key on the old PC keeps working
until it expires; the new key works on the new PC.

## Piracy reality

Even Tally and Busy get cracked. This system stops casual copying and
makes it obvious a copy is unlicensed (nag banner + watermarked exports).
The real recurring value is you, delivering statutory-format updates
(GSTR-1 JSON schema changes, e-invoice endpoint changes, etc.) to paying
customers. That's why customers stay paid, not the DRM.
