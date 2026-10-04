import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { BUILD_VERSION, PORT } from "./config.ts";
import { installShutdownHandlers } from "./shutdown.ts";

// Present in the image, absent when running from source.
const staticRoot = process.env.NODE_ENV === "production" ? "./dist/public" : undefined;

const server = serve({ fetch: createApp({ staticRoot }).fetch, port: PORT }, (info) => {
  console.log(`triptrack ${BUILD_VERSION} listening on :${info.port}`);
});

installShutdownHandlers(server);
