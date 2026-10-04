import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { authRoutes } from "./auth/routes.ts";
import { bookingRoutes } from "./bookings/routes.ts";
import { itineraryRoutes } from "./itinerary/routes.ts";
import { inviteRoutes } from "./trips/invite-routes.ts";
import { tripRoutes } from "./trips/routes.ts";
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

  app.route("/api/auth", authRoutes);
  app.route("/api/trips", tripRoutes);
  app.route("/api/trips", itineraryRoutes);
  app.route("/api/trips", bookingRoutes);
  // Mounted outside /api/trips because the preview must work when signed out.
  app.route("/api/invites", inviteRoutes);

  // Ahead of the static handler, so an unknown API path answers as an API
  // rather than being handed the SPA's index.html with a 200.
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  if (options.staticRoot !== undefined) {
    const root = options.staticRoot;
    app.use("/*", serveStatic({ root }));
    // Client-side routing: anything not matched above is the SPA's problem.
    app.get("*", serveStatic({ path: `${root}/index.html` }));
  }

  return app;
}
