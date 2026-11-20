// Tests (b), (c) and (d): the tool handlers, called in process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundle, readJson, root } from './helpers/bundle.mjs';

const lib = await bundle(`export { createTools } from './mcp/tools';`);
const examplesDir = path.join(root, 'examples');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-crew-work-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-crew-outside-'));
process.on('exit', () => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
const tools = lib.createTools({ workDir: work, examplesDir });

const round1 = (x) => Math.round(x * 10) / 10;

test('list_examples lists the three Harbor Hall scenarios', async () => {
  const r = await tools.list_examples();
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.examples.map((e) => e.id), ['baseline', 'plus-one-checkin', 'shorter-route']);
  for (const e of r.value.examples) {
    assert.ok(e.title.length > 0 && e.summary.length > 0);
  }
});

test('describe_scenario describes the baseline', async () => {
  const r = await tools.describe_scenario({ scenario: 'baseline' });
  assert.equal(r.ok, true);
  assert.equal(r.value.valid, true);
  assert.equal(r.value.attendeeCount, 120);
  assert.equal(r.value.baseSeed, 'harbor-hall-2026');
  assert.equal(r.value.horizonSeconds, 2400);
  assert.equal(r.value.stations.length, 2);
  assert.equal(r.value.stations[0].id, 'checkin');
  assert.equal(r.value.stations[0].servers, 1);
  assert.equal(r.value.stations[0].service, 'triangular 8/15/22 s');
  assert.equal(r.value.cohorts[0].count, 120);
});

test('describe_scenario returns the engine messages for an invalid scenario', async () => {
  const bad = readJson('examples', 'baseline.json');
  bad.stations[0].servers = 0;
  const r = await tools.describe_scenario({ scenario: JSON.stringify(bad) });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_scenario');
  assert.ok(r.issues.some((i) => i.message === 'Station "checkin": servers must be a whole number from 1 to 20; got 0.'));
});

test('run_scenario returns the metrics of one run with units, hash and model version', async () => {
  const expected = readJson('tests', 'fixtures', 'rehearsal-expected.json').scenarios.baseline;
  const r = await tools.run_scenario({ scenario: 'baseline', replication: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.value.scenarioHash, expected.scenarioHash);
  assert.equal(r.value.modelVersion, '0.1.0');
  const mean = r.value.metrics.find((m) => m.key === 'queueWait.mean');
  assert.equal(mean.label, 'Mean queue wait');
  assert.equal(mean.unit, 'ms');
  assert.equal(mean.value, expected.metrics.queueWait.mean.value);
  assert.equal(mean.text, '373.2 s');
  assert.equal(r.value.metrics.length, 11);
});

test('run_scenario refuses a replication outside 0 to 29', async () => {
  for (const replication of [-1, 30, 1.5]) {
    const r = await tools.run_scenario({ scenario: 'baseline', replication });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'bad_replication');
  }
});

// Test (b)
const compared = await tools.compare_plans({ baseline: 'baseline', candidate: 'plus-one-checkin' });

test('(b) compare_plans: mean queue wait change -297.4 s, lower in 30 of 30', () => {
  assert.equal(compared.ok, true, JSON.stringify(compared));
  const h = compared.value.headline;
  assert.equal(round1(h.meanChangeSeconds), -297.4);
  assert.equal(h.runsLower, 30);
  assert.equal(h.runs, 30);
  assert.equal(h.text, 'Mean queue wait drops by 297.4 s.');
  assert.equal(h.detail, 'Lower in 30 of 30 runs.');
  assert.equal(compared.value.runs, 30);
});

test('(b) compare_plans lists every metric with n, improved and worsened', () => {
  const metrics = compared.value.metrics;
  assert.equal(metrics.length, 11);
  const mean = metrics.find((m) => m.key === 'queueWait.mean');
  assert.equal(mean.n, 30);
  assert.equal(mean.improved, 30);
  assert.equal(mean.worsened, 0);
  assert.equal(mean.meanChangeText, '-297.4 s');
  const staff = metrics.find((m) => m.key === 'staffHours');
  assert.equal(staff.improved, null);
  assert.ok(compared.value.limits.includes('scenario results, not a forecast'));
});

test('(b) compare_plans reports a refusal for an invalid candidate', async () => {
  const bad = readJson('examples', 'plus-one-checkin.json');
  bad.stations[0].servers = 21;
  const r = await tools.compare_plans({ baseline: 'baseline', candidate: JSON.stringify(bad) });
  assert.equal(r.ok, false);
  assert.match(r.message, /servers must be a whole number from 1 to 20/);
});

// Test (c)
test('(c) what_if_add_servers on baseline, checkin, +1 equals the comparison of (b)', async () => {
  const r = await tools.what_if_add_servers({ scenario: 'baseline', stationId: 'checkin', addServers: 1 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.value.change, { stationId: 'checkin', stationLabel: 'Check-in desk', field: 'servers', from: 1, to: 2 });
  assert.deepEqual(r.value.headline, compared.value.headline);
  assert.deepEqual(r.value.metrics, compared.value.metrics);
  assert.equal(r.value.candidate.scenarioHash, compared.value.candidate.scenarioHash);
});

test('(c) what_if_add_servers refuses a count above 20 and an unknown station', async () => {
  let r = await tools.what_if_add_servers({ scenario: 'baseline', stationId: 'checkin', addServers: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad_add_servers');
  r = await tools.what_if_add_servers({ scenario: 'baseline', stationId: 'packs', addServers: 19 });
  assert.equal(r.ok, false);
  assert.match(r.message, /above the engine limit of 20/);
  r = await tools.what_if_add_servers({ scenario: 'baseline', stationId: 'lobby', addServers: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown_station');
  assert.match(r.message, /checkin/);
  assert.match(r.message, /packs/);
});

// Test (d)
test('(d) a path outside the working folder and the examples folder is refused', async () => {
  const file = path.join(outside, 'plan.json');
  fs.copyFileSync(path.join(examplesDir, 'baseline.json'), file);
  const r = await tools.describe_scenario({ scenario: file });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'path_refused');
  assert.match(r.message, /outside the working folder and the examples folder/);
  const dots = await tools.describe_scenario({ scenario: path.join(work, '..', path.basename(outside), 'plan.json') });
  assert.equal(dots.error, 'path_refused');
});

test('(d) a path inside the working folder and one inside the examples folder are read', async () => {
  fs.copyFileSync(path.join(examplesDir, 'baseline.json'), path.join(work, 'mine.json'));
  const a = await tools.describe_scenario({ scenario: path.join(work, 'mine.json') });
  assert.equal(a.ok, true);
  const b = await tools.describe_scenario({ scenario: path.join(examplesDir, 'shorter-route.json') });
  assert.equal(b.ok, true);
  const c = await tools.describe_scenario({ scenario: 'mine.json' });
  assert.equal(c.ok, true);
});

test('(d) a file larger than 2 MiB is refused without being read', async () => {
  const big = path.join(work, 'big.json');
  fs.writeFileSync(big, ' '.repeat(2 * 1024 * 1024 + 1));
  const r = await tools.describe_scenario({ scenario: big });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'file_too_large');
  assert.match(r.message, /larger than 2 MiB/);
  const exact = path.join(work, 'exact.json');
  fs.writeFileSync(exact, ' '.repeat(2 * 1024 * 1024));
  const e = await tools.describe_scenario({ scenario: exact });
  assert.notEqual(e.error, 'file_too_large');
});

test('(d) JSON text larger than 2 MiB is refused', async () => {
  const r = await tools.describe_scenario({ scenario: '{' + ' '.repeat(2 * 1024 * 1024) + '}' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'file_too_large');
});

test('(d) a missing file and a file that is not JSON get plain messages', async () => {
  const missing = await tools.describe_scenario({ scenario: 'nothing-here.json' });
  assert.equal(missing.error, 'file_not_found');
  fs.writeFileSync(path.join(work, 'notes.json'), 'secret words');
  const notJson = await tools.describe_scenario({ scenario: 'notes.json' });
  assert.equal(notJson.error, 'not_json');
  assert.ok(!notJson.message.includes('secret'));
  const wrongType = await tools.describe_scenario({ scenario: 'package.txt' });
  assert.equal(wrongType.error, 'path_refused');
});

test('(d) the source writes no file, uses no network and names no spreadsheet brand', () => {
  const dir = path.join(root, 'mcp');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 4);
  const forbidden = [
    /writeFile|appendFile|createWriteStream|mkdirSync|mkdir\(|unlink|rmSync|renameSync|copyFile|openSync|fs\.promises\.(write|append)/,
    /node:(http|https|net|dgram|tls|dns)\b|\bfetch\(|XMLHttpRequest|WebSocket/,
    new RegExp(['xl' + 'sx', 'ex' + 'cel', 'sheet' + 'js', 'google sheets', 'lib' + 're ?office'].join('|'), 'i'),
  ];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const re of forbidden) assert.ok(!re.test(text), `${f} matches ${re}`);
  }
});
