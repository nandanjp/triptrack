import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    // Served by Hono from the same container; see src/index.ts.
    outDir: "../dist/public",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:web` talks to `npm run dev`.
    proxy: { "/health": "http://localhost:8080", "/api": "http://localhost:8080" },
  },
});
