import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { BUILD_VERSION } from "./config.ts";
import { isReady } from "./readiness.ts";

export type AppOptions = {
  /** Where the built SPA lives, relative to cwd. Omitted in tests and dev. */
  staticRoot?: string;
};

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  // The pipeline's acceptance test: proves which build is actually running.
  app.get("/health", (c) => c.json({ status: "ok", version: BUILD_VERSION }));

  // Answers 200 even while draining. A draining pod is alive, and restarting
  // it would kill the in-flight requests shutdown is waiting on.
  app.get("/health/live", (c) => c.json({ status: "ok" }));

  app.get("/health/ready", (c) =>
    isReady() ? c.json({ status: "ready" }) : c.json({ status: "draining" }, 503),
  );

  if (options.staticRoot !== undefined) {
    const root = options.staticRoot;
    app.use("/*", serveStatic({ root }));
    // Client-side routing: anything not matched above is the SPA's problem.
    app.get("*", serveStatic({ path: `${root}/index.html` }));
  }

  return app;
}
