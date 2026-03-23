# Requirements Document

## Introduction

This feature establishes proper WebSocket scaffolding for the Final Word application — a multiplayer word game. The scaffolding covers the server-side WebSocket infrastructure using Hono with `@hono/node-server`, a typed message protocol shared between client and server, and a client-side WebSocket hook integrated with the existing Next.js + Zustand stack. The goal is a reliable, type-safe real-time communication layer that game features (e.g. Battle Royale lobbies) can build on top of.

## Glossary

- **WS_Server**: The Hono-based Node.js server responsible for handling WebSocket connections
- **WS_Client**: The WebSocket client running in the browser within the Next.js application
- **Message**: A typed JSON payload exchanged between WS_Client and WS_Server
- **MessageType**: A discriminated union string literal that identifies the kind of a Message
- **Connection**: An active WebSocket session between one WS_Client and the WS_Server
- **Lobby**: A named game room that players join before a match begins; Lobby state is maintained in-memory only and is not persisted to any database or external store
- **useWebSocket**: A React hook that manages a single WebSocket Connection on the client
- **Auth_Token**: A Firebase ID token used to authenticate a WS_Client during the handshake

---

## Requirements

### Requirement 1: Server-Side WebSocket Adapter

**User Story:** As a developer, I want the server to use the correct Hono WebSocket adapter for Node.js, so that WebSocket connections work reliably in the Node.js runtime.

#### Acceptance Criteria

1. THE WS_Server SHALL use `@hono/node-server/conninfo` and the `createNodeWebSocket` helper from `@hono/node-server` instead of `upgradeWebSocket` from `hono/deno`
2. WHEN the WS_Server starts, THE WS_Server SHALL listen on a configurable port (defaulting to 4200)
3. WHEN a WS_Client connects to the `/ws` endpoint, THE WS_Server SHALL complete the WebSocket upgrade handshake
4. IF the WebSocket upgrade fails, THEN THE WS_Server SHALL return an HTTP 400 response with a descriptive error message

---

### Requirement 2: Typed Message Protocol

**User Story:** As a developer, I want a shared typed message schema between client and server, so that both sides agree on message shapes and I get compile-time safety.

#### Acceptance Criteria

1. THE Message protocol SHALL be defined in the shared `packages/types` package so both client and server can import it
2. THE Message protocol SHALL use a discriminated union on a `type` field to distinguish between different MessageTypes
3. THE Message protocol SHALL include at minimum the following MessageTypes: `ping`, `pong`, `error`, `join_lobby`, `leave_lobby`, and `lobby_state`
4. WHEN a Message is serialized for transmission, THE WS_Client and WS_Server SHALL serialize it as JSON
5. WHEN a Message is received, THE WS_Client and WS_Server SHALL deserialize and validate it against the Message schema before processing
6. IF a received payload does not conform to the Message schema, THEN THE receiving party SHALL emit an `error` Message with a descriptive reason and discard the invalid payload
7. FOR ALL valid Message objects, serializing then deserializing SHALL produce an equivalent object (round-trip property)

---

### Requirement 3: Server-Side Message Handling

**User Story:** As a developer, I want the server to route incoming messages to typed handlers, so that adding new message types is straightforward and safe.

#### Acceptance Criteria

1. WHEN the WS_Server receives a `ping` Message, THE WS_Server SHALL respond with a `pong` Message on the same Connection
2. WHEN the WS_Server receives a `join_lobby` Message, THE WS_Server SHALL associate the Connection with the specified Lobby
3. WHEN the WS_Server receives a `leave_lobby` Message, THE WS_Server SHALL remove the Connection from the specified Lobby
4. WHEN a Connection closes, THE WS_Server SHALL remove the Connection from any Lobby it was associated with
5. IF the WS_Server receives a Message with an unrecognised MessageType, THEN THE WS_Server SHALL send an `error` Message back to the sender with a reason of `"unknown_message_type"`
6. WHILE a Connection is associated with a Lobby, THE WS_Server SHALL broadcast `lobby_state` Messages to all Connections in that Lobby when the Lobby membership changes

---

### Requirement 4: Client-Side Authentication Handshake

**User Story:** As a developer, I want the WebSocket connection to be authenticated using the existing Firebase auth token, so that only signed-in users can establish a Connection.

#### Acceptance Criteria

1. WHEN a user signs in, THE WS_Client SHALL store the Firebase Auth_Token in an HttpOnly, SameSite=Strict cookie (e.g. named `token`)
2. WHEN the WS_Client initiates a Connection, THE browser SHALL automatically include the `token` cookie in the HTTP upgrade request
3. WHEN the WS_Server receives a new Connection, THE WS_Server SHALL validate the Auth_Token from the `token` cookie using Firebase Admin SDK before completing the handshake
4. IF the Auth_Token cookie is missing or invalid, THEN THE WS_Server SHALL close the Connection with WebSocket close code `4001` and reason `"unauthorized"`
5. WHEN the Auth_Token expires during an active Connection, THE WS_Client SHALL obtain a refreshed Auth_Token, update the `token` cookie, and reconnect

---

### Requirement 5: Client-Side `useWebSocket` Hook

**User Story:** As a developer, I want a React hook that manages the WebSocket lifecycle, so that components can send and receive typed messages without managing raw WebSocket state.

#### Acceptance Criteria

1. THE useWebSocket hook SHALL accept a configuration object containing the server URL and an optional `onMessage` callback typed to the Message union
2. WHEN a component mounts with useWebSocket, THE WS_Client SHALL open a Connection to the WS_Server
3. WHEN a component unmounts, THE WS_Client SHALL close the Connection cleanly
4. THE useWebSocket hook SHALL expose a `send` function that accepts a Message and serializes it before transmission
5. WHEN the WS_Client receives a Message, THE useWebSocket hook SHALL invoke the `onMessage` callback with the deserialized and validated Message
6. WHEN the Connection closes unexpectedly, THE WS_Client SHALL attempt to reconnect with exponential backoff, up to a maximum of 5 retries
7. THE useWebSocket hook SHALL expose a `status` field with values `connecting`, `open`, `closing`, or `closed` reflecting the current Connection state
8. WHILE the Connection status is not `open`, THE useWebSocket hook SHALL queue outbound Messages and flush the queue once the Connection reaches `open` status

---

### Requirement 6: Connection State in Zustand

**User Story:** As a developer, I want WebSocket connection state accessible from the global Zustand store, so that any component can react to connectivity changes without prop drilling.

#### Acceptance Criteria

1. THE WS_Client SHALL expose a Zustand slice that stores the current Connection `status` and the most recently received Message
2. WHEN the Connection `status` changes, THE WS_Client SHALL update the Zustand store synchronously
3. WHEN a Message is received, THE WS_Client SHALL update the `lastMessage` field in the Zustand store with the deserialized Message
4. THE Zustand slice SHALL provide a `sendMessage` action that delegates to the `send` function exposed by useWebSocket
