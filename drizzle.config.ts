import { defineConfig } from "drizzle-kit";

// Generation is offline and needs no database; `drizzle-kit generate` reads
// the schema only. The URL matters just for `push` and `studio`.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
