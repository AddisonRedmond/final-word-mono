# Design Document: Game Mode Foundation (Phase 0)

## Overview

This design introduces a **Mode_Registry** as the single authoritative description of every game mode and whether it is selectable right now, plus the server-side availability gate, rotation-safety guarantees, and client discovery wiring built around it. It adds **no new gameplay and no scoring rules** — it is the seam future modes (Category Clash, Letter Scramble, Word Ladder) plug into.

The design is grounded in the mechanisms that already exist in the codebase:

- **`GAME_MODES` union** (`packages/db/src/schema.ts`) — the migration-free string source of truth for mode identity (`battle_royale`, `race`, `duel`, `classic`). The Mode_Registry is keyed on exactly these values.
- **`GameModule` registry** (`apps/server/src/games/registry.ts` + `games/types.ts`) — how realtime modes (`battle_royale`, `race`) register Socket.IO handlers on their own namespace at startup. This is the existing realtime Mode_Dispatch.
- **`player_mode_stats`** (`packages/db/src/schema.ts`) — the unified `(userId, mode, scope)` stats table, already partitioned per mode and written via `upsertModeStats` (`packages/db/src/stats.ts`).
- **Shared-config pattern** — `packages/shared/src/race.ts` (a Zod schema + validated default constant, validated defensively at registration in `games/race/index.ts`). The Mode_Registry follows this exact pattern.

The guiding insight: the dispatch seam the roadmap called for **already exists**. The real Phase 0 gap is that nothing describes a mode's *availability*. A mode is "live" today only because it is hardcoded in the `gameModules` array and offered by the client. The Mode_Registry closes that gap and makes rotation safe.

## Architecture

### Where the registry lives

The Mode_Registry is a shared, Zod-validated definition in the `packages/db` package, exported from its entry alongside `GAME_MODES`. Rationale:

- `GAME_MODES`, `TIER_LIMITS`, `SCORING_CONFIG`, and the other cross-cutting "rules both apps share" constants already live in `packages/db/src/schema.ts`, and both `apps/server` and `apps/client` already depend on `db`. Putting the registry here guarantees server enforcement and client discovery read the *same* definition (Req 1.2) and the descriptor ids cannot drift from `GAME_MODES` (Req 1.4).
- It keeps the registry out of the realtime-only `games/` tree, because Duel (asynchronous) must consult it too.

The registry itself holds **no live database state** — Availability_State is author-time configuration (like `SCORING_CONFIG`), so a maintainer changes it in code and redeploys, with no migration (Req 1.7, Req 7.3). (An alternative — a DB-backed availability table toggled at runtime — is discussed under "Alternatives".)

### High-level flow

```
                    packages/db  (shared source of truth)
          ┌──────────────────────────────────────────────┐
          │  GAME_MODES  ──guards──▶  MODE_REGISTRY        │
          │                           (Mode_Descriptor[])  │
          │  modeRegistrySchema (Zod) validates it         │
          │  helpers: getModeDescriptor, isModeStartable   │
          └───────────────┬───────────────────┬────────────┘
                          │                   │
             imports      │                   │   imports
                          ▼                   ▼
                 apps/server            apps/client
         ┌──────────────────────┐   ┌────────────────────────┐
         │ Create_Gate          │   │ Mode_Discovery          │
         │  - realtime join     │   │  - offer startable only │
         │  - duel creation     │   │  - render history for   │
         │  - rematch path      │   │    any descriptor       │
         │ Mode_Dispatch        │   │  - surface unavailable  │
         │  - registry (RT)     │   │    reason               │
         │  - duel code path    │   └────────────────────────┘
         │  routes by STORED    │
         │  mode, ignores state │
         └──────────────────────┘
```

## Components and Interfaces

### 1. Mode_Descriptor and Availability_State (`packages/db`)

```ts
export const AVAILABILITY_STATES = ["enabled", "beta", "disabled"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

export type ModeKind = "realtime" | "async";

export type ModeDescriptor = {
  /** Must be a member of GAME_MODES. */
  id: GameMode;
  /** Human-readable name for UI. */
  displayName: string;
  /** Selectability for NEW games. */
  availability: AvailabilityState;
  /** Realtime (Socket.IO namespace) vs asynchronous (duel code path). */
  kind: ModeKind;
};
```

`availability` governs only the starting of *new* games; it never influences dispatch or reads (Req 3.2).

### 2. The registry definition and its Zod guard (`packages/db`)

```ts
export const MODE_REGISTRY: Record<GameMode, ModeDescriptor> = {
  battle_royale: { id: "battle_royale", displayName: "Battle Royale", availability: "enabled", kind: "realtime" },
  race:          { id: "race",          displayName: "Elimination Race", availability: "enabled", kind: "realtime" },
  duel:          { id: "duel",          displayName: "Duel",            availability: "enabled", kind: "async" },
  classic:       { id: "classic",       displayName: "Classic",         availability: "disabled", kind: "async" },
};
```

- Typing it as `Record<GameMode, ModeDescriptor>` makes the compiler enforce **exactly one descriptor per `GAME_MODES` member** (Req 1.1): a missing key or an unknown key fails to type-check.
- `modeRegistrySchema` (Zod) re-validates at module load — every key is in `GAME_MODES`, every `id` equals its key, `availability` ∈ `AVAILABILITY_STATES` — and throws a descriptive error on failure (Req 1.5), mirroring how `raceConfigSchema` guards `RACE_CONFIG`.
- `classic` is seeded `disabled`: it exists in `GAME_MODES` but is not startable, and this feature adds no gameplay for it (Req 6.5).

### 3. Pure helpers (`packages/db`)

```ts
export const getModeDescriptor = (mode: string): ModeDescriptor | undefined =>
  (MODE_REGISTRY as Record<string, ModeDescriptor>)[mode];

/** Startability for a NEW game, given the player's beta eligibility. */
export const isModeStartable = (mode: string, isBetaAudience: boolean): boolean => {
  const d = getModeDescriptor(mode);
  if (!d) return false;                       // unknown mode -> unavailable (Req 2.6)
  if (d.availability === "enabled") return true;
  if (d.availability === "beta") return isBetaAudience;
  return false;                               // disabled
};
```

These are pure and injectable, so both the Create_Gate and client discovery share one decision (Req 2.1, 2.5, 2.6; Req 4.1).

The **beta audience** predicate is intentionally a boolean input, not baked in. Phase 0 can supply a trivial implementation (e.g. always `false`, or premium-only via the existing `isPremiumUser`) and refine later without touching the registry.

### 4. Create_Gate (`apps/server`)

A single shared helper that every new-game entry point calls before placing/creating:

```ts
export const assertModeStartable = async (userId, mode) => {
  const isBeta = await resolveBetaAudience(userId); // Phase 0: minimal impl
  if (!isModeStartable(mode, isBeta)) {
    return { ok: false, reason: "mode-unavailable" as const };
  }
  return { ok: true as const };
};
```

Wired into:

- **Realtime join** — in each realtime GameModule's join/lobby-creation handler (Battle Royale, Race), alongside the existing `guestModeGate` / `canStartRealtimeGame` checks. A block maps to a `join:error` with reason `mode-unavailable`, exactly like the existing guest/daily-limit rejections (Req 2.1–2.4).
- **Duel creation** — in the duel-creation code path (the asynchronous entry point), rejecting creation when Duel is unavailable (Req 2.4).
- **Rematch** — the rematch path reuses `assertModeStartable` so a rematch of a now-`disabled` mode is rejected (Req 5.1, 5.2), while an already-created In_Flight_Game is never re-checked and completes normally (Req 5.3).

The gate is the authoritative decision: a client offering a stale mode cannot start a game (Req 2.5).

### 5. Mode_Dispatch is availability-independent (`apps/server`)

Dispatch continues to use the **stored** mode of a game, never its current Availability_State:

- Realtime: the `GameModule` registry (`games/registry.ts`) keeps registering `battle_royale` and `race` at startup unchanged (Req 6.2). Registration is driven by the `gameModules` array, **not** by Availability_State — a `disabled` mode whose games may still be in flight must keep its handlers registered so those games resolve (Req 3.1, 3.2, 3.6).
- Asynchronous Duel: the existing duel resolution/read path is likewise unconditioned on availability (Req 3.2, 3.3).

**Invariant (Req 3.6):** every mode that can appear in a stored/in-flight game must have a registered implementation regardless of availability. A startup check asserts that each `GameModule`'s id and each async mode path is covered for every non-`disabled`-but-still-present mode; disabling a mode must never remove its dispatch.

### 6. Mode_Discovery (`apps/client`)

- The new-game surface reads `MODE_REGISTRY` and offers a mode only when `isModeStartable(mode, isBeta)` is true (Req 4.1–4.3).
- History/results components render any mode that has a descriptor, including `disabled` ones, by looking up `getModeDescriptor(storedMode).displayName` (Req 4.4). They never call `isModeStartable` for display.
- When the server rejects a start with `mode-unavailable`, the client surfaces that reason rather than failing silently (Req 4.5), reusing the existing `join:error`/duel-error display paths.

### 7. Mode-specific stats convention (documentation deliverable)

No code change to `player_mode_stats`. The deliverable is a documented convention (Req 7) captured in a short doc under the mode's spec folder and referenced from `packages/db/src/stats.ts`:

- A new mode records only the columns it tracks via `ModeStatsOutcome`; untracked columns stay NULL (not zero) — "null = not tracked by this mode" is the existing rule (Req 7.2), already honored by `upsertModeStats` for placement vs solve-timing.
- New modes write through the same `(userId, mode, scope)` keying and the same lifetime + season dual-write done on completion (Req 7.4).
- Adding a mode's stats requires only adding the mode to `GAME_MODES` and writing outcomes — no migration (Req 7.3).
- Where a future mode needs an aggregate no existing column expresses, the convention is to add a nullable column to the unified table (shared by all modes, NULL where unused) rather than a per-mode table — consistent with how the former `battle_royale_stats`/`race_stats` tables were collapsed into `player_mode_stats`.
