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
