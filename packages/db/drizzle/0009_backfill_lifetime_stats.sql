-- Custom SQL migration file, put your code below! --

-- Backfill lifetime player_mode_stats from the legacy per-mode tables.
--
-- Step 1 of retiring battle_royale_stats / race_stats (design D3: "dual-write,
-- then retire"). The /stats page and guest gate read player_mode_stats; the
-- legacy rows were never copied over, so every pre-migration game is invisible
-- (Lifetime shows "No games yet"). This copies each legacy aggregate into one
-- `scope = 'lifetime'` row per (user, mode).
--
-- Idempotent + non-destructive by design:
--   * ON CONFLICT DO NOTHING on the (user_id, mode, scope) PK means a user who
--     has ALREADY accrued a lifetime row from a post-migration game keeps that
--     (newer, authoritative) row untouched. This migration only SEEDS rows that
--     don't exist yet, so re-running it is safe and it never clobbers live data.
--   * Only lifetime rows are written. Seasonal rows and Season_Points are a
--     going-forward concept and are deliberately NOT synthesized from legacy
--     lifetime aggregates (there is no per-season history to reconstruct).
--
-- Column mapping (legacy -> player_mode_stats):
--   * mode               : the literal 'battle_royale' / 'race'
--   * scope              : 'lifetime'
--   * core counters      : copied 1:1 (games/wins/draws/streaks/won_last_game,
--                          total_guesses/total_correct_guesses)
--   * average_placement  : legacy is `real NOT NULL DEFAULT 0`; the new column
--                          is nullable (null = "no placed games"). Map 0 -> NULL
--                          so an empty aggregate never records a nonsensical
--                          placement of 0. best_placement is already nullable
--                          and copies straight across.
--   * solve_count/_ms    : left at defaults (0 / 0 / null) — BR and Race do not
--                          time an individual solve.
--   * season_points /    : left at defaults (0 / 0) — lifetime rows never carry
--     best_match_points    points (R2A.6).
--   * timestamps         : last_played_at / created_at / updated_at copied so
--                          the seeded row reflects the real history.

INSERT INTO "player_mode_stats" (
	"user_id", "mode", "scope",
	"games_played", "wins", "draws",
	"current_win_streak", "best_win_streak", "won_last_game",
	"total_guesses", "total_correct_guesses",
	"average_placement", "best_placement",
	"last_played_at", "created_at", "updated_at"
)
SELECT
	"user_id", 'battle_royale', 'lifetime',
	"games_played", "wins", "draws",
	"current_win_streak", "best_win_streak", "won_last_game",
	"total_guesses", "total_correct_guesses",
	NULLIF("average_placement", 0), "best_placement",
	"last_played_at", "created_at", "updated_at"
FROM "battle_royale_stats"
ON CONFLICT ("user_id", "mode", "scope") DO NOTHING;
--> statement-breakpoint
INSERT INTO "player_mode_stats" (
	"user_id", "mode", "scope",
	"games_played", "wins", "draws",
	"current_win_streak", "best_win_streak", "won_last_game",
	"total_guesses", "total_correct_guesses",
	"average_placement", "best_placement",
	"last_played_at", "created_at", "updated_at"
)
SELECT
	"user_id", 'race', 'lifetime',
	"games_played", "wins", "draws",
	"current_win_streak", "best_win_streak", "won_last_game",
	"total_guesses", "total_correct_guesses",
	NULLIF("average_placement", 0), "best_placement",
	"last_played_at", "created_at", "updated_at"
FROM "race_stats"
ON CONFLICT ("user_id", "mode", "scope") DO NOTHING;
