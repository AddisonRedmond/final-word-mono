import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Point at the Drizzle-owned tables only. The Supabase-owned duel tables live
  // in ./src/schema.duels.ts and are NOT part of this entrypoint, so
  // drizzle-kit generate/push/pull cannot emit a colliding CREATE migration for
  // them. See packages/db/src/schema.ts for the full ownership rationale.
  schema: "./src/schema.drizzle.ts",
  out: "./drizzle",
  // Defense-in-depth for push/pull (which introspect the live DB rather than
  // the schema file): never manage the duel tables from drizzle-kit.
  tablesFilter: ["!duels", "!duel_participants", "!duel_secrets"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
