# Implementation Plan: Remaining Assessment Findings (Aug 2026)

This plan addresses the high-priority security and architectural items identified in the recent application assessment (file-197) that have not yet been implemented.

## Remaining Items to Implement

### 1. Security Hardening
- **Tighten RPC Grants**: Implement SQL migrations to restrict `public` schema grants. Currently, `supabase.rpc` calls are used for sensitive operations (password verification, recomputing balances). Access should be limited to the `authenticated` role with specific checks.
- **Content Security Policy (CSP)**: Add a strict CSP meta tag to `index.html` to prevent XSS and data exfiltration, specifically limiting connections to known endpoints (Supabase, Google Drive APIs).

### 2. Architecture & Performance
- **Dynamic Import Audit**: Audit `src/routes/app.tsx` and main entry points to replace large static imports with `React.lazy()` or dynamic `import()`, specifically for heavy modules like `jspdf`, `xlsx`, and complex report components.
- **Domain Service Extraction**: Extract core voucher business logic (calculation, validation, linking) from the UI layer (`src/routes/app.vouchers.tsx`) into a dedicated `src/lib/services/VoucherService.ts`.

### 3. Engineering Quality
- **CI Quality Gates**: Configure the build process to run `tsgo` (TypeScript check) and `vitest` (unit tests) before allowing a production build/package.
- **Environment-Independent Tests**: Create a mocking strategy for Supabase and LocalStorage to allow tests to run without network or browser state.

## Technical Implementation Details

### Security: Content Security Policy
Add the following meta tag to `index.html`:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://yzymutqvqwjeqnbygpgp.supabase.co wss://yzymutqvqwjeqnbygpgp.supabase.co https://*.googleapis.com;">
```

### Security: RPC Grant Hardening
Create a migration to revoke public access and grant to `authenticated`:
```sql
REVOKE EXECUTE ON FUNCTION public.verify_company_password FROM public;
GRANT EXECUTE ON FUNCTION public.verify_company_password TO authenticated;
-- Repeat for all sensitive RPC functions
```

### Architecture: Voucher Service
Create `src/lib/services/VoucherService.ts` to centralize:
- `validateVoucher(data)`
- `calculateTax(items)`
- `handleDocumentLinking(source, target)`

## Acceptance Criteria
- [ ] CSP is active and blocking unauthorized domains.
- [ ] RPC functions are no longer accessible to anonymous users.
- [ ] Initial bundle size is reduced by at least 15% through dynamic imports.
- [ ] Build process fails if type-check fails.
