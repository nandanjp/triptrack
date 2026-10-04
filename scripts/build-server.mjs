import { build } from "esbuild";

// Compiled in rather than read at runtime, so the artifact describes itself.
const version = process.env.VERSION ?? "dev";

const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  minify: true,
  sourcemap: false,
  define: { "process.env.BUILD_VERSION": JSON.stringify(version) },
  // A bundled CJS dependency may still call require(); ESM output has none.
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
};

await build({ ...shared, entryPoints: ["src/index.ts"], outfile: "dist/server.js" });

// Separate entrypoint: the init container runs this and exits before the
// application container starts. See ADR-0006.
await build({ ...shared, entryPoints: ["src/db/migrate.ts"], outfile: "dist/migrate.js" });

console.log(`bundled dist/server.js and dist/migrate.js (version ${version})`);
