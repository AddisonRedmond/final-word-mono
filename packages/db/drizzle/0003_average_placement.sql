ALTER TABLE "battle_royale_stats" DROP COLUMN "placement_sum";--> statement-breakpoint
ALTER TABLE "battle_royale_stats" ADD COLUMN "average_placement" real DEFAULT 0 NOT NULL;
