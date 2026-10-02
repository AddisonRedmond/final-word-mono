/**
 * Daily-limit seam for Battle_Royale_Mode.
 *
 * Battle Royale had no daily-limit seam before the guest (anonymous) feature;
 * this module is introduced additively so the one-game-per-mode rule can cover
 * Battle Royale the same way it covers Race, keeping all match-start gating in
 * one place (R9.4). Every export carries a `guest`/`anon`-adjacent identifier so
 * the whole feature is greppable and removable in one pass.
 *
 * Behaviour mirrors Race's seam (`race/daily-limit.ts`):
 *   - Registered users (`!isAnonymous`) are never gated (R6.8).
 *   - Guests are allowed ONE realtime Battle Royale game, derived from this
 *     mode's own `battle_royale_stats` row via the shared `guestModeGate`
 *     (R6.1, R6.2, R6.4).
 *
 * Because the gate reads the *mode's own* stats table, a guest blocked in
 * Battle Royale can still start Race and vice versa (R6.4).
 *
 * Fail-open policy: `guestModeGate` resolves to `true` on any stats-store error
 * so a counter/stats outage never blocks play or crashes the game loop.
 */

import { battleRoyaleStats } from "db";

import { guestModeGate } from "../guest-mode-gate.js";

/**
 * Returns whether the player may start a Battle Royale match.
 *
 * Registered users (`!isAnonymous`) always return `true` without reading stats
 * (R6.8). Guests delegate to `guestModeGate(userId, battleRoyaleStats)`, which
 * allows exactly one game per mode (R6.1, R6.2, R6.4).
 */
export const canStartMatch = async (
  userId: string,
  isAnonymous: boolean, // from socket.data.isAnonymous via the join handler
): Promise<boolean> => {
  // Registered users: never gated (R6.8).
  if (!isAnonymous) {
    return true;
  }

  // Guests: one game per mode, derived from this mode's stats row (R6.1–R6.4).
  return guestModeGate(userId, battleRoyaleStats);
};
