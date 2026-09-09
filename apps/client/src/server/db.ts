import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "db/schema";
import { env } from "@/env";

/**
 * Singleton postgres client — reused across hot-reloads in dev to avoid
 * exhausting the connection pool.
 */
const globalForDb = globalThis as unknown as {
  client: postgres.Sql | undefined;
};

const client =
  globalForDb.client ??
  postgres(env.DATABASE_URL, {
    prepare: false, // required for Supabase transaction mode pooler
  });

if (env.NODE_ENV !== "production") {
  globalForDb.client = client;
}

export const db = drizzle(client, { schema });
