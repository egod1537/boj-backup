import { mkdir } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const outdir = path.resolve("dist", "viewer", "assets");
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.resolve("src", "viewer", "dashboard-client.tsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(outdir, "dashboard-client.js"),
  jsx: "automatic",
  sourcemap: false,
  logLevel: "info",
});
