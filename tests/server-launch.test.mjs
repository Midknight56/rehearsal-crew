// Starts the server exactly as app.json declares it, from an unrelated working folder.
// KIROCREW_HOME points at a temporary Crew home that holds apps/rehearsal-crew/dist/server.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { root, readJson } from './helpers/bundle.mjs';

const declared = readJson('app.json').mcpServers['rehearsal-engine'];
const made = [];
const tempDir = (label) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rehearsal-crew-${label}-`));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

// The declared command is "node"; the test runs the same Node that runs the tests.
const command = declared.command === 'node' ? process.execPath : declared.command;

test('the entry starts from an unrelated folder and finds the server in the Crew home', async () => {
  assert.ok(fs.existsSync(path.join(root, 'dist', 'server.mjs')), 'dist/server.mjs is missing; run npm run build');
  const crewHome = tempDir('home');
  const appDir = path.join(crewHome, 'apps', 'rehearsal-crew');
  fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(root, 'dist', 'server.mjs'), path.join(appDir, 'dist', 'server.mjs'));
  fs.cpSync(path.join(root, 'examples'), path.join(appDir, 'examples'), { recursive: true });

  const client = new Client({ name: 'launch-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command,
    args: declared.args,
    cwd: tempDir('cwd'),
    env: { KIROCREW_HOME: crewHome },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'list_examples', arguments: {} });
    assert.notEqual(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).examples.length, 3);
  } finally {
    await client.close();
  }
});

test('a missing built file gives exit 1, one stderr line and empty stdout', () => {
  const crewHome = tempDir('empty');
  const run = spawnSync(command, declared.args, {
    cwd: tempDir('cwd'),
    env: { ...process.env, KIROCREW_HOME: crewHome },
    encoding: 'utf8',
  });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(run.stdout, '');
  const lines = run.stderr.split('\n').filter((line) => line !== '');
  assert.equal(lines.length, 1, run.stderr);
  assert.ok(lines[0].includes(path.join(crewHome, 'apps', 'rehearsal-crew', 'dist', 'server.mjs')), lines[0]);
  assert.match(lines[0], /npm install/);
  assert.match(lines[0], /npm run build/);
});
