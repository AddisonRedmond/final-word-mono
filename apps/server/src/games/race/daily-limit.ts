/**
 * Daily-limit seam for Race_Mode.
 *
 * This module is the single point of interaction with the Feature 1
 * Daily_Game_Counter (Req 11.4). All Daily_Game_Counter reads and writes are
 * isolated here so that enabling enforcement when Feature 1 ships requires a
 * change to this file ONLY — no Match or Round logic changes.
 *
 * During the beta period the counter does not exist yet, so the implementation
 * is dormant: `canStartMatch` always permits and `recordMatchStart` is a no-op.
 * This keeps Race_Mode unlimited and free during beta (Req 11.2).
 *
 * Fail-open policy for the future enforcing implementation:
 * `startMatch` awaits these functions defensively. The beta no-op cannot fail.
 * When a real Daily_Game_Counter implementation lands, it MUST fail open on
 * infrastructure errors — if the counter backend is unreachable or errors,
 * `canStartMatch` should resolve to `true` and `recordMatchStart` should
 * swallow the error rather than throw. A counter outage must never block play
 * or crash the game loop; the only intended way a player is blocked is when the
 * counter is available AND the player has genuinely reached the daily limit
 * (Req 11.3).
 */

/**
 * Returns whether the player may start a match against their daily usage.
 *
 * Dormant beta implementation: always permits (Req 11.2).
 *
 * Future enforcing implementation: return `false` only when the
 * Daily_Game_Counter is available and the player has reached the daily limit
 * (Req 11.3); fail open (return `true`) on any counter-backend error.
 */
export const canStartMatch = async (_userId: string): Promise<boolean> => true; // Req 11.2

/**
 * Records a match start against the player's daily usage.
 *
 * Dormant beta implementation: no-op (Req 11.1).
 *
 * Future enforcing implementation: increment the Daily_Game_Counter for the
 * player; swallow/log backend errors rather than throwing so a counter outage
 * never breaks the game loop.
 */
export const recordMatchStart = async (_userId: string): Promise<void> => {}; // Req 11.1
