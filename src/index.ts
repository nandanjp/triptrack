import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { assertRequiredConfig, BUILD_VERSION, PORT } from "./config.ts";
import { closeDb } from "./db/client.ts";
import { installShutdownHandlers } from "./shutdown.ts";

// Before listening: missing configuration is an operator error and should be
// loud. Connectivity is deliberately not checked here.
assertRequiredConfig();

// Present in the image, absent when running from source.
const staticRoot = process.env.NODE_ENV === "production" ? "./dist/public" : undefined;

const server = serve({ fetch: createApp({ staticRoot }).fetch, port: PORT }, (info) => {
  console.log(`triptrack ${BUILD_VERSION} listening on :${info.port}`);
});

installShutdownHandlers(server, { cleanup: closeDb });
