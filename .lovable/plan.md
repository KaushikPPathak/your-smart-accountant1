## Plan

1. **Fix the database login/signup functions**
   - Update the account RPC functions so every password hash call explicitly uses `extensions.crypt()` and `extensions.gen_salt()`.
   - Keep the current simplified username/password flow intact.
   - Preserve the first-account behavior that links the existing unowned companies to the first created account.

2. **Add a small compatibility migration**
   - Recreate the affected functions with the correct `search_path` and fully-qualified crypto functions.
   - Do not remove existing core accounting tables, APIs, company data, or background network logic.

3. **Confirm lock-gate redirect behavior**
   - If the app route loads while no local account session is unlocked, the root guard redirects to `/lock`.
   - After successful signup/login, the app redirects to `/app` using a full page navigation so company data reloads for that account.

4. **Verify the fix**
   - Check that the database functions exist with the corrected definitions.
   - Re-test the signup RPC path so the previous `gen_salt(unknown, integer) does not exist` failure is gone.

## Technical notes

- The failure is not in the form fields. It is in the database function body: `setup_first_account` / `signup_account` still contain unqualified `crypt()` and `gen_salt()` calls.
- The previous migration only corrected some functions; the active database definition still shows the broken versions for first signup and login.
- I will not change the app’s broader accounting data model or delete any existing data.