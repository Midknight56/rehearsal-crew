// Copies the engine source from a Rehearsal folder into this repository and rewrites engine/SOURCE.md.
// Usage: node tools/sync-engine.mjs <rehearsal folder> [--target <folder>] [--commit <sha>]
// The files are copied byte for byte. The commit is read with git unless --commit gives it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = {
  domain: ['hash', 'limits', 'scenario', 'validate'],
  simulation: ['arrivals', 'heap', 'line', 'metrics', 'random', 'sampling', 'scheduler', 'simulate', 'trace', 'version'],
  spatial: ['grid', 'path-cache'],
  comparison: ['comparison', 'diff', 'format', 'labels', 'metric-keys', 'paired', 'percentiles', 'population',
    'replay-contract', 'replications', 'runner', 'summary'],
  // client.ts imports protocol.ts, so both are copied.
  workers: ['client', 'protocol'],
};
const EXAMPLES = ['baseline', 'plus-one-checkin', 'shorter-route'];

/** Pairs of [path under the Rehearsal folder, path under this repository]. */
export function copyList() {
  const list = [];
  for (const [dir, names] of Object.entries(SRC)) {
    for (const name of names) list.push([`src/${dir}/${name}.ts`, `engine/src/${dir}/${name}.ts`]);
  }
  for (const name of EXAMPLES) list.push([`public/examples/harbor-hall/${name}.json`, `examples/${name}.json`]);
  list.push(['LICENSE', 'engine/LICENSE']);
  return list;
}

function option(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function main(argv) {
  const positional = argv.filter((arg, i) => !arg.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  const from = positional[0];
  if (!from) {
    process.stderr.write('Usage: node tools/sync-engine.mjs <rehearsal folder> [--target <folder>] [--commit <sha>]\n');
    return 1;
  }
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const target = path.resolve(option(argv, '--target') ?? here);
  const source = path.resolve(from);

  let commit = option(argv, '--commit');
  if (commit === undefined) {
    const git = spawnSync('git', ['-C', source, '-c', 'safe.directory=*', 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    commit = git.status === 0 ? git.stdout.trim() : '';
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    process.stderr.write('Could not read the commit of the Rehearsal folder. Give --commit with 40 hex characters.\n');
    return 1;
  }

  const rows = [];
  for (const [fromRel, toRel] of copyList()) {
    const fromFile = path.join(source, fromRel);
    if (!fs.existsSync(fromFile)) {
      process.stderr.write(`Missing in the Rehearsal folder: ${fromRel}\n`);
      return 1;
    }
    const bytes = fs.readFileSync(fromFile);
    const toFile = path.join(target, toRel);
    fs.mkdirSync(path.dirname(toFile), { recursive: true });
    fs.writeFileSync(toFile, bytes);
    rows.push([crypto.createHash('sha256').update(bytes).digest('hex'), toRel]);
  }

  const lines = [
    '# Engine source',
    '',
    'The files under `engine/src` and `examples/` are copied unchanged from the Rehearsal repository, https://github.com/Midknight56/rehearsal.',
    'Rehearsal is MIT licensed. Its notice is in `engine/LICENSE`.',
    'Run `node tools/sync-engine.mjs <REHEARSAL_REPO>` to copy them again and rewrite this file.',
    '',
    `Commit: ${commit}`,
    '',
    'sha256 of each copied file, as copied:',
    '',
    ...rows.map(([sha, rel]) => `${sha}  ${rel}`),
    '',
  ];
  const sourceFile = path.join(target, 'engine', 'SOURCE.md');
  fs.writeFileSync(sourceFile, lines.join('\n'));
  process.stdout.write(`copied ${rows.length} files from commit ${commit}\n`);
  return 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
