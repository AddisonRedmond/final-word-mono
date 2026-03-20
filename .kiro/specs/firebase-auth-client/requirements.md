# Requirements Document

## Introduction

This feature adds a complete Firebase Authentication integration to the Next.js client app. It introduces server-side route protection via `next-firebase-auth-edge` middleware, a React `AuthProvider` for client-side user state, Google Sign-In and email/password sign-in on the sign-in page, and automatic Bearer token injection into tRPC calls. The existing Firebase client SDK and tRPC server-side token verification are already in place — this feature connects the two ends.

## Glossary

- **AuthProvider**: The React context provider (`src/contexts/auth.tsx`) that wraps the app, listens to Firebase auth state changes, and exposes user/token state and sign-in/sign-out helpers.
- **AuthMiddleware**: The `authMiddleware` from `next-firebase-auth-edge` configured in `src/middleware.ts` that validates the signed session cookie on every request and handles `/api/login` and `/api/logout`.
- **Session_Cookie**: The signed HttpOnly cookie set by `AuthMiddleware` after a successful sign-in, used to authenticate server-side requests.
- **ID_Token**: The Firebase JWT returned by `user.getIdToken()`, used both to set the `Session_Cookie` and as the Bearer token for tRPC calls.
- **tRPC_Client**: The tRPC client configured in `src/utils/api.ts` that injects the Bearer token into every request via `httpBatchLink`.
- **Sign_In_Page**: The Next.js page at `/sign-in` (`src/pages/sign-in.tsx`) that renders the Google and email/password sign-in UI.
- **Protected_Page**: Any page route other than `/sign-in` that requires an authenticated session to access.
- **TokenStore**: The module-level token variable in `api.ts` managed by `setAuthToken`/`getAuthToken`.

---

## Requirements

### Requirement 1: Server-Side Route Protection

**User Story:** As a user, I want unauthenticated requests to protected pages to be redirected to the sign-in page, so that I cannot access content that requires authentication.

#### Acceptance Criteria

1. WHEN an unauthenticated request is made to a Protected_Page, THE AuthMiddleware SHALL redirect the request to `/sign-in` before the page renders.
2. WHEN an unauthenticated request is made to `/sign-in`, THE AuthMiddleware SHALL allow the request to proceed without redirecting.
3. WHEN an authenticated request is made to `/sign-in`, THE AuthMiddleware SHALL redirect the request to `/`.
4. WHEN an authenticated request is made to a Protected_Page, THE AuthMiddleware SHALL allow the request to proceed without redirecting.
5. THE AuthMiddleware SHALL match all page routes except `_next` static assets, `favicon.ico`, and files with extensions.

---

### Requirement 2: Session Cookie Management

**User Story:** As a user, I want my authentication session to be stored securely in a server-managed cookie, so that my session persists across page navigations without exposing tokens to JavaScript.

#### Acceptance Criteria

1. WHEN a valid ID_Token is POSTed to `/api/login`, THE AuthMiddleware SHALL set a signed HttpOnly Session_Cookie on the response.
2. THE Session_Cookie SHALL be configured with `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, and `maxAge` of 12 hours.
3. WHERE `NODE_ENV` is `production`, THE Session_Cookie SHALL be configured with `secure: true`.
4. WHEN a POST request is made to `/api/logout`, THE AuthMiddleware SHALL clear the Session_Cookie.
5. THE AuthMiddleware SHALL sign the Session_Cookie using `COOKIE_SIGNATURE_KEY_CURRENT` and support verification with `COOKIE_SIGNATURE_KEY_PREVIOUS` for key rotation.

---

### Requirement 3: AuthProvider — Auth State Subscription

**User Story:** As a developer, I want a React context that tracks the current Firebase user and ID token, so that components can access auth state without prop drilling.

#### Acceptance Criteria

1. WHEN the AuthProvider mounts, THE AuthProvider SHALL subscribe to `onIdTokenChanged` on the Firebase `auth` instance.
2. WHEN the AuthProvider unmounts, THE AuthProvider SHALL unsubscribe from `onIdTokenChanged`.
3. WHEN `onIdTokenChanged` fires with a non-null user, THE AuthProvider SHALL call `user.getIdToken()` and store the resulting JWT in both `token` state and the `TokenStore`.
4. WHEN `onIdTokenChanged` fires with `null`, THE AuthProvider SHALL set `token` to `null` and call `setAuthToken(null)` on the `TokenStore`.
5. THE AuthProvider SHALL expose `loading: true` until the first `onIdTokenChanged` callback has fired, then set `loading: false`.
6. IF `useAuth` is called outside of an AuthProvider, THEN THE AuthProvider SHALL throw an error.

---

### Requirement 4: Google Sign-In

**User Story:** As a user, I want to sign in with my Google account, so that I can authenticate without creating a separate password.

#### Acceptance Criteria

1. WHEN a user triggers Google sign-in, THE AuthProvider SHALL call `signInWithPopup` with a `GoogleAuthProvider` instance.
2. WHEN `signInWithPopup` succeeds, THE AuthProvider SHALL call `user.getIdToken()` and POST the resulting ID_Token to `/api/login`.
3. IF `signInWithPopup` throws a `FirebaseError`, THEN THE AuthProvider SHALL propagate the error to the caller.
4. IF the POST to `/api/login` fails, THEN THE AuthProvider SHALL propagate the error to the caller.

---

### Requirement 5: Email/Password Sign-In

**User Story:** As a user, I want to sign in with my email and password, so that I can authenticate using credentials I manage.

#### Acceptance Criteria

1. WHEN a user provides a non-empty email and non-empty password and triggers sign-in, THE AuthProvider SHALL call `signInWithEmailAndPassword` with the provided credentials.
2. WHEN `signInWithEmailAndPassword` succeeds, THE AuthProvider SHALL call `user.getIdToken()` and POST the resulting ID_Token to `/api/login`.
3. IF `signInWithEmailAndPassword` throws a `FirebaseError`, THEN THE AuthProvider SHALL propagate the error to the caller.
4. IF the POST to `/api/login` fails, THEN THE AuthProvider SHALL propagate the error to the caller.

---

### Requirement 6: Sign-Out

**User Story:** As a user, I want to sign out, so that my session is terminated and my account is protected on shared devices.

#### Acceptance Criteria

1. WHEN a user triggers sign-out, THE AuthProvider SHALL POST to `/api/logout` to clear the Session_Cookie.
2. WHEN the `/api/logout` POST completes, THE AuthProvider SHALL call Firebase client `signOut(auth)`.
3. WHEN Firebase client `signOut` completes, THE AuthProvider SHALL receive an `onIdTokenChanged` callback with `null`, clearing `token` state and the `TokenStore`.
4. IF the POST to `/api/logout` fails, THEN THE AuthProvider SHALL propagate the error to the caller.

---

### Requirement 7: tRPC Bearer Token Injection

**User Story:** As a developer, I want every tRPC request to include the current Firebase ID token as a Bearer header, so that protected tRPC procedures can verify the caller's identity.

#### Acceptance Criteria

1. THE tRPC_Client SHALL include an `Authorization: Bearer <token>` header on every request when the `TokenStore` contains a non-null token.
2. THE tRPC_Client SHALL omit the `Authorization` header when the `TokenStore` contains `null`.
3. WHEN `setAuthToken` is called with a value, THE TokenStore SHALL store that value such that a subsequent `getAuthToken` call returns the same value.
4. WHEN `setAuthToken` is called with `null`, THE TokenStore SHALL store `null` such that a subsequent `getAuthToken` call returns `null`.

---

### Requirement 8: Sign-In Page UI

**User Story:** As a user, I want a sign-in page with Google and email/password options, so that I can choose my preferred authentication method.

#### Acceptance Criteria

1. THE Sign_In_Page SHALL render a button that triggers Google sign-in via `signInWithGoogle()` from `useAuth()`.
2. THE Sign_In_Page SHALL render an email input field and a password input field for email/password sign-in.
3. THE Sign_In_Page SHALL render a submit button that triggers `signInWithEmail(email, password)` from `useAuth()`.
4. WHEN a sign-in attempt fails, THE Sign_In_Page SHALL display an inline error message describing the failure.
5. WHEN a sign-in attempt is in progress, THE Sign_In_Page SHALL display a loading indicator and disable the sign-in controls.
6. THE Sign_In_Page SHALL NOT require any HOC wrapping for route protection, as THE AuthMiddleware handles redirection before the page renders.

---

### Requirement 9: Environment Configuration

**User Story:** As a developer, I want all required environment variables validated at startup, so that misconfiguration is caught early rather than at runtime.

#### Acceptance Criteria

1. THE System SHALL validate `COOKIE_SIGNATURE_KEY_CURRENT` as a server-side environment variable with a minimum length of 32 characters.
2. THE System SHALL validate `COOKIE_SIGNATURE_KEY_PREVIOUS` as a server-side environment variable with a minimum length of 32 characters.
3. IF a required environment variable is missing or invalid at startup, THEN THE System SHALL throw an error and prevent the application from starting.

---

### Requirement 10: Error Handling — Invalid or Expired Session Cookie

**User Story:** As a user, I want an expired or invalid session to redirect me to sign-in rather than showing a broken page, so that I can re-authenticate seamlessly.

#### Acceptance Criteria

1. WHEN the Session_Cookie is absent or its signature verification fails, THE AuthMiddleware SHALL treat the request as unauthenticated.
2. WHEN an error occurs during cookie validation, THE AuthMiddleware SHALL apply the same redirect logic as an invalid token (redirect to `/sign-in` for protected paths, allow `/sign-in` to proceed).

---

### Requirement 11: tRPC Server-Side Token Verification

**User Story:** As a developer, I want the tRPC server to independently verify the Bearer token on every request, so that the server never trusts client-provided identity claims without verification.

#### Acceptance Criteria

1. WHEN a tRPC request includes an `Authorization: Bearer <token>` header, THE System SHALL call `adminAuth.verifyIdToken(token)` to verify the token.
2. WHEN `verifyIdToken` succeeds, THE System SHALL make the decoded token available as `ctx.user` in the tRPC context.
3. IF `verifyIdToken` throws, THEN THE System SHALL set `ctx.user` to `null`.
4. WHEN a `protectedProcedure` is called with `ctx.user` equal to `null`, THE System SHALL throw a `TRPCError` with code `UNAUTHORIZED`.
