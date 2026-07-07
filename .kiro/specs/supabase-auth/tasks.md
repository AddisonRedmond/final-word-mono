# Implementation Plan: Supabase Authentication

## Overview

Wire Supabase authentication into `apps/client` (Next.js Pages Router). The Supabase SDK and utility clients are already scaffolded — this plan connects them end-to-end: GitHub OAuth sign-in, session cookie management, route protection via middleware, session propagation to tRPC, and sign-out from the Navbar.

All code is TypeScript. Tests use Vitest + fast-check.

---

## Tasks

- [x] 1. Install dependencies and configure Vitest
  - [x] 1.1 Install test dev dependencies in `apps/client`
    - Run: `pnpm add -D vitest @vitest/coverage-v8 fast-check @testing-library/react @testing-library/user-event jsdom`
    - Add `"test": "vitest --run"` and `"test:watch": "vitest"` to `apps/client/package.json` scripts
    - _Requirements: none (infrastructure)_

  - [x] 1.2 Create `apps/client/vitest.config.ts`
    - Configure `environment: 'jsdom'`, `globals: true`
    - Add `resolve.alias` so `@` maps to `./src` (mirrors `tsconfig.json` path alias)
    - _Requirements: none (infrastructure)_

- [x] 2. Add `createSupabaseApiRouteClient` to `utils/supabase/server.ts`
  - [x] 2.1 Export `createSupabaseApiRouteClient(req, res)` from `apps/client/src/utils/supabase/server.ts`
    - Accept `NextApiRequest` and `NextApiResponse`
    - Use `createServerClient` with cookie handlers that read from `req.cookies` and write `Set-Cookie` headers via `res.setHeader`
    - Keep the existing `createSupabaseServerClient` export unchanged
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Create proxy Supabase client factory
  - [x] 3.1 Create `apps/client/src/utils/supabase/proxy.ts`
    - Export `createProxyClient(request: NextRequest, response: NextResponse)`
    - Use `createServerClient` from `@supabase/ssr` with `getAll` reading from `request.cookies` and `setAll` writing to both `request.cookies` and `response.cookies`
    - Note: Next.js 16 renamed `middleware.ts` to `proxy.ts` — this factory follows that convention
    - _Requirements: 4.1, 4.2, 7.2_

- [x] 4. Implement Next.js Proxy (`proxy.ts`)
  - [x] 4.1 Create `apps/client/src/proxy.ts` with `isProtectedRoute` and `isAuthRoute` helper functions
    - `isProtectedRoute(path)` returns `true` iff `path === '/'` or `path.startsWith('/game')`
    - `isAuthRoute(path)` returns `true` iff `path === '/sign-in'`
    - Export `config.matcher` to exclude `_next/static`, `_next/image`, and `favicon.ico`
    - Note: Next.js 16 uses `proxy.ts` instead of `middleware.ts`; export the handler as `export function proxy()` (not `middleware`)
    - _Requirements: 4.1, 4.4_

  - [x] 4.2 Implement the `proxy` function in `apps/client/src/proxy.ts`
    - Call `createProxyClient(request, response)` to get the Supabase client
    - Wrap `supabase.auth.getUser()` in a try-catch; treat any exception as an invalid session
    - If no user and `isProtectedRoute`: redirect to `/sign-in`
    - If valid user and `isAuthRoute`: redirect to `/`
    - Otherwise pass through — always return the `response` object so updated cookies reach the browser
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 4.3 Write property test for `isProtectedRoute` (Property 4)
    - **Property 4: Proxy route classification is consistent with the protected-route predicate**
    - **Validates: Requirements 4.1, 4.4**
    - File: `apps/client/src/__tests__/proxy.property.test.ts`
    - Generate arbitrary path strings via `fc.string()`; assert `isProtectedRoute` returns `true` iff path is `'/'` or starts with `'/game'`, and `false` for paths starting with `/api` and all others
    - Pure function — no mocking required

  - [ ]* 4.4 Write property test for proxy auth behavior (Property 5)
    - **Property 5: Unauthenticated requests to protected routes are redirected; authenticated requests are served**
    - **Validates: Requirements 4.2, 7.1**
    - File: `apps/client/src/__tests__/proxy.property.test.ts`
    - Mock `createProxyClient` to return a fake Supabase client; generate `{ authenticated: boolean }` × protected paths; assert redirect for unauthenticated, pass-through for authenticated

  - [ ]* 4.5 Write property test for token refresh behavior (Property 6)
    - **Property 6: Session token refresh fires for tokens expiring within 60 seconds**
    - **Validates: Requirements 2.4, 7.2**
    - File: `apps/client/src/__tests__/proxy.property.test.ts`
    - Generate `fc.integer({ min: 0, max: 120 })` as seconds-to-expiry; assert that `refreshSession` is triggered when value < 60 and NOT triggered when value >= 60

- [x] 5. Checkpoint — middleware complete
  - Ensure all tests written so far pass, ask the user if questions arise.

- [x] 6. Implement OAuth callback API route
  - [x] 6.1 Create `apps/client/src/pages/api/auth/callback.ts`
    - Import `createSupabaseApiRouteClient` from `@/utils/supabase/server`
    - Extract `code` from `req.query`
    - If `code` is present: call `exchangeCodeForSession(code)`; on success redirect to `/`
    - For any other case (missing code, exchange error, thrown exception): redirect to `/sign-in?error=auth-code-error`
    - _Requirements: 2.1, 2.2, 3.1, 3.2_

  - [ ]* 6.2 Write property test for callback failure redirect (Property 3)
    - **Property 3: OAuth callback failure always redirects to /sign-in?error=auth-code-error**
    - **Validates: Requirements 3.1, 3.2**
    - File: `apps/client/src/__tests__/callback.property.test.ts`
    - Generate via `fc.oneof(fc.constant(undefined), fc.record({ message: fc.string(), status: fc.integer({ min: 400, max: 599 }) }))` representing missing code / exchange error / thrown exception; mock `createSupabaseApiRouteClient`; assert `res.redirect` always called with `/sign-in?error=auth-code-error`

  - [ ]* 6.3 Write unit tests for callback route
    - Verify `res.redirect('/')` when `exchangeCodeForSession` returns no error (Requirement 2.2)
    - Verify `res.redirect('/sign-in?error=auth-code-error')` when `code` is absent (Requirement 3.1)
    - Verify `res.redirect('/sign-in?error=auth-code-error')` when exchange returns an error (Requirement 3.2)
    - File: `apps/client/src/__tests__/callback.unit.test.ts`

- [x] 7. Update tRPC context to use `getUser()`
  - [x] 7.1 Rewrite `createTRPCContext` in `apps/client/src/server/api/trpc.ts`
    - Replace the broken `getClaims` call with `await supabase.auth.getUser()`
    - Wrap in try-catch; set `user = null` on any exception — never propagate
    - Return `{ user }` (remove `supabase` from context — procedures should not call Supabase directly)
    - Ensure `protectedProcedure` still compiles — it already checks `ctx.user` and throws `UNAUTHORIZED`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 7.2 Write property test for `createTRPCContext` (Property 7)
    - **Property 7: createTRPCContext always resolves with user matching getUser() output — and never throws**
    - **Validates: Requirements 5.1, 5.2, 5.5**
    - File: `apps/client/src/__tests__/trpc.property.test.ts`
    - Generate `fc.oneof(fc.record({ id: fc.uuid(), email: fc.emailAddress() }), fc.constant(null))` as mock `getUser()` return including exception cases; assert `ctx.user` matches and function never throws

  - [ ]* 7.3 Write property test for `protectedProcedure` (Property 8)
    - **Property 8: protectedProcedure throws UNAUTHORIZED for any null-user context, and passes through for any non-null user**
    - **Validates: Requirements 5.3, 5.4**
    - File: `apps/client/src/__tests__/trpc.property.test.ts`
    - Generate `fc.oneof(fc.record({ id: fc.uuid(), email: fc.emailAddress() }), fc.constant(null))` as `ctx.user`; assert `TRPCError` with code `'UNAUTHORIZED'` for null, and correct user threaded through for non-null

- [x] 8. Implement Sign-In Page
  - [x] 8.1 Replace stub in `apps/client/src/pages/sign-in.tsx`
    - Add `isLoading: boolean` state (initially `false`)
    - Add `errorMessage: string | null` state (initially `null`)
    - On mount (via `useEffect` or `router.isReady`): if `router.query.error === 'auth-code-error'`, set `errorMessage = "Sign-in failed. Please try again."`
    - Render a "Sign in with GitHub" button; disable and show loading indicator while `isLoading` is `true`
    - Click handler: `setIsLoading(true)`, then call `createClient().auth.signInWithOAuth({ provider: 'github', options: { redirectTo: \`\${window.location.origin}/api/auth/callback\` } })`; leave `isLoading` true (browser redirects away)
    - Conditionally render error message when `errorMessage` is non-null
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.3_

  - [ ]* 8.2 Write property test for signInWithOAuth call (Property 1)
    - **Property 1: signInWithOAuth is always called with the correct provider and redirectTo**
    - **Validates: Requirements 1.2**
    - File: `apps/client/src/__tests__/sign-in.property.test.ts`
    - Generate arbitrary origin URL strings via `fc.webUrl()` (or filtered `fc.string()`); mock `window.location.origin`; simulate button click; assert `signInWithOAuth` called with `provider: 'github'` and `redirectTo` equal to `${origin}/api/auth/callback`

  - [ ]* 8.3 Write property test for error message display (Property 2)
    - **Property 2: Error message is shown if and only if error=auth-code-error is in the URL**
    - **Validates: Requirements 1.4, 1.5, 3.3**
    - File: `apps/client/src/__tests__/sign-in.property.test.ts`
    - Generate `fc.oneof(fc.constant('auth-code-error'), fc.string())` as `router.query.error`; assert error message shown iff value is `'auth-code-error'`

  - [ ]* 8.4 Write unit tests for Sign-In Page
    - Verify "Sign in with GitHub" button renders (Requirement 1.1)
    - Verify button is disabled and loading indicator appears while `isLoading=true` (Requirement 1.3)
    - File: `apps/client/src/__tests__/sign-in.unit.test.ts`

- [x] 9. Checkpoint — sign-in page and tRPC context complete
  - Ensure all tests written so far pass, ask the user if questions arise.

- [x] 10. Implement Navbar sign-out
  - [x] 10.1 Update `apps/client/src/components/navigation/navbar.tsx`
    - Add `isSigningOut: boolean` state (initially `false`)
    - Replace `hijackSignOut` with `handleSignOut`: set `isSigningOut(true)`, call `createClient().auth.signOut()` in try block, always call `router.push('/sign-in')` in finally block
    - Bind `disabled={isSigningOut}` on the Sign Out button
    - Import `createClient` from `@/utils/supabase/client`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 10.2 Write property test for sign-out redirect (Property 9)
    - **Property 9: Sign-out always redirects to /sign-in regardless of outcome**
    - **Validates: Requirements 6.4**
    - File: `apps/client/src/__tests__/navbar.property.test.ts`
    - Generate `fc.oneof(fc.constant({ error: null }), fc.record({ error: fc.record({ message: fc.string() }) }), fc.constant(new Error('network failure')))` as sign-out result; mock `createClient`; assert `router.push('/sign-in')` always called exactly once

  - [ ]* 10.3 Write unit tests for Navbar sign-out
    - Verify "Sign Out" button is visible and enabled initially (Requirement 6.1)
    - Verify button becomes disabled immediately on click (Requirement 6.2)
    - Verify `router.push('/sign-in')` called after successful `signOut()` (Requirement 6.3)
    - File: `apps/client/src/__tests__/navbar.unit.test.ts`

- [x] 11. Final checkpoint — all tests pass
  - Ensure all tests pass end-to-end, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The design uses TypeScript throughout — all implementation and test files are `.ts` / `.tsx`
- `createSupabaseServerClient` in `server.ts` uses `next/headers` (App Router only) — do NOT use it in Pages Router API routes; use `createSupabaseApiRouteClient` instead
- The `protectedProcedure` already exists in `trpc.ts` and is correct — only `createTRPCContext` needs updating
- Next.js 16 renamed `middleware.ts` → `proxy.ts` and `export function middleware` → `export function proxy`; run `npx @next/codemod@canary middleware-to-proxy .` if migrating an existing file
- The proxy function must always return the `response` object from `createProxyClient` so that refreshed session cookies are written to the browser
- Property tests each run a minimum of 100 iterations; tag format: `// Feature: supabase-auth, Property N: <title>`
- `getUser()` is used in all server contexts (never `getSession()`) — it validates the JWT against Supabase Auth, preventing session spoofing

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["4.1", "7.1"] },
    { "id": 3, "tasks": ["4.2", "7.2", "7.3"] },
    { "id": 4, "tasks": ["4.3", "4.4", "4.5", "6.1", "8.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "8.2", "8.3", "8.4", "10.1"] },
    { "id": 6, "tasks": ["10.2", "10.3"] }
  ]
}
```
