// Test (e): start dist/server.mjs over stdio and call the tools through the SDK client.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { root } from './helpers/bundle.mjs';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-crew-proc-'));
const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-crew-else-'));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist', 'server.mjs')],
  cwd,
  stderr: 'pipe',
});
const client = new Client({ name: 'process-test', version: '0.0.0' });
let connected = false;

after(async () => {
  if (connected) await client.close();
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(elsewhere, { recursive: true, force: true });
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError === true, body: JSON.parse(r.content[0].text) };
};

test('the server starts and lists the five tools with descriptions', async () => {
  assert.ok(fs.existsSync(path.join(root, 'dist', 'server.mjs')), 'dist/server.mjs is missing; run npm run build');
  await client.connect(transport);
  connected = true;
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(),
    ['compare_plans', 'describe_scenario', 'list_examples', 'run_scenario', 'what_if_add_servers']);
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 30, t.name);
    assert.equal(t.inputSchema.type, 'object');
  }
  const whatIf = tools.find((t) => t.name === 'what_if_add_servers');
  assert.deepEqual(Object.keys(whatIf.inputSchema.properties).sort(), ['addServers', 'scenario', 'stationId']);
});

test('list_examples and describe_scenario work over stdio', async () => {
  const list = await call('list_examples');
  assert.equal(list.isError, false);
  assert.equal(list.body.examples.length, 3);
  const d = await call('describe_scenario', { scenario: 'baseline' });
  assert.equal(d.body.attendeeCount, 120);
});

test('compare_plans over stdio gives -297.4 s, lower in 30 of 30', async () => {
  const r = await call('compare_plans', { baseline: 'baseline', candidate: 'plus-one-checkin' });
  assert.equal(r.isError, false);
  assert.equal(r.body.headline.text, 'Mean queue wait drops by 297.4 s.');
  assert.equal(r.body.headline.runsLower, 30);
});

test('what_if_add_servers over stdio gives the same headline', async () => {
  const r = await call('what_if_add_servers', { scenario: 'baseline', stationId: 'checkin', addServers: 1 });
  assert.equal(r.isError, false);
  assert.equal(r.body.headline.text, 'Mean queue wait drops by 297.4 s.');
  assert.equal(r.body.change.to, 2);
});

test('the SDK schema refuses addServers 20 and replication 30', async () => {
  const a = await client.callTool({ name: 'what_if_add_servers', arguments: { scenario: 'baseline', stationId: 'checkin', addServers: 20 } });
  assert.equal(a.isError, true);
  const b = await client.callTool({ name: 'run_scenario', arguments: { scenario: 'baseline', replication: 30 } });
  assert.equal(b.isError, true);
});

test('a path outside the working folder is refused over stdio', async () => {
  const file = path.join(elsewhere, 'plan.json');
  fs.copyFileSync(path.join(root, 'examples', 'baseline.json'), file);
  const r = await call('describe_scenario', { scenario: file });
  assert.equal(r.isError, true);
  assert.equal(r.body.error, 'path_refused');
});

test('no file was written in the working folder', () => {
  assert.deepEqual(fs.readdirSync(cwd), []);
});
