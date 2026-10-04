ALTER TABLE "profiles" ADD COLUMN "polar_customer_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "premium_status" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "premium_until" timestamp with time zone;