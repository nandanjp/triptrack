import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseUrl, migrationsDir } from "../config.ts";

/**
 * Applied by an init container before the application container starts, so a
 * failed migration fails the rollout instead of serving against a schema the
 * code does not expect. See ADR-0006.
 *
 * `max: 1` because a migration runner has no use for a pool.
 */
const ATTEMPTS = 10;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * On a cold cluster the Postgres StatefulSet and this Deployment start
 * together, so the first attempts will find nothing listening. Kubernetes
 * would retry the whole init container, but that reads as a crash-loop in
 * `kubectl get pods` and buries the real error if there is one. Retrying in
 * here turns an alarming restart cycle into a short, explicit wait.
 *
 * Observed while verifying: the official postgres image answers pg_isready on
 * its unix socket while initdb's temporary server is still running, before the
 * real TCP listener and the application role exist. A readiness probe is
 * therefore not sufficient on its own.
 */
async function connectWithRetry(): Promise<ReturnType<typeof postgres>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const sql = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
    try {
      await sql`select 1`;
      return sql;
    } catch (error: unknown) {
      lastError = error;
      await sql.end({ timeout: 5 }).catch(() => {});

      if (attempt === ATTEMPTS) break;

      const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      console.log(
        `database not ready (attempt ${attempt}/${ATTEMPTS}), retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw new Error(
    `database unreachable after ${ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

const sql = await connectWithRetry();

try {
  await migrate(drizzle(sql), { migrationsFolder: migrationsDir() });
  console.log("migrations applied");
} finally {
  await sql.end({ timeout: 5 });
}
