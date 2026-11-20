// Test (a): the vendored engine.
// Expected values: tests/fixtures/rehearsal-expected.json, a byte copy of public/examples/harbor-hall/expected.json
// in Rehearsal. Rehearsal's own tests/model/expected-snapshot.test.ts compares its engine to that file for replication 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { bundle, readJson, root } from './helpers/bundle.mjs';

const ENTRY = `
export { simulate } from './engine/src/simulation/simulate';
export { validateScenario } from './engine/src/domain/validate';
export { scenarioHash } from './engine/src/domain/hash';
`;

async function runBaseline(engine, replication) {
  const checked = engine.validateScenario(readJson('examples', 'baseline.json'));
  assert.equal(checked.ok, true);
  const hash = await engine.scenarioHash(checked.scenario);
  return engine.simulate(checked.scenario, replication, { trace: false, scenarioHash: hash });
}

test('Harbor Hall baseline replication 0 equals the Rehearsal snapshot', async () => {
  const engine = await bundle(ENTRY);
  const result = await runBaseline(engine, 0);
  const expected = readJson('tests', 'fixtures', 'rehearsal-expected.json').scenarios.baseline;
  const actual = JSON.parse(JSON.stringify({
    scenarioHash: result.scenarioHash, completion: result.completion, unfinished: result.unfinished, metrics: result.metrics,
  }));
  assert.deepEqual(actual, expected);
});

test('a rerun gives byte identical output', async () => {
  const engine = await bundle(ENTRY);
  const first = JSON.stringify(await runBaseline(engine, 0));
  const second = JSON.stringify(await runBaseline(engine, 0));
  assert.equal(first, second);
});

test('every copied file matches its sha256 in engine/SOURCE.md, and a commit is named', () => {
  const text = fs.readFileSync(path.join(root, 'engine', 'SOURCE.md'), 'utf8');
  assert.match(text, /^Commit: [0-9a-f]{40}$/m);
  const rows = [...text.matchAll(/^([0-9a-f]{64})  (\S+)$/gm)];
  assert.ok(rows.length >= 30, `expected at least 30 listed files, found ${rows.length}`);
  for (const [, sha, file] of rows) {
    const bytes = fs.readFileSync(path.join(root, file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha, file);
  }
});

test('engine/LICENSE keeps the MIT notice', () => {
  const text = fs.readFileSync(path.join(root, 'engine', 'LICENSE'), 'utf8');
  assert.match(text, /^MIT License/);
  assert.match(text, /Copyright \(c\) 2026/);
});

test('sync-engine copies the paths again and rewrites SOURCE.md', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-crew-sync-'));
  try {
    const fakeRehearsal = path.join(tmp, 'rehearsal');
    const target = path.join(tmp, 'target');
    fs.cpSync(path.join(root, 'engine', 'src'), path.join(fakeRehearsal, 'src'), { recursive: true });
    fs.cpSync(path.join(root, 'examples'), path.join(fakeRehearsal, 'public', 'examples', 'harbor-hall'), { recursive: true });
    fs.copyFileSync(path.join(root, 'engine', 'LICENSE'), path.join(fakeRehearsal, 'LICENSE'));
    fs.mkdirSync(target);
    const commit = 'a'.repeat(40);
    const run = spawnSync(process.execPath, [
      path.join(root, 'tools', 'sync-engine.mjs'), fakeRehearsal, '--target', target, '--commit', commit,
    ], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const source = fs.readFileSync(path.join(target, 'engine', 'SOURCE.md'), 'utf8');
    assert.ok(source.includes(`Commit: ${commit}`));
    const original = fs.readFileSync(path.join(root, 'engine', 'src', 'simulation', 'simulate.ts'));
    assert.deepEqual(fs.readFileSync(path.join(target, 'engine', 'src', 'simulation', 'simulate.ts')), original);
    assert.ok(fs.existsSync(path.join(target, 'examples', 'baseline.json')));
    assert.ok(fs.existsSync(path.join(target, 'engine', 'LICENSE')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
