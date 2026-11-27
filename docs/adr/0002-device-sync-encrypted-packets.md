# ADR 0002: Device sync with encrypted packets

Status: accepted. Supersedes the sync part of ADR 0001 (the cloud layer as a plain-table sync target). ADR 0001 still describes the desktop SQLite and browser cache layers, which are unchanged.

## Context

The desktop app and the Android phone must share one company's books. The cloud account is the user's own OneDrive. No plain book data may reach our servers or be readable from the cloud.

## Decision

1. **Each device keeps its full books locally.** On desktop this is SQLite (ADR 0001). On Android it is the phone's local database. Reports read only the local copy.
2. **The cloud only transports encrypted packets.** A packet is AES-256-GCM encrypted with a per-company key. The key is kept in the OS keychain (Windows Credential Manager) or Android Keystore, and moves to a phone only during pairing.
3. **System of record by data type:**
   - Posted vouchers, ledgers, items and stock: the desktop is the system of record. Changes flow desktop → phone. The phone shows them read-only.
   - Phone entries: they are drafts. They flow phone → desktop and are posted only after the desktop user reviews them.
4. **No two devices write the same posted record.** The phone cannot edit a posted voucher. This removes the need for merge logic.
5. **Delivery:** each sender writes sequenced, encrypted batches. Receivers apply them once, in order, and wait for gaps. A batch is deleted only after every paired device has acknowledged it. Snapshots let a new device catch up.
6. **Recovery:** the company key is also saved as an encrypted recovery file in the user's OneDrive folder, accepted as a trade-off by the user.

## Consequences

- A phone draft is not a book entry until the desktop posts it. Reports on the phone exclude drafts.
- Any change to the voucher data model must update the packet mapping for both directions.
- Packets are kept until acknowledged by all paired devices, so an unpaired or lost phone can hold up cleanup. A device can be removed from the pairing list to release it.
