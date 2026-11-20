// Bundles the MCP server and the engine into one ES module, dist/server.mjs.
// Some packages inside the bundle call require, so the bundle gets a require function.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const banner = {
  js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
};

await build({
  entryPoints: [here('../mcp/server.ts')],
  outfile: here('../dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner,
  logLevel: 'warning',
});
process.stdout.write('built dist/server.mjs\n');
