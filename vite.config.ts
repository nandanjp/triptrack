import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Matches the tsconfig path, so components import as @/ui/button.
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
    },
  },
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
