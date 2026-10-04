import { DRAIN_DELAY_MS, SHUTDOWN_TIMEOUT_MS } from "./config.ts";
import { beginDraining } from "./readiness.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Only what draining needs. The connection helpers are optional because
 * @hono/node-server's ServerType also covers HTTP/2 servers, which lack them.
 */
type DrainableServer = {
  close(callback?: (err?: Error) => void): unknown;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
};

/**
 * maxUnavailable: 0 only means zero dropped requests if the process actually
 * drains. On SIGTERM: fail readiness, keep serving while the EndpointSlice
 * removal propagates to kube-proxy and Traefik, then stop accepting and wait a
 * bounded time for in-flight requests.
 *
 * Handled in-process because the distroless image has no shell, so a preStop
 * `exec: sleep` hook is not available.
 */
export function installShutdownHandlers(
  server: DrainableServer,
  log: (message: string) => void = console.log,
): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    log(`${signal} received: failing readiness, draining for ${DRAIN_DELAY_MS}ms`);
    beginDraining();
    await sleep(DRAIN_DELAY_MS);

    log("drain window elapsed: closing listener");
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    // Keep-alive sockets with no request in flight would otherwise hold the
    // listener open for the whole timeout.
    server.closeIdleConnections?.();

    const timedOut = await Promise.race([
      closed.then(() => false),
      sleep(SHUTDOWN_TIMEOUT_MS).then(() => true),
    ]);

    if (timedOut) {
      log(`in-flight requests exceeded ${SHUTDOWN_TIMEOUT_MS}ms: forcing close`);
      server.closeAllConnections?.();
    }

    log("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
