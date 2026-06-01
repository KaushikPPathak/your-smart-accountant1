# Convert to Pure Client-Side SPA

## Why
Two recurring failures share one root cause — the app currently boots through TanStack Start's SSR pipeline (Cloudflare worker on web, prerender script for Tauri):

- **Web:** every request returns `{"status":500,"unhandled":true,"message":"HTTPError"}` because the SSR worker chokes (likely on a module-scope browser API or missing runtime binding) and h3 swallows the trace.
- **Tauri:** the prerender shells render auth-gated HTML against a missing server, and Tauri's `tauri://localhost/<route>` requests have no SPA fallback, producing `asset not found: index.html`.

A client-only SPA removes both surfaces: no worker, no prerender, no hydration mismatch — just a static `index.html` that boots React.

## Changes

### 1. Add a real client entry (`src/client.tsx`)
Create the file. It mounts the router with `createRoot` (no hydration) into `#root`:

```tsx
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";

const router = getRouter();
const el = document.getElementById("root")!;
createRoot(el).render(<RouterProvider router={router} />);
```

### 2. Router uses hash history everywhere (`src/router.tsx`)
Replace the current "browser on web / hash on Tauri" split with `createHashHistory()` unconditionally. Hash routing works identically on `https://`, `file://`, and `tauri://`, eliminating the need for any SPA-fallback rewrite. Remove the Tauri-detection block.

### 3. Strip the SSR shell (`src/routes/__root.tsx`)
- Remove `shellComponent: RootShell`, `HeadContent`, `Scripts`, and the `<html><body>` shell — those are SSR-only.
- Keep `component: RootComponent` (the provider tree) and `notFoundComponent`.
- Move `<title>` / favicon / meta to a static `index.html` (see step 4). Drop the `meta`/`links` from `head()` or keep them as no-ops; without `<HeadContent />` in a shell they don't render.

### 4. Static `index.html` at project root + Vite config flip
- Create `index.html` at the repo root with `<div id="root"></div>` and `<script type="module" src="/src/client.tsx">`, plus the static `<title>`, viewport meta, and stylesheet `<link>`.
- In `vite.config.ts`, stop using `@lovable.dev/vite-tanstack-config`. Switch to plain `defineConfig` from `vite` with `@vitejs/plugin-react`, `@tailwindcss/vite`, `vite-tsconfig-paths`, and `lovable-tagger` (dev only). Drop the Cloudflare and TanStack Start plugins. Keep the existing `manualChunks` config.
- Remove `src/start.ts` (server-fn middleware registration) — no server runtime remains.

### 5. Server functions become direct Supabase calls
Any `createServerFn` we still depend on (e.g. `ensureTechSession`, `gstin-lookup.functions.ts`, `assistant.functions.ts`, `tech-user.functions.ts`, `setu.functions.ts`) currently runs server-side. Audit each:
- If it only proxies Supabase with the user's session → inline the supabase client call on the client.
- If it needs a server secret (e.g. LOVABLE_API_KEY, Setu credentials, tech-user password) → keep as a thin **server route** under `src/routes/api/public/*` with its own auth check, OR move the secret to the client as a Supabase RPC / edge function. Flag each one in implementation.

This is the biggest unknown — I'll enumerate every `*.functions.ts` caller during implementation and decide per-file.

### 6. Build pipeline
- `package.json` scripts: `build` → `vite build` (single client bundle into `dist/`). 
- Tauri: `build:tauri` becomes just `vite build` + copy `dist/` → `dist/client/`. Delete `scripts/tauri-prerender.mjs` and `scripts/verify-tauri-dist.mjs` (or simplify the verify script to just check `dist/client/index.html` exists).
- `src-tauri/tauri.conf.json` `frontendDist` stays `../dist/client`.

### 7. Lock-screen + navigation cleanup
- Replace every `window.location.assign("/app")` in `src/routes/lock.tsx` with `router.navigate({ to: "/app" })`.
- Remove the `navigator.onLine` hard gate in `src/lib/auth-context.tsx` (re-introduced regression).
- Remove the "emergency offline boot" admin bypass in `lock.tsx`.

## Files touched
- **new:** `src/client.tsx`, `index.html` (root)
- **rewrite:** `vite.config.ts`, `src/router.tsx`, `src/routes/__root.tsx`
- **edit:** `package.json` (scripts + deps), `src/lib/auth-context.tsx`, `src/routes/lock.tsx`, `src/routes/index.tsx` (cache shape fix)
- **delete:** `src/start.ts`, `scripts/tauri-prerender.mjs`, `scripts/verify-tauri-dist.mjs`
- **audit:** all `src/**/*.functions.ts` and their callers
- **keep:** `src-tauri/tauri.conf.json` (unchanged)

## Trade-offs you should know
- **No SSR** = no server-rendered HTML for SEO. Acceptable for this app (it's a logged-in accounting tool, not a marketing site).
- **Hash URLs** (e.g. `/#/app/vouchers`) on the web. Bookmarks still work; if you'd rather keep clean URLs on web only, I can use `createBrowserHistory()` on web + a Vite SPA-fallback and switch to hash only under Tauri — say the word.
- **Server functions removal** may require re-implementing 1–2 secret-bearing flows (Setu, tech-user) as Supabase edge functions or thin `/api/public/*` routes. I'll list these before deleting anything.

## Open question
Do you want clean URLs on the web (browser history + Vite SPA fallback) and hash only inside Tauri, or hash everywhere for maximum simplicity? Hash-everywhere is the most bulletproof against the current crash class — recommended unless you care about pretty URLs.
