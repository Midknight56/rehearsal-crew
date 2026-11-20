// Bundles TypeScript source with esbuild into a temporary folder and imports it.
// The temporary folder is removed when the process ends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const BANNER = "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);";
const made = [];
process.on('exit', () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** @param {string} contents source of an entry file; relative imports resolve from the repository root */
export async function bundle(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-crew-test-'));
  made.push(dir);
  const outfile = path.join(dir, 'bundle.mjs');
  await build({
    stdin: { contents, resolveDir: root, loader: 'ts', sourcefile: 'entry.ts' },
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20', banner: { js: BANNER }, logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

export function readJson(...parts) {
  return JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
}
