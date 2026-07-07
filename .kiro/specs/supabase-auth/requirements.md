# Requirements Document

## Introduction

This feature wires up Supabase authentication in the Final Word monorepo client app (`apps/client`). The Supabase SDK and utility clients are already scaffolded — this feature connects them to deliver a working sign-in flow, session management, protected routes, and sign-out. Authentication uses Supabase's GitHub OAuth provider (PKCE flow). The tRPC context already references Supabase, so session propagation to the API layer is included.

## Glossary

- **Auth_Client**: The browser-side Supabase client created via `createClient()` in `utils/supabase/client.ts`
- **Auth_Server**: The server-side Supabase client created via `createSupabaseServerClient()` in `utils/supabase/server.ts`
- **Session**: A Supabase user session, represented by an access token and refresh token stored in cookies
- **Sign_In_Page**: The Next.js page at `/sign-in` (`pages/sign-in.tsx`)
- **OAuth_Callback_Route**: The Next.js API route at `/api/auth/callback` that exchanges the OAuth authorization code for a session
- **Protected_Route**: A Next.js page that requires an authenticated Session to access
- **tRPC_Context**: The object built by `createTRPCContext` in `server/api/trpc.ts`, passed to every tRPC procedure
- **User**: An authenticated Supabase user object containing at minimum `id` and `email`
- **Middleware**: The Next.js middleware file (`middleware.ts`) responsible for session refresh and route protection

---

## Requirements

### Requirement 1: Sign-In Page

**User Story:** As an unauthenticated user, I want to click "Sign in with GitHub" on the sign-in page, so that I can authenticate via GitHub and access the app.

#### Acceptance Criteria

1. THE Sign_In_Page SHALL render a "Sign in with GitHub" button.
2. WHEN the "Sign in with GitHub" button is clicked, THE Sign_In_Page SHALL call `Auth_Client.auth.signInWithOAuth` with `provider: 'github'` and `options.redirectTo` set to `<origin>/api/auth/callback`.
3. WHILE the OAuth redirect is initiating, THE Sign_In_Page SHALL display a loading indicator and SHALL disable the "Sign in with GitHub" button.
4. WHEN the Sign_In_Page loads with the query parameter `error=auth-code-error` present in the URL, THE Sign_In_Page SHALL display the message "Sign-in failed. Please try again."
5. WHEN the Sign_In_Page loads without the `error` query parameter, THE Sign_In_Page SHALL NOT display any error message.

---

### Requirement 2: Successful Authentication

**User Story:** As a user who completes GitHub authorization, I want to be redirected to the home page, so that I can start using the app.

#### Acceptance Criteria

1. WHEN the OAuth_Callback_Route receives a request containing a `code` query parameter, THE OAuth_Callback_Route SHALL call `Auth_Server.auth.exchangeCodeForSession(code)` to exchange the authorization code for a Session.
2. WHEN `Auth_Server.auth.exchangeCodeForSession` returns a successful response, THE OAuth_Callback_Route SHALL set the session cookies and SHALL redirect the user to `/`.
3. WHEN a Session is established, a session cookie SHALL be set that is readable server-side on subsequent requests.
4. WHEN the Middleware processes a request to a protected route with an existing session cookie, AND the access token will expire within 60 seconds, THE Middleware SHALL obtain a new access token by refreshing the Session before the response is sent to the client.

---

### Requirement 3: Failed Authentication

**User Story:** As a user whose GitHub authorization fails, I want to see a clear error message on the sign-in page, so that I know the sign-in attempt failed and can try again.

#### Acceptance Criteria

1. IF the OAuth_Callback_Route receives a request with no `code` query parameter, THEN THE OAuth_Callback_Route SHALL redirect the user to `/sign-in?error=auth-code-error`.
2. IF `Auth_Server.auth.exchangeCodeForSession` returns an error, THEN THE OAuth_Callback_Route SHALL redirect the user to `/sign-in?error=auth-code-error`.
3. WHEN the Sign_In_Page loads with the query parameter `error=auth-code-error` present in the URL, THE Sign_In_Page SHALL display the message "Sign-in failed. Please try again."

---

### Requirement 4: Route Protection

**User Story:** As an unauthenticated user, I want to be redirected to the sign-in page when I try to access a protected page, so that only authenticated users can access game features.

#### Acceptance Criteria

1. THE Middleware SHALL treat a request as targeting a Protected_Route if and only if the request path exactly matches `/` or begins with `/game`.
2. WHEN an unauthenticated request is made to a Protected_Route, THE Middleware SHALL redirect the request to `/sign-in`.
3. WHEN an authenticated request is made to `/sign-in`, THE Middleware SHALL redirect the request to `/`.
4. WHEN a request path begins with `/api` or does not match any Protected_Route pattern, THE Middleware SHALL allow the request to proceed without authentication checks, including unauthenticated requests to `/sign-in`.

---

### Requirement 5: Session Propagation to tRPC

**User Story:** As a developer, I want tRPC procedures to know who the authenticated user is, so that protected procedures can enforce authorization.

#### Acceptance Criteria

1. WHEN `createTRPCContext` is called, THE tRPC_Context SHALL call `Auth_Server.auth.getUser()` and SHALL include the resolved `User` object if it returns a non-null user, or `null` if it returns no user.
2. IF `createTRPCContext` is called and no valid Session cookie is present, THEN THE tRPC_Context SHALL set `user` to `null`.
3. IF a `protectedProcedure` is invoked and `tRPC_Context.user` is `null`, THEN THE procedure SHALL throw a tRPC `UNAUTHORIZED` error.
4. WHEN a `protectedProcedure` is invoked and `tRPC_Context.user` is non-null, THE procedure handler SHALL have access to the `User` object via `ctx.user`.
5. IF `Auth_Server.auth.getUser()` throws an exception during context creation, THEN `createTRPCContext` SHALL set `user` to `null` and SHALL NOT propagate the exception.

---

### Requirement 6: Sign-Out

**User Story:** As an authenticated user, I want to sign out, so that my session is terminated and I am returned to the sign-in page.

#### Acceptance Criteria

1. THE Navbar SHALL render a "Sign Out" button that is both visible and enabled for authenticated users.
2. WHEN the "Sign Out" button is clicked, THE Navbar SHALL disable the button to prevent double-submission while the sign-out operation is in progress.
3. WHEN the sign-out operation completes successfully, THE session cookie SHALL be cleared and THE Navbar SHALL redirect the user to `/sign-in`.
4. WHEN the sign-out operation completes, THE Navbar SHALL redirect the user to `/sign-in` regardless of whether the operation returned an error.

---

### Requirement 7: Session Persistence Across Page Loads

**User Story:** As an authenticated user, I want my session to survive a page refresh, so that I don't have to sign in again every time I reload the app.

#### Acceptance Criteria

1. WHEN an authenticated user makes a request to a Protected_Route with a valid session cookie, THE Middleware SHALL allow the request to proceed and SHALL serve the requested page at the originally requested URL.
2. WHEN the Middleware processes a request to a protected route and the Session's access token will expire within 60 seconds, THE Middleware SHALL obtain a new access token by refreshing the Session, SHALL update the session cookie with the new token and expiry, and SHALL complete this update before the response is sent to the client.
3. IF the session cookie contains an expired, invalid, or malformed refresh token, THEN THE Middleware SHALL remove the session cookie and SHALL redirect the user to `/sign-in`.
4. IF the Supabase auth service is unavailable when the Middleware attempts to refresh a Session, THEN THE Middleware SHALL remove the session cookie and SHALL redirect the user to `/sign-in`.
