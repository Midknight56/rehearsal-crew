// Checks the app files against the Crew manifest page and the repository rules.
// Plain Node, no dependency. It reads files and writes nothing.
// Usage: node tools/check-manifest.mjs [root]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED = {
  manifest: ['name', 'version', 'displayName', 'description', 'author', 'license', 'minKiroCrewVersion', 'tags',
    'agents', 'skills', 'mcpServers', 'dependencies'],
  agent: ['name', 'model', 'description', 'prompt', 'tools'],
  server: ['command', 'args', 'url', 'env'],
  dependencies: ['commands', 'optionalCommands'],
  frontMatter: ['name', 'description', 'triggers', 'always'],
};

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const TOOL_RE = /^@([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

const SECRET_PATTERNS = [
  ['a GitHub token', /ghp_[A-Za-z0-9]{36}/],
  ['an AWS access key id', /AKIA[0-9A-Z]{16}/],
  ['an API key', /sk-[A-Za-z0-9]{20,}/],
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a Windows user folder', /[A-Za-z]:[\\/]Users[\\/]/i],
  ['a Unix home folder', /(?<![A-Za-z0-9._-])\/(?:Users|home)\/[A-Za-z0-9._-]+/],
  ['a drive path', /(?<![A-Za-z0-9])[A-Za-z]:[\\/][A-Za-z]/],
  ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
];
const PLACEHOLDER_RE = /\b(?:TODO|TBD|FIXME|XXX)\b|lorem ipsum|<your[ -][^>]*>|<owner[^>]*>|<placeholder>/i;
// The brand words are joined from pieces so that this file does not hold them whole.
const BRAND_RE = new RegExp(['xl' + 'sx', 'ex' + 'cel', 'sheet' + 'js', 'google sh' + 'eets'].join('|'), 'i');
const DASH_RE = /\S +[-\u2013\u2014]+ +\S|[\u2013\u2014]/;

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function listFiles(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

function frontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const fields = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) return null;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return fields;
}

/** Lines of prose: fenced code and table separator rows are left out. */
function proseLines(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*\|[\s|:-]+\|?\s*$/.test(line)) continue;
    out.push(line);
  }
  return out;
}

/** @returns {{ file: string, rule: string, message: string }[]} */
export function checkRepo(root) {
  const problems = [];
  const add = (file, rule, message) => problems.push({ file, rule, message });
  const rootFull = path.resolve(root);
  const shipped = new Map(); // relative file name -> text, for the prose rules

  const checkKeys = (file, label, object, allowed) => {
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) add(file, 'allowed-keys', `${label} has the key "${key}", which is not on the allowed list`);
    }
  };

  const parseJson = (relative) => {
    const text = readText(path.join(rootFull, relative));
    if (text === null) {
      add(relative, 'json', 'the file cannot be read');
      return undefined;
    }
    shipped.set(relative, text);
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
      add(relative, 'json', `the file is not valid JSON: ${error.message}`);
      return undefined;
    }
  };

  const manifestFile = 'app.json';
  const manifest = parseJson(manifestFile);

  if (manifest !== undefined && !isPlainObject(manifest)) {
    add(manifestFile, 'json', 'the top level is not an object');
  } else if (manifest !== undefined) {
    checkKeys(manifestFile, 'the manifest', manifest, ALLOWED.manifest);
    if ('crons' in manifest) add(manifestFile, 'no-cron', 'this app has no cron job; remove "crons"');

    for (const key of ['name', 'version', 'displayName', 'description']) {
      if (!isText(manifest[key])) add(manifestFile, 'required-fields', `"${key}" must be a non-empty string`);
    }
    if (isText(manifest.name) && !NAME_RE.test(manifest.name)) add(manifestFile, 'name', `"${manifest.name}" is not kebab-case`);
    if (isText(manifest.version)) {
      if (!SEMVER_RE.test(manifest.version)) add(manifestFile, 'semver', `"${manifest.version}" is not X.Y.Z`);
      else if (manifest.version !== '0.1.0') add(manifestFile, 'version-pinned', `"${manifest.version}" is not 0.1.0`);
    }
    if (!isText(manifest.author)) add(manifestFile, 'recommended-fields', '"author" must be a non-empty string');
    if (manifest.license !== 'MIT') add(manifestFile, 'recommended-fields', '"license" must be "MIT"');
    if (manifest.minKiroCrewVersion !== '0.12.2') add(manifestFile, 'recommended-fields', '"minKiroCrewVersion" must be "0.12.2"');
    if (!Array.isArray(manifest.tags) || manifest.tags.length === 0 || !manifest.tags.every(isText)) {
      add(manifestFile, 'recommended-fields', '"tags" must be a non-empty list of text');
    }

    const insidePath = (key, entry) => {
      const parts = entry.split(/[\\/]/);
      const absolute = path.isAbsolute(entry) || /^[A-Za-z]:/.test(entry) || entry.startsWith('/') || entry.startsWith('\\');
      const resolved = path.resolve(rootFull, entry);
      const relation = path.relative(rootFull, resolved);
      const inside = !absolute && !parts.includes('..') && relation !== '' && !relation.startsWith('..') && !path.isAbsolute(relation);
      if (!inside) add(manifestFile, 'path-inside', `"${entry}" in "${key}" must be relative and stay inside the repository`);
      return inside ? resolved : null;
    };

    const eachPath = (key, onInside) => {
      if (manifest[key] === undefined) return;
      if (!Array.isArray(manifest[key])) {
        add(manifestFile, 'path-inside', `"${key}" must be a list of paths`);
        return;
      }
      for (const entry of manifest[key]) {
        if (!isText(entry)) {
          add(manifestFile, 'path-inside', `"${key}" holds a value that is not a path`);
          continue;
        }
        const resolved = insidePath(key, entry);
        if (resolved !== null) onInside(entry, resolved);
      }
    };

    const serverNames = isPlainObject(manifest.mcpServers) ? Object.keys(manifest.mcpServers) : [];

    eachPath('agents', (entry, resolved) => {
      let stat = null;
      try { stat = fs.statSync(resolved); } catch { /* missing */ }
      if (!stat || !stat.isFile()) {
        add(manifestFile, 'path-exists', `"${entry}" in "agents" is not a file`);
        return;
      }
      const agent = parseJson(entry.replace(/\\/g, '/'));
      if (agent === undefined) return;
      if (!isPlainObject(agent)) {
        add(entry, 'json', 'the top level is not an object');
        return;
      }
      checkKeys(entry, 'the agent file', agent, ALLOWED.agent);
      for (const key of ['name', 'model', 'description', 'prompt']) {
        if (!isText(agent[key])) add(entry, 'required-fields', `"${key}" must be a non-empty string`);
      }
      if (isText(agent.model) && agent.model !== 'auto') add(entry, 'agent-model', '"model" must be "auto"');
      if (!Array.isArray(agent.tools) || agent.tools.length === 0) {
        add(entry, 'required-fields', '"tools" must be a non-empty list');
      } else {
        for (const tool of agent.tools) {
          const match = typeof tool === 'string' ? TOOL_RE.exec(tool) : null;
          if (!match) add(entry, 'agent-tools', `"${tool}" is not of the form @<app>:<server>; the agent may use only the app server`);
          else if (match[1] !== manifest.name) add(entry, 'agent-tools', `"${tool}" names the app "${match[1]}", not "${manifest.name}"`);
          else if (!serverNames.includes(match[2])) add(entry, 'agent-tools', `"${tool}" names the server "${match[2]}", which app.json does not declare`);
        }
      }
      if (isText(agent.prompt) && !agent.prompt.includes('scenario results, not a forecast')) {
        add(entry, 'agent-prompt', 'the prompt must repeat the sentence with "scenario results, not a forecast"');
      }
    });

    eachPath('skills', (entry, resolved) => {
      const skillFile = path.join(resolved, 'SKILL.md');
      let stat = null;
      try { stat = fs.statSync(skillFile); } catch { /* missing */ }
      if (!stat || !stat.isFile()) {
        add(manifestFile, 'path-exists', `"${entry}" in "skills" is not a folder with a SKILL.md`);
        return;
      }
      const relative = path.relative(rootFull, skillFile).replace(/\\/g, '/');
      const text = readText(skillFile) ?? '';
      shipped.set(relative, text);
      const fields = frontMatter(text);
      if (fields === null) {
        add(relative, 'skill-front-matter', 'the file does not start with front matter between two --- lines');
        return;
      }
      for (const key of ALLOWED.frontMatter) {
        if (!(key in fields)) add(relative, 'skill-front-matter', `the front matter has no "${key}"`);
      }
      for (const key of Object.keys(fields)) {
        if (!ALLOWED.frontMatter.includes(key)) add(relative, 'skill-front-matter', `the front matter has the key "${key}", which is not allowed`);
      }
      if ('name' in fields && fields.name !== path.basename(resolved)) {
        add(relative, 'skill-front-matter', `"name" is "${fields.name}" and must equal the folder name "${path.basename(resolved)}"`);
      }
      if ('always' in fields && fields.always !== 'false') {
        add(relative, 'skill-front-matter', '"always" must be false');
      }
    });

    if (manifest.mcpServers !== undefined) {
      if (!isPlainObject(manifest.mcpServers)) {
        add(manifestFile, 'allowed-keys', '"mcpServers" must be an object');
      } else {
        for (const [serverName, server] of Object.entries(manifest.mcpServers)) {
          const label = `mcpServers "${serverName}"`;
          if (!isPlainObject(server)) {
            add(manifestFile, 'mcp-server', `${label} must be an object`);
            continue;
          }
          checkKeys(manifestFile, label, server, ALLOWED.server);
          if (server.command !== 'node') add(manifestFile, 'mcp-server', `${label} needs "command" to be "node"`);
          if (!Array.isArray(server.args) || server.args.length === 0 || !server.args.every(isText)) {
            add(manifestFile, 'mcp-server', `${label} needs "args" as a non-empty list of text`);
          } else if (server.args.length !== 2 || server.args[0] !== '-e') {
            add(manifestFile, 'mcp-server', `${label} needs "args" to be "-e" and one inline script, so the start does not depend on the working folder`);
          } else {
            for (const word of ['apps', 'rehearsal-crew', 'dist', 'server.mjs']) {
              if (!server.args[1].includes(`'${word}'`)) add(manifestFile, 'mcp-server', `${label}: the inline script must join '${word}' to find the built server`);
            }
            let stat = null;
            try { stat = fs.statSync(path.join(rootFull, 'dist', 'server.mjs')); } catch { /* missing */ }
            if (!stat || !stat.isFile()) add(manifestFile, 'path-exists', `"dist/server.mjs" under the app root, used by ${label}, is not a file; run npm run build`);
          }
        }
      }
    }

    const dependencies = manifest.dependencies;
    if (dependencies !== undefined && !isPlainObject(dependencies)) {
      add(manifestFile, 'dependencies', '"dependencies" must be an object');
    } else {
      if (dependencies) checkKeys(manifestFile, '"dependencies"', dependencies, ALLOWED.dependencies);
      if (!dependencies || !Array.isArray(dependencies.commands) || !dependencies.commands.includes('node')) {
        add(manifestFile, 'dependencies', '"dependencies.commands" must hold "node"');
      }
    }
  }

  for (const name of ['README.md', 'LICENSE']) {
    const text = readText(path.join(rootFull, name));
    if (text === null) add(name, 'path-exists', 'the file does not exist');
    else if (name === 'README.md') shipped.set(name, text);
  }

  // Prose rules on the text the app ships.
  for (const [relative, text] of shipped) {
    if (PLACEHOLDER_RE.test(text)) add(relative, 'placeholder', 'the file holds placeholder text');
    if (BRAND_RE.test(text)) add(relative, 'brand', 'the file names a spreadsheet brand');
    const prose = relative.endsWith('.json') ? [] : proseLines(text);
    if (relative.endsWith('.json')) {
      try {
        const data = JSON.parse(text.replace(/^\uFEFF/, ''));
        for (const key of ['description', 'prompt']) if (typeof data[key] === 'string') prose.push(data[key]);
      } catch { /* reported as json */ }
    }
    if (relative.endsWith('SKILL.md')) prose.splice(0, prose.length, ...prose.filter((l) => l.startsWith('description:')));
    if (prose.some((line) => DASH_RE.test(line))) add(relative, 'dashes', 'the text has a dash between words');
  }

  // Every text file: encoding and secrets.
  for (const file of listFiles(rootFull)) {
    let bytes;
    try { bytes = fs.readFileSync(file); } catch { continue; }
    if (bytes.includes(0)) continue;
    const relative = path.relative(rootFull, file).replace(/\\/g, '/');
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      add(relative, 'encoding', 'the file starts with a byte order mark');
    }
    if (bytes.includes(13)) add(relative, 'encoding', 'the file holds a carriage return; use LF line endings');
    const text = bytes.toString('utf8');
    for (const [label, pattern] of SECRET_PATTERNS) {
      if (pattern.test(text)) add(relative, 'secret', `the file holds text that looks like ${label}`);
    }
  }

  return problems;
}

function main(argv) {
  const root = argv[0] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkRepo(root);
  if (problems.length === 0) {
    console.log('ok');
    return 0;
  }
  for (const problem of problems) console.log(`${problem.file}: ${problem.rule}: ${problem.message}`);
  return 1;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
