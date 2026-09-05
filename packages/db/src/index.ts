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