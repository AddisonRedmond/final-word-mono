# Implementation Plan: WebSocket Scaffolding

## Overview

Implement a type-safe, authenticated WebSocket layer for Final Word. Tasks progress from shared types → server infrastructure → client hook and store → wiring everything together.

## Tasks

- [x] 1. Add shared WebSocket message types to `packages/types`
  - [x] 1.1 Install `zod` in `packages/types` and create `packages/types/src/ws.ts`
    - Define `ServerMessage`, `ClientMessage`, and `WsMessage` discriminated unions
    - Define Zod schemas: `ServerMessageSchema`, `ClientMessageSchema`, `WsMessageSchema`
    - Implement `serializeMessage(msg: WsMessage): string` and `parseMessage(raw: string): WsMessage`
    - Export all types and helpers from `packages/types/src/index.ts` (or equivalent barrel)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.2 Write property test for message round-trip (Property 1)
    - File: `packages/types/src/__tests__/ws.property.test.ts`
    - Install `fast-check` and `vitest` as dev deps in `packages/types`
    - **Property 1: Message round-trip — `parseMessage(serializeMessage(msg))` deeply equals `msg` for any valid `WsMessage`**
    - **Validates: Requirements 2.4, 2.5, 2.7**
    - `// Feature: websocket-scaffolding, Property 1: Message round-trip`

  - [x] 1.3 Write property test for invalid payload rejection (Property 2)
    - File: `packages/types/src/__tests__/ws.property.test.ts`
    - **Property 2: `parseMessage` throws for any string that is not a valid `WsMessage`**
    - **Validates: Requirements 2.6, 3.5**
    - `// Feature: websocket-scaffolding, Property 2: Invalid payload produces error`

- [x] 2. Fix server WebSocket adapter and add auth middleware
  - [x] 2.1 Replace `hono/deno` adapter with `createNodeWebSocket` in `apps/server/src/index.ts`
    - Import `createNodeWebSocket` from `@hono/node-server/ws`
    - Call `createNodeWebSocket({ app })` to get `{ injectWebSocket, upgradeWebSocket }`
    - Pass the HTTP server returned by `serve` to `injectWebSocket`
    - Keep the server listening on port `4200` (read from `process.env.PORT` with fallback)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Add Firebase Admin SDK and create auth middleware
    - Install `firebase-admin` in `apps/server`
    - Create `apps/server/src/middleware/auth.ts`
    - Middleware reads the `token` cookie from the request, calls `adminAuth.verifyIdToken`, sets `c.set('uid', decoded.uid)` on success
    - Returns HTTP 401 on missing or invalid token
    - _Requirements: 4.3, 4.4_

  - [x] 2.3 Write property test for auth token validation (Property 7)
    - File: `apps/server/src/__tests__/auth.property.test.ts`
    - Install `fast-check` and `vitest` as dev deps in `apps/server`
    - **Property 7: Valid token → middleware calls `next()`; missing/invalid token → returns 401**
    - **Validates: Requirements 4.3, 4.4**
    - `// Feature: websocket-scaffolding, Property 7: Auth token validation`

- [x] 3. Implement server-side LobbyRegistry
  - [x] 3.1 Create `apps/server/src/ws/lobbyRegistry.ts`
    - Define `Connection` interface `{ uid: string; ws: WSContext }`
    - Implement `LobbyRegistry` class with `join`, `leave`, `removeAll`, and `broadcast` methods
    - Internal state: `Map<string, Set<Connection>>`
    - `broadcast` serializes the `ClientMessage` with `serializeMessage` before calling `ws.send`
    - _Requirements: 3.2, 3.3, 3.4, 3.6_

  - [x] 3.2 Write property test for join/leave round-trip (Property 4)
    - File: `apps/server/src/__tests__/lobbyRegistry.property.test.ts`
    - **Property 4: After join then leave, lobby member set is identical to pre-join state**
    - **Validates: Requirements 3.2, 3.3**
    - `// Feature: websocket-scaffolding, Property 4: Join then leave is a round-trip`

  - [x] 3.3 Write property test for close removes from all lobbies (Property 5)
    - File: `apps/server/src/__tests__/lobbyRegistry.property.test.ts`
    - **Property 5: `removeAll(conn)` removes the connection from every lobby it was in**
    - **Validates: Requirements 3.4**
    - `// Feature: websocket-scaffolding, Property 5: Connection close removes from all lobbies`

  - [x] 3.4 Write property test for broadcast on membership change (Property 6)
    - File: `apps/server/src/__tests__/lobbyRegistry.property.test.ts`
    - **Property 6: All N members of a lobby receive a `lobby_state` message when membership changes**
    - **Validates: Requirements 3.6**
    - `// Feature: websocket-scaffolding, Property 6: Lobby membership change broadcasts to all members`

- [x] 4. Implement server-side message router and wire up `/ws` endpoint
  - [x] 4.1 Create `apps/server/src/ws/router.ts`
    - Implement `routeMessage(msg: ServerMessage, conn: Connection, registry: LobbyRegistry): ClientMessage | null`
    - Handle `ping` → return `pong`
    - Handle `join_lobby` → `registry.join`, then `registry.broadcast` with updated `lobby_state`
    - Handle `leave_lobby` → `registry.leave`, then `registry.broadcast` with updated `lobby_state`
    - Unknown type → return `{ type: 'error', reason: 'unknown_message_type' }`
    - Wrap handler body in try/catch; on exception return `{ type: 'error', reason: 'internal_server_error' }` and log
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 4.2 Write property test for ping → pong (Property 3)
    - File: `apps/server/src/__tests__/router.property.test.ts`
    - **Property 3: `routeMessage({ type: 'ping' }, conn, registry)` always returns exactly `{ type: 'pong' }`**
    - **Validates: Requirements 3.1**
    - `// Feature: websocket-scaffolding, Property 3: Ping produces pong`

  - [x] 4.3 Wire auth middleware, router, and registry into the `/ws` endpoint in `apps/server/src/index.ts`
    - Apply auth middleware to the `/ws` route
    - On `onMessage`: call `parseMessage`, call `routeMessage`, send result if non-null; on parse error send `{ type: 'error', reason: 'invalid_message' }`
    - On `onClose`: call `registry.removeAll(conn)` and broadcast updated `lobby_state` for affected lobbies
    - _Requirements: 1.3, 2.5, 2.6, 3.1–3.6, 4.3, 4.4_

- [x] 5. Checkpoint — server tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement client-side Zustand store `useWsStore`
  - [x] 6.1 Create `apps/client/src/state/useWsStore.ts`
    - Define `WsState` interface with `status`, `lastMessage`, `sendMessage`, `_setSend`, `_setStatus`, `_setLastMessage`
    - Initial `status` is `'closed'`, `lastMessage` is `null`, `sendMessage` is a no-op until `_setSend` is called
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.2 Write property test for status syncing to store (Property 11)
    - File: `apps/client/src/__tests__/useWsStore.property.test.ts`
    - Install `fast-check` and `vitest` as dev deps in `apps/client` if not already present
    - **Property 11: After `_setStatus(s)` is called, `store.status === s` for any valid status value**
    - **Validates: Requirements 6.2**
    - `// Feature: websocket-scaffolding, Property 11: Status changes sync to Zustand store`

- [x] 7. Implement client-side `useWebSocket` hook
  - [x] 7.1 Create `apps/client/src/hooks/useWebSocket.ts`
    - Accept `{ url: string; onMessage?: (msg: ClientMessage) => void }`
    - Open `WebSocket` on mount; close cleanly on unmount
    - On `onopen`: flush queued messages in order, call `store._setStatus('open')`, call `store._setSend(send)`
    - On `onmessage`: call `parseMessage`, invoke `onMessage` callback, call `store._setLastMessage`; on parse error log and ignore
    - On `onclose` (unexpected): schedule reconnect with `2^retryCount` second backoff (max 5 retries); call `store._setStatus('connecting')`; after max retries call `store._setStatus('closed')`
    - `send(msg)`: if open, serialize and transmit; otherwise push to outbound queue
    - Call `store._setSend(send)` so `useWsStore.sendMessage` delegates correctly
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.2, 6.3, 6.4_

  - [x] 7.2 Write property test for received message → callback + store (Property 8)
    - File: `apps/client/src/__tests__/useWebSocket.property.test.ts`
    - **Property 8: For any valid `ClientMessage`, `onMessage` is called and `store.lastMessage` equals that message**
    - **Validates: Requirements 5.5, 6.3**
    - `// Feature: websocket-scaffolding, Property 8: Received messages invoke callback and update store`

  - [x] 7.3 Write property test for reconnection exponential backoff (Property 9)
    - File: `apps/client/src/__tests__/useWebSocket.property.test.ts`
    - **Property 9: Delay before retry N equals `2^N` seconds; no retry after 5 failures**
    - **Validates: Requirements 5.6**
    - `// Feature: websocket-scaffolding, Property 9: Reconnection uses exponential backoff`

  - [x] 7.4 Write property test for message queue flush on open (Property 10)
    - File: `apps/client/src/__tests__/useWebSocket.property.test.ts`
    - **Property 10: All messages queued while not open are sent in order once connection opens; queue is empty after flush**
    - **Validates: Requirements 5.8**
    - `// Feature: websocket-scaffolding, Property 10: Message queue flushes on open`

- [x] 8. Handle token refresh and reconnect (Requirement 4.5)
  - [x] 8.1 Add token refresh logic to `useWebSocket`
    - Subscribe to Firebase `onIdTokenChanged`; when a new token is available, update the `token` cookie and trigger a reconnect (close current connection, reset retry counter, open new connection)
    - _Requirements: 4.1, 4.5_

- [x] 9. Final checkpoint — all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with a minimum of 100 runs; each test includes the comment tag `// Feature: websocket-scaffolding, Property N: <text>`
- Unit tests (server starts, upgrade succeeds/fails, hook mount/unmount, store initial shape) should be added alongside the property tests in the same test files
