import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to initialize the database client");
}

const client = postgres(databaseUrl, {
  prepare: false,
});

export const db = drizzle(client, { schema });

export { client };
export * from "./schema.js";

// Re-export common Drizzle query helpers so consumers (server, client) can use
// them without taking a direct dependency on drizzle-orm — the db package is
// the single surface for all database concerns.
export { and, eq, sql, desc, asc, inArray } from "drizzle-orm";