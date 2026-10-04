/**
 * Shutdown budget. `DRAIN_DELAY_MS + SHUTDOWN_TIMEOUT_MS` must stay under the
 * chart's terminationGracePeriodSeconds, or the kubelet kills the process
 * mid-request. test/shutdown-budget.test.ts asserts that against the chart so
 * the two cannot drift.
 */
export const DRAIN_DELAY_MS = 5_000;
export const SHUTDOWN_TIMEOUT_MS = 20_000;

export const PORT = Number(process.env.PORT ?? 8080);

/** Replaced at bundle time by scripts/build-server.mjs, so the artifact is self-describing. */
export const BUILD_VERSION = process.env.BUILD_VERSION ?? "dev";

/** Cloudflare terminates TLS, so this cannot be derived from the request. */
export const publicScheme = (): string => process.env.PUBLIC_SCHEME ?? "http";

/** Where the generated SQL lives in the image. */
export const migrationsDir = (): string => process.env.MIGRATIONS_DIR ?? "./drizzle";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required but was not set`);
  }
  return value;
}

/**
 * Read at point of use rather than at import, so code that needs no database —
 * the health endpoints, and their tests — does not require the environment.
 */
export const databaseUrl = (): string => requireEnv("DATABASE_URL");

/**
 * Signs session cookies. Rotating it invalidates every live session, and
 * because env-injected secrets are read once at process start, it needs a
 * rollout restart to take effect. Both are recorded in ADR-0005.
 */
export const sessionSecret = (): string => requireEnv("SESSION_SECRET");

/**
 * Fails loudly at boot on missing configuration, which is an operator error.
 * A database that is merely *unreachable* must not stop the pod serving its
 * health endpoints, so this checks presence and never connectivity.
 */
export function assertRequiredConfig(): void {
  databaseUrl();
  sessionSecret();
}
