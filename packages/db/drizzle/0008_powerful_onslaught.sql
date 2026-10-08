CREATE TABLE "duel_results" (
	"duel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"won" boolean NOT NULL,
	"is_draw" boolean DEFAULT false NOT NULL,
	"solved" boolean NOT NULL,
	"guesses" integer NOT NULL,
	"solve_ms" integer,
	"completed_at" timestamp with time zone NOT NULL,
	"season" text NOT NULL,
	CONSTRAINT "duel_results_duel_id_user_id_pk" PRIMARY KEY("duel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "player_mode_stats" (
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"scope" text NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"current_win_streak" integer DEFAULT 0 NOT NULL,
	"best_win_streak" integer DEFAULT 0 NOT NULL,
	"won_last_game" boolean DEFAULT false NOT NULL,
	"total_guesses" integer DEFAULT 0 NOT NULL,
	"total_correct_guesses" integer DEFAULT 0 NOT NULL,
	"average_placement" real,
	"best_placement" integer,
	"solve_count" integer DEFAULT 0 NOT NULL,
	"total_solve_ms" integer DEFAULT 0 NOT NULL,
	"fastest_solve_ms" integer,
	"season_points" integer DEFAULT 0 NOT NULL,
	"best_match_points" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_mode_stats_user_id_mode_scope_pk" PRIMARY KEY("user_id","mode","scope")
);
--> statement-breakpoint
CREATE TABLE "season_placements" (
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"season" text NOT NULL,
	"placement" integer NOT NULL,
	"games_played" integer NOT NULL,
	"wins" integer NOT NULL,
	"ranking_value" real NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_placements_user_id_mode_season_pk" PRIMARY KEY("user_id","mode","season")
);
--> statement-breakpoint
ALTER TABLE "duels" ADD COLUMN "rematch_of_duel_id" uuid;--> statement-breakpoint
ALTER TABLE "duel_results" ADD CONSTRAINT "duel_results_duel_id_duels_id_fk" FOREIGN KEY ("duel_id") REFERENCES "public"."duels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_results" ADD CONSTRAINT "duel_results_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_mode_stats" ADD CONSTRAINT "player_mode_stats_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_placements" ADD CONSTRAINT "season_placements_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duel_results_user_completed_idx" ON "duel_results" USING btree ("user_id","completed_at");--> statement-breakpoint
CREATE INDEX "pms_mode_scope_idx" ON "player_mode_stats" USING btree ("mode","scope");--> statement-breakpoint
CREATE INDEX "season_placements_user_idx" ON "season_placements" USING btree ("user_id","mode","season");--> statement-breakpoint
CREATE INDEX "season_placements_board_idx" ON "season_placements" USING btree ("mode","season","placement");--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_rematch_of_duel_id_duels_id_fk" FOREIGN KEY ("rematch_of_duel_id") REFERENCES "public"."duels"("id") ON DELETE set null ON UPDATE no action;