// Test (f): tools/check-manifest.mjs. Written before the checker.
// Each case builds a valid repository in a temporary folder, applies one edit, and runs the checker on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const script = path.join(root, 'tools', 'check-manifest.mjs');

// Loaded inside each case, so a missing module fails each case alone.
const load = () => import('../tools/check-manifest.mjs');

const SKILL = [
  '---',
  'name: rehearsal-whatif',
  'description: How to answer a what if question.',
  'triggers: [what if, rehearsal]',
  'always: false',
  '---',
  '',
  '# Rehearsal what if',
  '',
  'Body text.',
  '',
].join('\n');

// A short inline script of the same shape as the one in app.json.
const SCRIPT = "const path=require('path');const f=path.join(process.env.KIROCREW_HOME,'apps','rehearsal-crew','dist','server.mjs');import(f)";

const manifest = () => ({
  name: 'rehearsal-crew',
  version: '0.1.0',
  displayName: 'Rehearsal what if',
  description: 'A Crew agent that answers what if questions with paired runs.',
  author: 'Someone',
  license: 'MIT',
  minKiroCrewVersion: '0.12.2',
  tags: ['simulation', 'mcp'],
  agents: ['agents/rehearsal-whatif.json'],
  skills: ['skills/rehearsal-whatif'],
  mcpServers: { 'rehearsal-engine': { command: 'node', args: ['-e', SCRIPT] } },
  dependencies: { commands: ['node'] },
});

const agent = () => ({
  name: 'rehearsal-whatif',
  model: 'auto',
  description: 'Answers what if questions from tool results.',
  prompt: 'Answer only from tool results. These are scenario results, not a forecast. Recommend nothing.',
  tools: ['@rehearsal-crew:rehearsal-engine'],
});

/** edit receives { manifest, agent, skill, raw, remove, extra }. raw: file name to replacement text. */
function makeRepo(t, edit = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-crew-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ctx = { manifest: manifest(), agent: agent(), skill: SKILL, raw: {}, remove: [], extra: {} };
  edit(ctx);
  const files = {
    'app.json': JSON.stringify(ctx.manifest, null, 2) + '\n',
    'agents/rehearsal-whatif.json': JSON.stringify(ctx.agent, null, 2) + '\n',
    'skills/rehearsal-whatif/SKILL.md': ctx.skill,
    'dist/server.mjs': '// built\n',
    'README.md': '# Rehearsal\n\nPlain text.\n',
    LICENSE: 'MIT License\n',
    ...ctx.extra,
    ...ctx.raw,
  };
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  for (const name of ctx.remove) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  return dir;
}

async function problems(t, edit) {
  const { checkRepo } = await load();
  return checkRepo(makeRepo(t, edit));
}
const has = (list, rule, part = '') => list.some((p) => p.rule === rule && p.message.includes(part));

test('a valid repository has no problems', async (t) => {
  assert.deepEqual(await problems(t), []);
});

for (const key of ['name', 'version', 'displayName', 'description']) {
  test(`required field ${key} missing`, async (t) => {
    const list = await problems(t, (c) => { delete c.manifest[key]; });
    assert.ok(has(list, 'required-fields', key));
  });
}

test('name must be kebab case', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.manifest.name = 'Rehearsal_Crew'; }), 'name'));
});

test('version must be X.Y.Z', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.manifest.version = '0.1'; }), 'semver'));
});

test('version must be 0.1.0', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.manifest.version = '0.2.0'; }), 'version-pinned'));
});

test('recommended fields: author, license MIT, minKiroCrewVersion 0.12.2, tags', async (t) => {
  assert.ok(has(await problems(t, (c) => { delete c.manifest.author; }), 'recommended-fields', 'author'));
  assert.ok(has(await problems(t, (c) => { c.manifest.license = 'GPL'; }), 'recommended-fields', 'license'));
  assert.ok(has(await problems(t, (c) => { c.manifest.minKiroCrewVersion = '0.11.0'; }), 'recommended-fields', 'minKiroCrewVersion'));
  assert.ok(has(await problems(t, (c) => { c.manifest.tags = []; }), 'recommended-fields', 'tags'));
});

test('a key that is not on the allowed list is flagged', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.manifest.surprise = 1; }), 'allowed-keys', 'surprise'));
});

test('a cron job is flagged', async (t) => {
  const list = await problems(t, (c) => { c.manifest.crons = [{ name: 'x', every: 60, message: 'm' }]; });
  assert.ok(has(list, 'no-cron'));
});

for (const bad of ['/etc/agents/a.json', 'C' + ':/agents/a.json', '../agents/a.json', 'agents/../../a.json']) {
  test(`agent path ${bad} must be relative and inside`, async (t) => {
    assert.ok(has(await problems(t, (c) => { c.manifest.agents = [bad]; }), 'path-inside'));
  });
}

test('an agent file that is missing is flagged', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.remove.push('agents/rehearsal-whatif.json'); }), 'path-exists'));
});

test('a skill folder without SKILL.md is flagged', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.remove.push('skills/rehearsal-whatif/SKILL.md'); }), 'path-exists'));
});

test('the built server file under the app root must exist', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.remove.push('dist/server.mjs'); }), 'path-exists', 'dist/server.mjs'));
});

test('mcpServers entry needs command node and args', async (t) => {
  assert.ok(has(await problems(t, (c) => { delete c.manifest.mcpServers['rehearsal-engine'].command; }), 'mcp-server', 'command'));
  assert.ok(has(await problems(t, (c) => { c.manifest.mcpServers['rehearsal-engine'].args = []; }), 'mcp-server', 'args'));
});

test('the server args must be -e and one inline script, not a relative file path', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.manifest.mcpServers['rehearsal-engine'].args = ['dist/server.mjs']; }), 'mcp-server', '-e'));
  assert.ok(has(await problems(t, (c) => { c.manifest.mcpServers['rehearsal-engine'].args = ['-e']; }), 'mcp-server', '-e'));
  assert.ok(has(await problems(t, (c) => { c.manifest.mcpServers['rehearsal-engine'].args = ['-e', SCRIPT, 'extra']; }), 'mcp-server', '-e'));
});

test('the inline script must mention apps, rehearsal-crew, dist and server.mjs', async (t) => {
  for (const word of ['apps', 'rehearsal-crew', 'dist', 'server.mjs']) {
    const list = await problems(t, (c) => {
      c.manifest.mcpServers['rehearsal-engine'].args = ['-e', SCRIPT.replace(`'${word}'`, `'other'`)];
    });
    assert.ok(has(list, 'mcp-server', word), word);
  }
});
test('dependencies.commands must hold node', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.manifest.dependencies = { commands: ['jq'] }; }), 'dependencies'));
});

test('agent fields are required and model is auto', async (t) => {
  for (const key of ['name', 'model', 'description', 'prompt', 'tools']) {
    assert.ok(has(await problems(t, (c) => { delete c.agent[key]; }), 'required-fields', key), key);
  }
  assert.ok(has(await problems(t, (c) => { c.agent.model = 'other'; }), 'agent-model'));
});

test('agent tools must be @<app>:<server> naming a declared server', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.agent.tools = ['@rehearsal-engine']; }), 'agent-tools'));
  assert.ok(has(await problems(t, (c) => { c.agent.tools = ['@rehearsal-crew:nope']; }), 'agent-tools', 'nope'));
  assert.ok(has(await problems(t, (c) => { c.agent.tools = ['@rehearsal-crew:rehearsal-engine', 'fs_write']; }), 'agent-tools', 'fs_write'));
});

test('agent prompt must carry the not a forecast sentence', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.agent.prompt = 'Answer only from tool results.'; }), 'agent-prompt'));
});

test('skill front matter is checked', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.skill = '# no front matter\n'; }), 'skill-front-matter'));
  assert.ok(has(await problems(t, (c) => { c.skill = SKILL.replace('always: false\n', ''); }), 'skill-front-matter', 'always'));
  assert.ok(has(await problems(t, (c) => { c.skill = SKILL.replace('always: false', 'always: true'); }), 'skill-front-matter', 'false'));
  assert.ok(has(await problems(t, (c) => { c.skill = SKILL.replace('name: rehearsal-whatif', 'name: other'); }), 'skill-front-matter', 'folder'));
});

test('placeholder text is flagged', async (t) => {
  for (const word of ['TODO', 'TBD', 'FIXME', 'lorem ipsum', '<your name>']) {
    assert.ok(has(await problems(t, (c) => { c.raw['README.md'] = `# Rehearsal\n\n${word} later\n`; }), 'placeholder'), word);
  }
});

test('secret patterns are flagged', async (t) => {
  const samples = {
    token: 'gh' + 'p_' + 'a'.repeat(36),
    awsKey: 'AK' + 'IA' + 'A'.repeat(16),
    apiKey: 'sk' + '-' + 'b'.repeat(24),
    privateKey: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
    userFolder: 'C' + ':/Us' + 'ers/someone/work',
    email: 'someone' + '@' + 'example.com',
    drivePath: 'D' + ':/work/thing',
  };
  for (const [label, sample] of Object.entries(samples)) {
    const list = await problems(t, (c) => { c.extra['notes.md'] = `text ${sample} text\n`; });
    assert.ok(has(list, 'secret'), label);
  }
});

test('a spreadsheet brand is flagged in text the app ships', async (t) => {
  const brand = 'ex' + 'cel';
  assert.ok(has(await problems(t, (c) => { c.agent.description = `Reads ${brand} files.`; }), 'brand'));
});

test('dashes between words are flagged in descriptions and the README', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.manifest.description = 'Queues - and staffing'; }), 'dashes'));
  assert.ok(has(await problems(t, (c) => { c.raw['README.md'] = '# R\n\nQueues \u2014 and staffing\n'; }), 'dashes'));
});

test('a byte order mark and a carriage return are flagged', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.raw['README.md'] = '\uFEFF# R\n'; }), 'encoding', 'byte order mark'));
  assert.ok(has(await problems(t, (c) => { c.raw['README.md'] = '# R\r\n'; }), 'encoding', 'carriage return'));
});

test('invalid JSON is reported, not thrown', async (t) => {
  assert.ok(has(await problems(t, (c) => { c.raw['app.json'] = '{ nope'; }), 'json'));
});

test('command line: ok and exit 0 on a valid folder, exit 1 and a line per problem otherwise', (t) => {
  const good = spawnSync(process.execPath, [script, makeRepo(t)], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(good.stdout.trim(), 'ok');
  const bad = spawnSync(process.execPath, [script, makeRepo(t, (c) => { c.manifest.name = 'Bad_Name'; })], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^app\.json: name: /m);
});

test('the real repository passes', () => {
  const run = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout.trim(), 'ok');
});
