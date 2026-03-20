# Implementation Plan: Firebase Auth Client

## Overview

Wire up Firebase Authentication end-to-end: server-side route protection via `next-firebase-auth-edge` middleware, a React `AuthProvider` for client-side user state, Google + email/password sign-in UI, and automatic Bearer token injection into tRPC calls.

## Tasks

- [x] 1. Add cookie signature keys to environment configuration
  - Add `COOKIE_SIGNATURE_KEY_CURRENT` and `COOKIE_SIGNATURE_KEY_PREVIOUS` to the `server` schema in `src/env.js` with `z.string().min(32)` validation
  - Add both keys to the `runtimeEnv` map
  - Add placeholder values to `.env` and `.env.example`
  - _Requirements: 9.1, 9.2, 9.3_

- [x] 2. Add `setAuthToken` / `getAuthToken` to `src/utils/api.ts`
  - [x] 2.1 Implement token store and Bearer header injection
    - Declare a module-level `let _token: string | null = null`
    - Export `setAuthToken(token: string | null): void` that sets `_token`
    - Add a private `getAuthToken(): string | null` that returns `_token`
    - Add a `headers()` callback to `httpBatchLink` that returns `{ Authorization: 'Bearer <token>' }` when token is non-null, or `{}` otherwise
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 2.2 Write property test for `setAuthToken` / `getAuthToken` round-trip
    - **Property 4: setAuthToken / getAuthToken round-trip**
    - **Validates: Requirements 7.3, 7.4**

  - [x] 2.3 Write property test for tRPC Authorization header
    - **Property 5: tRPC Authorization header is present for any non-null token**
    - **Validates: Requirements 7.1**

- [ ] 3. Create `src/middleware.ts`
  - [x] 3.1 Implement `authMiddleware` configuration
    - Import `authMiddleware` from `next-firebase-auth-edge` and `NextResponse` from `next/server`
    - Configure with `loginPath: '/api/login'`, `logoutPath: '/api/logout'`, cookie name `'session'`, 12-hour `maxAge`, `httpOnly: true`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`
    - Read `COOKIE_SIGNATURE_KEY_CURRENT` / `COOKIE_SIGNATURE_KEY_PREVIOUS` from `process.env` (not via `env.js` — middleware runs in Edge runtime)
    - `handleValidToken`: redirect to `/` if `pathname === '/sign-in'`, otherwise `NextResponse.next({ request: { headers } })`
    - `handleInvalidToken` and `handleError`: redirect to `/sign-in` if `pathname !== '/sign-in'`, otherwise `NextResponse.next()`
    - Export `config.matcher` to match all routes except `_next`, `favicon.ico`, and files with extensions
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 10.1, 10.2_

  - [x] 3.2 Write property test for middleware redirect logic — unauthenticated requests
    - **Property 1: Unauthenticated requests to any protected path redirect to sign-in**
    - **Validates: Requirements 1.1, 10.1, 10.2**

  - [~] 3.3 Write property test for middleware redirect logic — authenticated requests
    - **Property 2: Authenticated requests to any protected path proceed without redirect**
    - **Validates: Requirements 1.4**

- [ ] 4. Create `src/contexts/auth.tsx`
  - [~] 4.1 Implement `AuthProvider` and `useAuth` hook
    - Define `AuthContextValue` interface with `user`, `token`, `loading`, `signInWithGoogle`, `signInWithEmail`, `signOut`
    - Create `AuthContext` with `React.createContext`; `useAuth` throws if context is null
    - Subscribe to `onIdTokenChanged` on mount; unsubscribe on unmount
    - On non-null user: call `user.getIdToken()`, update `token` state, call `setAuthToken(jwt)`; set `loading: false`
    - On null user: set `token` to `null`, call `setAuthToken(null)`; set `loading: false`
    - Implement `signInWithGoogle`: `signInWithPopup(auth, new GoogleAuthProvider())` → `getIdToken()` → `POST /api/login`
    - Implement `signInWithEmail`: `signInWithEmailAndPassword(auth, email, password)` → `getIdToken()` → `POST /api/login`
    - Implement `signOut`: `POST /api/logout` → `firebaseSignOut(auth)`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_

  - [~] 4.2 Write property test for token state update on any authenticated user
    - **Property 3: Token state is updated for any authenticated user**
    - **Validates: Requirements 3.3**

- [~] 5. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [~] 6. Update `src/pages/_app.tsx` to wrap with `AuthProvider`
  - Import `AuthProvider` from `@/contexts/auth`
  - Wrap the existing `<div>` tree inside `<AuthProvider>`
  - _Requirements: 3.1_

- [ ] 7. Replace placeholder in `src/pages/sign-in.tsx` with real sign-in UI
  - [~] 7.1 Implement sign-in form
    - Import `useAuth` from `@/contexts/auth`
    - Add local state: `email`, `password`, `error: string | null`, `loading: boolean`
    - Render a Google sign-in button that calls `signInWithGoogle()` and sets `loading` / `error` appropriately
    - Render email and password `<input>` fields and a submit button that calls `signInWithEmail(email, password)`
    - Disable all controls and show a loading indicator while `loading` is true
    - Display `error` inline when non-null
    - No HOC wrapping — middleware handles redirection
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [~] 7.2 Write property test for inline error display
    - **Property 7: Sign-in page displays any error message inline**
    - **Validates: Requirements 8.4**

- [~] 8. Final checkpoint — Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use `fast-check` as specified in the design
- Middleware reads env vars directly via `process.env` (not `env.js`) because it runs in the Next.js Edge runtime
- The tRPC server-side token verification in `trpc.ts` is already implemented — no changes needed there (Requirements 11.1–11.4 are already satisfied)
