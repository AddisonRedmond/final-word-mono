# Feature: Shareable Duels and Random Matchmaking

## Overview

Add two ways for players to start a duel in Final Word without requiring an existing in-app friend:

1. **Share a Duel Link** — an authenticated user creates a duel invitation and shares a link with someone who may not have a Final Word account yet.
2. **Random Duel** — an authenticated user enters a matchmaking queue and is paired with another eligible user who is also waiting.

Both features should reuse the existing duel gameplay, result handling, and participant infrastructure wherever practical. They should not introduce a separate duel engine.

## Goals

- Reduce the friction between discovering Final Word and playing a game.
- Let players invite people who are not registered yet.
- Help active users find opponents when their friends are unavailable.
- Keep matchmaking reliable when traffic is low.
- Prevent duplicate matches, stale queue entries, and unauthorized duel access.

## Non-goals

- Building a new duel gameplay engine.
- Requiring users to add each other as friends before playing.
- Introducing ranked matchmaking or an Elo system in the first version.
- Treating bots as real users or silently representing bot matches as human matches.

---

# Feature A: Share a Duel Link

## User experience

### Create and share

1. An authenticated user selects **Invite by Link** or **Share Duel** from the existing duel/friends interface.
2. The server creates a duel invitation using the existing duel creation flow where possible.
3. The server returns a shareable URL containing a high-entropy, unguessable invitation token.
4. The creator can copy the link and, where supported, use the device's native share sheet.
5. The UI clearly communicates that the link is ready to share.

Example URL shape (illustrative only):

`https://finalword.io/duel/<invitation-token>`

Do not use a sequential database ID as the only invitation secret.

### Recipient joins

1. The recipient opens the link.
2. If they are not authenticated, preserve the invitation token through sign-in/sign-up and return them to the invitation after authentication.
3. Explain who invited them and what accepting the invitation will do.
4. On acceptance, validate the invitation server-side and add the recipient to the duel using existing participant rules.
5. Route the recipient into the existing duel screen.
6. Handle invalid, expired, already accepted, declined, completed, or full invitations with a clear message and a useful next action.

### Invitation rules

- The creator must not be able to accept their own invitation as another participant.
- A token must be sufficiently random and unguessable.
- Validate token, expiry, duel status, capacity, and participant eligibility on the server.
- Make acceptance idempotent so retries or double-clicks cannot create duplicate participants.
- Avoid leaking a secret word or other hidden game state before the existing duel rules permit it.
- If the existing duel supports multiple participants, follow its existing capacity and winner rules; do not silently change them for link invitations.
- Define a reasonable expiration period and make it configurable. Suggested initial default: 24 hours.
- Do not require a recipient to have an account before opening the invitation landing page; authentication may be required to participate.
- If signup is completed from an invitation, preserve and resume the intended invitation rather than dropping the user on the generic homepage.

## Suggested UI

- Add **Invite by Link** near existing duel invitation actions.
- Provide **Copy Link** and a native share action where available.
- Show a success confirmation after the link is created or copied.
- The invitation page should explain the game briefly and have one primary action: **Accept Duel**.
- For unauthenticated recipients, use a clear **Sign in or create an account to play** step and return them to the invitation afterward.

## Acceptance criteria

- An authenticated user can create and share a valid invitation link.
- A recipient without an account can open the link, sign up/sign in, and return to the same invitation.
- A valid recipient can accept and enter the existing duel flow.
- Invalid or expired links fail safely with clear user feedback.
- Double-clicks, retries, and concurrent acceptance attempts do not create duplicate participants.
- Invitation acceptance enforces existing duel capacity and eligibility rules.
- Hidden game state remains protected.
- Existing duel invitations and gameplay continue to work.

---

# Feature B: Random Duel Matchmaking

## User experience

1. An authenticated user selects **Random Duel**.
2. The UI displays **Finding an opponent…**, elapsed/waiting status, and a **Cancel** action.
3. The server queues the user if they are eligible.
4. When another eligible user is waiting, the server pairs them and creates a duel through the existing duel creation flow.
5. Both players are notified and routed into the new duel.
6. After the match, offer **Rematch** and **Find Another Opponent** where appropriate.

Random Duel should initially be one-on-one to keep matchmaking simple and improve the chance of a quick match with a small player base.

## Matchmaking rules

- Only authenticated users can enter the queue.
- A user can have at most one active matchmaking queue entry.
- A user must not be matched with themselves.
- Do not match a user who is disconnected, already matched, or ineligible under existing active-duel limits.
- Respect existing duel limits and participant rules.
- Matching must be atomic under concurrent requests. Two workers/requests must not claim the same queue entry or create overlapping matches.
- Make queue join, cancellation, matching, and cleanup safe to retry.
- Remove stale entries and handle disconnects, expired sessions, and failed duel creation.
- If duel creation fails, do not leave either user stuck in a matched state; restore a valid queue state or notify both users and clean up safely.
- Notify both participants reliably and make reconnecting clients able to recover their current matchmaking/match status.
- Do not expose internal user identifiers or sensitive account information in queue responses.

## Low-population behavior

The player base may initially be too small for immediate human matches.

- Be honest that matchmaking is searching for a real player.
- Never silently label a bot as a human opponent.
- After a configurable wait threshold (suggested initial value: 30 seconds), offer the user a choice:
  - **Keep waiting for a real player**
  - **Play an AI opponent** (only if an AI duel mode is implemented and supported)
- Allow cancellation at any time before a match is committed.
- Do not impose an arbitrary long wait. Use observed queue wait times to tune the threshold.
- If AI opponents are not implemented for this mode, omit that option and keep the queue/cancel experience clear.

## Suggested UI

- Add **Random Duel** as a clear action near the existing duel entry points.
- Show a waiting state, cancel button, and helpful message if the queue is empty.
- On successful match, show a brief **Opponent found** transition and enter the duel.
- After completion, make rematch and queue-again actions easy to find.
- Keep the flow responsive on desktop and mobile.

## Acceptance criteria

- An authenticated user can enter and cancel matchmaking.
- A second eligible user can be paired with the first and both enter the same duel.
- Concurrent queue requests cannot match one user more than once.
- Users already in an incompatible active duel are not matched.
- Disconnects, stale entries, cancellation races, and duel-creation failures are handled without orphaned matches or queue entries.
- Users can recover their queue/match status after reconnecting or refreshing.
- Low traffic produces a clear waiting state, not a broken or misleading experience.
- Bot opponents, if offered, are identified honestly as AI.

---

# Technical guidance

## Reuse existing infrastructure

Before implementation, inspect the existing duel routes, schema, participant limits, and lifecycle. Prefer to reuse existing duel creation and result-handling code. Do not duplicate winner calculation or secret-word visibility rules.

Potential existing areas to inspect include the duel router and procedures, duel participant records, active-duel constraints, realtime hooks, and the current duel screen. Names may differ; verify against the codebase rather than assuming these exact names exist.

## Persistence and concurrency

- Use database-backed queue state if matchmaking must survive server restarts or support multiple server instances.
- Use transactions and appropriate uniqueness/locking constraints to make matching atomic.
- Avoid relying solely on an in-memory queue if production may run more than one server instance or restart during matchmaking.
- Add only the schema and indexes actually needed by the existing architecture.
- Keep sensitive invitation tokens out of logs and analytics.
- Avoid one database write per visual bot/player arrival; batch or derive UI-only presentation state where appropriate.

## Security and abuse prevention

- Authenticate all state-changing actions.
- Validate all input on the server.
- Rate-limit invitation creation and queue join/cancel operations.
- Do not allow a client to choose arbitrary participant IDs or bypass duel eligibility.
- Ensure invitation tokens are unguessable and expire.
- Do not expose service-role credentials or privileged server logic to clients.
- Ensure accepting an invitation or claiming a queue match is authorized and transactional.

## Analytics

Track the minimum events needed to assess whether the features help activation and retention:

- `duel_link_created`
- `duel_link_opened`
- `duel_link_accepted`
- `random_duel_queue_joined`
- `random_duel_matched`
- `random_duel_cancelled`
- `duel_started`
- `duel_completed`
- `duel_rematch_started`

Avoid recording invitation tokens or unnecessary personal information in analytics.

## Implementation sequence

1. Inspect and document the current duel lifecycle and constraints.
2. Implement shareable invitations by reusing existing duel creation and participant logic.
3. Add invitation landing, authentication return path, and safe acceptance.
4. Implement matchmaking queue persistence and atomic matching.
5. Add cancellation, stale-entry cleanup, reconnect recovery, and failure handling.
6. Add UI states and analytics.
7. Test concurrency, authorization, expiry, disconnects, and existing duel regressions.
8. Deploy and monitor queue wait times, invitation conversion, first-game completion, and rematches.

## Testing checklist

- [ ] Creator cannot join their own invitation as a second player.
- [ ] Valid link works for an existing user.
- [ ] Valid link survives a new user's sign-up/sign-in flow.
- [ ] Expired, malformed, reused, and full invitations are handled safely.
- [ ] Duplicate acceptance requests do not create duplicate participants.
- [ ] Queue cancellation racing with a match does not create an inconsistent state.
- [ ] Two concurrent users cannot claim the same opponent.
- [ ] One user cannot appear in multiple simultaneous matches.
- [ ] Disconnects and stale queue records are cleaned up.
- [ ] Matchmaking works after a server restart if queue persistence is required.
- [ ] Both matched players can recover the match after reconnecting.
- [ ] Existing friend duels, multiplayer duels, winner logic, and secret-word privacy still work.
- [ ] Analytics events fire at the correct lifecycle points without recording secrets.

## Definition of done

Both features are integrated into the existing Final Word experience, reuse existing duel rules, work on desktop and mobile, fail safely under concurrency and disconnects, and expose enough analytics to measure whether they help users start and complete games.
