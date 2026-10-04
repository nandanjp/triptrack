import { build } from "esbuild";

// Compiled in rather than read at runtime, so the artifact describes itself.
const version = process.env.VERSION ?? "dev";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/server.js",
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
});

console.log(`bundled dist/server.js (version ${version})`);
