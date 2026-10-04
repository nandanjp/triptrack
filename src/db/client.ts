import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "../config.ts";
import * as schema from "./schema.ts";

type Sql = ReturnType<typeof postgres>;

let pool: Sql | undefined;
let database: PostgresJsDatabase<typeof schema> | undefined;

/**
 * Constructed on first use, not at import. postgres-js also connects lazily,
 * which together keep the health endpoints answering while the database is
 * unreachable — ARCHITECTURE.md requires that, because at one replica a pod
 * that will not boot during a database blip becomes a full outage.
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (database === undefined) {
    pool = postgres(databaseUrl(), { max: 10, idle_timeout: 20 });
    database = drizzle(pool, { schema });
  }
  return database;
}

export async function closeDb(): Promise<void> {
  await pool?.end({ timeout: 5 });
  pool = undefined;
  database = undefined;
}
