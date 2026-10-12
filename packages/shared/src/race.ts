import { z } from "zod";

// Optional per-round "game helper" that progressively reveals letters of each
// player's OWN current word to make a hard round winnable before the timer.
// Because every player races an independent word, the reveal is PER-PLAYER: at
// each tick a random position of that player's current word — one they have not
// already found themselves and that has not already been revealed by the helper
// — is revealed to them. Revealed-by-helper letters never count toward the
// final-round "most letters found" tie-break (only letters a player found by
// guessing do). Omit `hints` to disable the helper for a round.
export const roundHintsSchema = z.object({
	// Delay from round start before the FIRST letter is revealed, in ms.
	startMs: z.number().int().positive(),
	// Gap between successive letter reveals, in ms.
	intervalMs: z.number().int().positive(),
	// Maximum number of letters the helper will ever reveal in the round. Capped
	// in logic to at most wordLength - 1 so the helper can never hand a player the
	// entire word.
	maxReveals: z.number().int().positive(),
});

export type RoundHints = z.infer<typeof roundHintsSchema>;

// Per-round tunables. Every value is read from Race_Config rather than
// hardcoded so the mode can be retuned without a code change (Req 2.2, 2.6).
export const roundConfigSchema = z.object({
	timerMs: z.number().int().positive(), // Round timer duration (Req 2.2)
	wordLength: z.number().int().min(3).max(8), // word length for this round (Req 2.2)
	qualifyingCount: z.number().int().positive(), // words to be safe (Req 2.2)
	eliminationPct: z.number().min(0).max(1), // proportion eliminated (Req 2.2)
	hints: roundHintsSchema.optional(), // optional progressive letter-reveal helper
});

// Full Race_Config schema. The `.refine` invariants capture the two
// cross-field rules that a plain object shape cannot express:
//   - lobby-size bounds must be ordered (Req 2.3)
//   - the final round must qualify on a single word (Req 2.8)
export const raceConfigSchema = z
	.object({
		rounds: z.array(roundConfigSchema).min(1), // Req 2.1
		minLobbySize: z.number().int().positive(), // Req 2.3
		maxLobbySize: z.number().int().positive(), // Req 2.3
		lobbyCountdownMs: z.number().int().positive(),
		penaltyThresholdMs: z.number().int().positive(), // Req 2.4
		debounceAmountMs: z.number().int().positive(), // Req 2.4
		updateWindowMs: z.number().int().positive().default(250), // broadcast coalescing (Req 4.7)
	})
	.refine((c) => c.minLobbySize <= c.maxLobbySize, {
		message: "minLobbySize must be <= maxLobbySize",
	})
	.refine((c) => c.rounds.at(-1)?.qualifyingCount === 1, {
		message: "final round qualifyingCount must equal 1", // Req 2.8
	});

export type RoundConfig = z.infer<typeof roundConfigSchema>;
export type RaceConfig = z.infer<typeof raceConfigSchema>;

// Rounding rule for eliminations: ceil, guaranteeing >= 1 elimination when
// more than one survivor remains (resolves Open Question 1). Clamped to
// leave at least one survivor so a round can never wipe the whole field.
export const eliminationCount = (survivors: number, pct: number): number =>
	survivors <= 1
		? 0
		: Math.min(survivors - 1, Math.max(1, Math.ceil(survivors * pct)));

// Validated default. Parsed at module load so an invalid default would throw
// on import rather than silently ship a broken config. Tunable without code
// changes by editing the values below (Req 2.5, 2.6).
export const RACE_CONFIG: RaceConfig = raceConfigSchema.parse({
	rounds: [
		// Round 0 halves the field: ceil(99 * 0.5) = 50 eliminated -> ~49 advance.
		{ timerMs: 90_000, wordLength: 4, qualifyingCount: 3, eliminationPct: 0.5 },
		// Round 1 cuts 60%: ceil(49 * 0.6) = 30 eliminated -> ~19 advance.
		{ timerMs: 75_000, wordLength: 5, qualifyingCount: 2, eliminationPct: 0.6 },
		// Final round: no percentage cut — resolved by first-correct-guess / leader.
		// The 6-letter word is hard, so the game helper kicks in at 30s and reveals
		// one letter every 10s (up to 3 of the 6) to give more players a shot at
		// solving before the 60s timer. Helper-revealed letters do not count toward
		// the "most letters found" tie-break.
		{
			timerMs: 60_000,
			wordLength: 6,
			qualifyingCount: 1,
			eliminationPct: 0,
			hints: { startMs: 30_000, intervalMs: 10_000, maxReveals: 3 },
		},
	],
	// A full field is 99 participants (battle-royale style). A lobby that starts
	// short is topped up with bots to this minimum on countdown zero, so a lone
	// human joins a field of 1 human + 98 bots. `maxLobbySize` must be >= this
	// (schema invariant) and caps how many real players can share one lobby.
	minLobbySize: 99,
	maxLobbySize: 99,
	lobbyCountdownMs: 30_000,
	penaltyThresholdMs: 300,
	debounceAmountMs: 600,
	updateWindowMs: 250,
});
