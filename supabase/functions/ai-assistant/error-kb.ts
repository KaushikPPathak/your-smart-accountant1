// Comprehensive error / failure-mode knowledge base for the in-app assistant.
//
// Every entry pairs an observable symptom (toast text, console line, or user
// phrasing) with a root cause and the exact remedy — file path, button, or
// shortcut. Keep entries short and factual. Add new ones as you discover them.
//
// This file is loaded by supabase/functions/ai-assistant/index.ts. When you
// add an entry here, no other change is needed; the assistant picks it up on
// the next request.

export interface ErrorEntry {
  /** Short unique tag, used only for internal reference. */
  id: string;
  /** Category — used to group entries in the prompt. */
  category:
    | "Runtime"
    | "Data"
    | "Voucher"
    | "GST"
    | "License"
    | "Backup"
    | "Keyboard"
    | "Auth"
    | "UI"
    | "AI"
    | "Reports"
    | "Import"
    | "Native";
  /** Symptoms — toast text, console line, or user phrasing. */
  symptoms: string[];
  /** Root cause in one line. */
  cause: string;
  /** Precise remedy — file path, button, or shortcut. */
  fix: string;
}

export const ERROR_KB: ErrorEntry[] = [
  // ────────────────────────────── Runtime / UI ──────────────────────────────
  {
    id: "tooltip-provider",
    category: "UI",
    symptoms: [
      "Tooltip must be used within TooltipProvider",
      "tulip error",
      "Something went wrong when opening companies",
    ],
    cause: "A Tooltip rendered outside <TooltipProvider>.",
    fix: "TooltipProvider is installed globally in src/routes/__root.tsx wrapping the whole app. If the error recurs, a new component renders a Tooltip above the root — move it inside the provider or lazy-render after mount.",
  },
  {
    id: "dialog-focus-lost",
    category: "UI",
    symptoms: [
      "focus disappears after closing a dialog",
      "keyboard stops after modal",
    ],
    cause: "Dialog did not restore activeElement on close.",
    fix: "src/components/ui/dialog.tsx restores focus in onOpenChange(false). Ensure no custom Dialog subclass bypasses this handler.",
  },
  {
    id: "blank-white-screen",
    category: "UI",
    symptoms: [
      "blank white screen",
      "goes to blank page after clicking a link in AI chat",
    ],
    cause: "Full navigation via window.location instead of TanStack Router navigate().",
    fix: "Use useNavigate() from @tanstack/react-router. AssistantChat.tsx and voucher-intent links must use navigate({ to: ... }).",
  },
  {
    id: "nested-buttons",
    category: "UI",
    symptoms: [
      "delete button on thread list does nothing",
      "invalid HTML: <button> inside <button>",
    ],
    cause: "Nested interactive elements.",
    fix: "Use a non-button container for the row with a sibling delete button.",
  },
  {
    id: "error-boundary-loop",
    category: "Runtime",
    symptoms: [
      "app shows fallback error page repeatedly",
      "reload button does not help",
    ],
    cause: "Error boundary catches an error thrown during render on every mount (bad cached state).",
    fix: "Clear the corrupt key from localStorage, then reload. Check console for the original stack; the boundary logs it before showing the fallback.",
  },

  // ────────────────────────────── Data / IndexedDB ─────────────────────────
  {
    id: "invalid-id",
    category: "Data",
    symptoms: ["Invalid id when saving a voucher", "Invalid id on opening company"],
    cause: "Legacy imported rows have non-UUID ids.",
    fix: "src/lib/schemas/common.ts accepts non-UUID ids. If it recurs, the schema was reverted — re-apply the relaxed id validator.",
  },
  {
    id: "cannot-coerce",
    category: "Data",
    symptoms: [
      "Cannot coerce the result to a single JSON object",
      "pencil edit fails on company",
    ],
    cause: ".maybeSingle() on a row missing in the cloud.",
    fix: "src/routes/app.companies.tsx openEdit() falls back to local IndexedDB. Apply the same pattern anywhere maybeSingle() may return null for local-only rows.",
  },
  {
    id: "data-date-regression",
    category: "Data",
    symptoms: [
      "data up to old date after fresh install",
      "books rewound to February after installing new build",
    ],
    cause: "Snapshot scanner missed nested Documents/YourMehtaji/Exports paths.",
    fix: "Patched in src/lib/native-bridge.ts. Re-run Restore (R button next to the company name).",
  },
  {
    id: "integrity-scan-noise",
    category: "Data",
    symptoms: [
      "Integrity scan found N issue(s): missing state_code / missing group_id",
      "backup shows warnings before proceeding",
    ],
    cause: "Legacy false alarms — most fields are auto-derivable.",
    fix: "Suppressed in src/lib/integrity-scan.ts. Backup still proceeds. Only worry if it blocks the save.",
  },
  {
    id: "orphan-voucher-entries",
    category: "Data",
    symptoms: [
      "trial balance does not tie",
      "voucher_entries reference a ledger that no longer exists",
    ],
    cause: "Ledger deleted while a voucher still referenced it.",
    fix: "Run Utilities → Data Health → Rebuild. It re-creates the missing ledger under Suspense.",
  },
  {
    id: "duplicate-company",
    category: "Data",
    symptoms: [
      "same company shows twice in company list",
      "two entries for one firm after restore",
    ],
    cause: "Restore imported the snapshot without deduping by name.",
    fix: "Open MergeCompaniesTool (Utilities → Merge Companies). Pick the master and the duplicate; vouchers move to master.",
  },
  {
    id: "local-only-sync",
    category: "Data",
    symptoms: [
      "why did my data go to cloud",
      "business data uploaded to server",
    ],
    cause: "This does not happen. isLocalOnlyMode() short-circuits sync worker, outbox drain, and snapshot pull.",
    fix: "Only auth (login/profile) uses the cloud. All business data stays in local IndexedDB. Backup is opt-in to the user's own drive.",
  },

  // ────────────────────────────── Voucher entry ────────────────────────────
  {
    id: "ctrl-s-not-saving",
    category: "Voucher",
    symptoms: ["Ctrl+S does not save voucher", "must save with mouse"],
    cause: "Voucher editor missed the save shortcut binding.",
    fix: "Ctrl+S is wired via useShortcut('mod+s') in the voucher editor. If broken, check EntryVoucherForm.tsx and ItemVoucherForm.tsx retain that binding.",
  },
  {
    id: "arrow-left-no-back",
    category: "Voucher",
    symptoms: [
      "cannot go back to previous field with arrow key",
      "stuck in description column",
    ],
    cause: "useFormEnterNav did not support ArrowLeft.",
    fix: "src/lib/keyboard/useFormEnterNav.ts moves to previous field on ArrowLeft when the caret is at position 0.",
  },
  {
    id: "voucher-header-order",
    category: "Voucher",
    symptoms: ["field order in voucher header seems wrong"],
    cause: "Convention.",
    fix: "Order is Date → Party → Reference No → Place of Supply. Never reorder these.",
  },
  {
    id: "manufacturing-journal",
    category: "Voucher",
    symptoms: [
      "manufacturing entry does not affect finished goods",
      "raw material stock not consumed",
    ],
    cause: "Missing stock journal posting.",
    fix: "Manufacturing Journal posts Dr Finished Goods / Cr Raw Materials (auto-created under STOCK_IN_HAND) plus voucher_items rows for inventory moves.",
  },
  {
    id: "quick-ledger-case",
    category: "Voucher",
    symptoms: ["ledger names save in lowercase", "party 'sharma & co' saved as lowercase"],
    cause: "Title-case not applied at input.",
    fix: "QuickLedgerDialog and QuickItemDialog now title-case names on blur.",
  },

  // ────────────────────────────── GST ──────────────────────────────────────
  {
    id: "gst-shown-when-not-registered",
    category: "GST",
    symptoms: [
      "GST API screen shown for non-GST company",
      "GST config visible on unregistered firm",
    ],
    cause: "Settings did not read gst_registered.",
    fix: "src/routes/app.settings.tsx hides GST panels when gst_registered === false.",
  },
  {
    id: "state-code-missing",
    category: "GST",
    symptoms: ["place of supply blank", "GSTIN present but state_code null"],
    cause: "state_code not derived from GSTIN prefix.",
    fix: "state_code = gstin.slice(0, 2). Applied at company creation and in migration seeds.",
  },
  {
    id: "hsn-missing",
    category: "GST",
    symptoms: ["HSN dropdown missing common codes"],
    cause: "Small seed list.",
    fix: "~450 additional HSN/SAC codes merged into seeding. If a code is still missing, add it to src/lib/hsn-seed.ts and reseed.",
  },

  // ────────────────────────────── License ──────────────────────────────────
  {
    id: "no-public-key",
    category: "License",
    symptoms: ["This build has no public key baked in — contact support."],
    cause: "src/lib/license/public-key.ts is empty.",
    fix: "Paste the hex public key from the license kit into that file. Rebuild.",
  },
  {
    id: "license-lost-after-update",
    category: "License",
    symptoms: ["license gone after installing new build"],
    cause: "Installer overwrote local key store, or the new build was compiled without the public key.",
    fix: "Confirm src/lib/license/public-key.ts holds the correct hex. Then re-import the license file the customer received.",
  },

  // ────────────────────────────── Backup / Restore ─────────────────────────
  {
    id: "backup-icon-missing",
    category: "Backup",
    symptoms: ["where is backup button", "cannot find backup"],
    cause: "n/a.",
    fix: "The B-badged DatabaseBackup icon sits to the right of the company name in the top bar. Click once to write to Documents/YourMehtaji/Exports/<Company>/.",
  },
  {
    id: "restore-icon-missing",
    category: "Backup",
    symptoms: ["where is restore", "how do I restore"],
    cause: "n/a.",
    fix: "The R-badged DatabaseZap icon sits next to Backup. Click, review the snapshot preview, type the company name to confirm.",
  },
  {
    id: "trial-books-toggle",
    category: "Backup",
    symptoms: ["cannot find trial-books toggle", "how to enable local-only"],
    cause: "n/a — it was removed.",
    fix: "Local-only mirroring is compulsory for every company. The toggle no longer exists.",
  },

  // ────────────────────────────── Keyboard / focus ─────────────────────────
  {
    id: "cold-start-focus",
    category: "Keyboard",
    symptoms: [
      "must press Tab to activate keyboard on cold start",
      "arrow keys do nothing at startup",
    ],
    cause: "Focus did not land on the menubar after login.",
    fix: "src/routes/app.tsx auto-focuses Mehtaji on workspace entry. If broken, check the focus effect and that no other component grabs focus first.",
  },
  {
    id: "menubar-dropdown-not-opening",
    category: "Keyboard",
    symptoms: [
      "arrow moves across menus but dropdown does not open",
      "must click with mouse to open menu",
    ],
    cause: "Custom onKeyDown listeners fought Radix Menubar.",
    fix: "TopMenuBar.tsx delegates arrows/Enter/Escape to Radix Menubar and force-opens on mouse hover. Do not re-add custom key handlers.",
  },
  {
    id: "shortcut-fires-once",
    category: "Keyboard",
    symptoms: [
      "Alt+Y works once then Alt+R does nothing",
      "quick ribbon shortcut dies after first use",
    ],
    cause: "Shortcut listener was field-blocked after focus entered an input.",
    fix: "Ribbon shortcuts set allowInField: true. Verify that flag on every useShortcut in QuickActionsRibbon.tsx.",
  },
  {
    id: "escape-does-nothing",
    category: "Keyboard",
    symptoms: ["Escape does not close menu", "cannot exit dialog with Escape"],
    cause: "Staged Escape handler missing.",
    fix: "src/routes/app.tsx runs a global Escape state machine: field → dialog → menu → exit confirm. Do not add competing document-level keydown listeners.",
  },
  {
    id: "tabs-arrow-nav",
    category: "Keyboard",
    symptoms: ["arrow up/down does not move between tabs"],
    cause: "Radix Tabs supports left/right by default.",
    fix: "src/components/ui/tabs.tsx now also handles ArrowUp/ArrowDown for vertical/wrapped tab groups.",
  },
  {
    id: "cheat-sheet",
    category: "Keyboard",
    symptoms: ["what shortcuts exist", "keyboard reference"],
    cause: "n/a.",
    fix: "Press Ctrl+/ or ? to open KeyboardCheatSheet.tsx. Every registered useShortcut is listed.",
  },

  // ────────────────────────────── Auth ─────────────────────────────────────
  {
    id: "unsupported-provider",
    category: "Auth",
    symptoms: ["Unsupported provider on Google sign-in"],
    cause: "Google provider not configured in the same turn Google auth was added.",
    fix: "Configure the Google provider on the backend; anon sign-ups stay off. Set redirect_uri to ${window.location.origin}, not a protected route.",
  },
  {
    id: "signed-out-loop",
    category: "Auth",
    symptoms: ["kicked back to login after refresh"],
    cause: "Session storage cleared or token expired without refresh.",
    fix: "auth-context refreshes tokens on mount. If it still loops, clear cookies for the app origin and sign in again.",
  },

  // ────────────────────────────── Reports ──────────────────────────────────
  {
    id: "pl-classification",
    category: "Reports",
    symptoms: [
      "sales appears in P&L not Trading",
      "same income head shown in both Trading and P&L",
    ],
    cause: "Direct vs Indirect classification was mixed.",
    fix: "Trading account holds SALES/PURCHASE and direct heads only. P&L holds indirect heads only. Reclassify the ledger group.",
  },
  {
    id: "drill-back-lost",
    category: "Reports",
    symptoms: [
      "after editing an entry drilled from ledger, back button loses report page",
    ],
    cause: "Report state was in component memory only.",
    fix: "src/lib/report-url-state.ts serialises report params to the URL. Ensure the report page reads those params on mount.",
  },

  // ────────────────────────────── Import ───────────────────────────────────
  {
    id: "import-non-uuid",
    category: "Import",
    symptoms: ["import fails with Invalid id"],
    cause: "Imported ids are not UUIDs.",
    fix: "Handled by src/lib/schemas/common.ts. If it recurs, apply the relaxed id validator or wrap ids in a UUID projection.",
  },
  {
    id: "product-name-mention",
    category: "Import",
    symptoms: ["prompt mentions Tally / Busy"],
    cause: "Legal/licensing risk.",
    fix: "Never name competitor products. Use generic language: 'Indian accounting convention', 'standard voucher flow', 'stock journal pattern'.",
  },

  // ────────────────────────────── AI ───────────────────────────────────────
  {
    id: "ai-rate-limited",
    category: "AI",
    symptoms: ["AI is rate-limited. Please retry shortly.", "HTTP 429 from ai gateway"],
    cause: "Too many gateway requests in a short window.",
    fix: "Wait a few seconds and retry. If persistent, reduce polling / retries in the calling code.",
  },
  {
    id: "ai-credits-exhausted",
    category: "AI",
    symptoms: [
      "AI credits exhausted. Add credits in Settings → Plans & credits.",
      "HTTP 402 from ai gateway",
    ],
    cause: "Workspace credit balance is zero.",
    fix: "Buy credits from the workspace billing page.",
  },
  {
    id: "ai-offline",
    category: "AI",
    symptoms: [
      "Offline diagnostic mode is active",
      "cloud AI edge function is not reachable",
    ],
    cause: "Device is offline or the edge function is unreachable.",
    fix: "Check the network. Local WebGPU falls back automatically when available. Business data is unaffected — it lives in local IndexedDB.",
  },

  // ────────────────────────────── Native / desktop ─────────────────────────
  {
    id: "tauri-detection",
    category: "Native",
    symptoms: ["file save prompts a download instead of writing to Documents"],
    cause: "isTauri detection failed and the app treated the runtime as browser.",
    fix: "isTauri reads only TAURI_ENV_PLATFORM. Confirm the Tauri build injects it.",
  },
  {
    id: "self-test-messages",
    category: "Native",
    symptoms: [
      "Self-test says 'Settings row missing' / 'No ledgers yet' / 'No Cash/Bank ledger'",
    ],
    cause: "Self-test was reading cloud instead of local IndexedDB.",
    fix: "SelfTestPanel.tsx queries local IndexedDB. Re-run after opening Settings once so the row is created.",
  },
];

/** Render the KB as a compact bullet list for injection into the system prompt. */
export function renderErrorKb(kb: ErrorEntry[] = ERROR_KB): string {
  const byCat = new Map<string, ErrorEntry[]>();
  for (const e of kb) {
    const arr = byCat.get(e.category) ?? [];
    arr.push(e);
    byCat.set(e.category, arr);
  }
  const parts: string[] = [];
  for (const [cat, entries] of byCat) {
    parts.push(`## ${cat}`);
    for (const e of entries) {
      const sym = e.symptoms.map((s) => `"${s}"`).join(" | ");
      parts.push(`- [${e.id}] Symptoms: ${sym}\n  Cause: ${e.cause}\n  Fix: ${e.fix}`);
    }
  }
  return parts.join("\n");
}
