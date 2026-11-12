CREATE TABLE "duel_guesses" (
	"duel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"guesses" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "duel_guesses_duel_id_user_id_pk" PRIMARY KEY("duel_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "duel_guesses" ADD CONSTRAINT "duel_guesses_duel_id_duels_id_fk" FOREIGN KEY ("duel_id") REFERENCES "public"."duels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_guesses" ADD CONSTRAINT "duel_guesses_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Backfill: copy existing guesses so in-flight and historical duels keep their
-- guess history after the cutover. Idempotent (safe to re-run).
INSERT INTO "duel_guesses" ("duel_id", "user_id", "guesses")
SELECT "duel_id", "user_id", "guesses"
FROM "duel_participants"
WHERE cardinality("guesses") > 0
ON CONFLICT ("duel_id", "user_id") DO NOTHING;
