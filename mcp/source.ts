import fs from 'node:fs';
import path from 'node:path';
import { MAX_SCENARIO_BYTES, MAX_SCENARIO_TEXT, fail, type Failure } from './text';

export const EXAMPLES: readonly { id: string; summary: string }[] = [
  { id: 'baseline', summary: 'One check-in desk with 1 server and welcome packs with 2 servers. 120 attendees arrive over 20 min.' },
  { id: 'plus-one-checkin', summary: 'The baseline with a second server at the check-in desk. Nothing else changes.' },
  { id: 'shorter-route', summary: 'The baseline with the welcome packs moved nearer the check-in desk, so the walk is shorter.' },
];

export type Folders = { workDir: string; examplesDir: string };
export type Loaded = { ok: true; raw: unknown; source: string } | Failure;

const inside = (child: string, parent: string): boolean => {
  const relation = path.relative(parent, child);
  return relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation));
};
const insideAllowed = (file: string, folders: Folders): boolean =>
  inside(file, folders.workDir) || inside(file, folders.examplesDir);

const tooBig = (): Failure =>
  fail('file_too_large', `The scenario is larger than ${MAX_SCENARIO_TEXT}, so it was not read.`);

function parse(text: string, source: string): Loaded {
  try {
    return { ok: true, raw: JSON.parse(text) as unknown, source };
  } catch {
    // The parser message is not passed on, because it can quote the file.
    return fail('not_json', `The scenario from ${source} is not valid JSON.`);
  }
}

/** Reads a scenario from an example id, JSON text, or a .json path inside the working folder or the examples folder. */
export function loadScenario(input: string, folders: Folders): Loaded {
  const text = input.trim();
  if (text.startsWith('{')) {
    if (Buffer.byteLength(input, 'utf8') > MAX_SCENARIO_BYTES) return tooBig();
    return parse(text, 'the JSON text');
  }
  const example = EXAMPLES.find((e) => e.id === text);
  if (example !== undefined) {
    const file = path.join(folders.examplesDir, `${example.id}.json`);
    return parse(fs.readFileSync(file, 'utf8'), `example "${example.id}"`);
  }

  const refused = (): Failure =>
    fail('path_refused', 'That path is outside the working folder and the examples folder, or is not a .json file, so it was not read. '
      + 'Give an example id, the JSON text, or a .json path inside the working folder.');
  if (text === '' || !text.toLowerCase().endsWith('.json')) return refused();
  const resolved = path.resolve(folders.workDir, text);
  if (!insideAllowed(resolved, folders)) return refused();
  if (!fs.existsSync(resolved)) return fail('file_not_found', `There is no file at "${text}".`);

  // A link inside the folder must not lead out of it.
  const real = fs.realpathSync(resolved);
  const realFolders = { workDir: fs.realpathSync(folders.workDir), examplesDir: fs.realpathSync(folders.examplesDir) };
  if (!insideAllowed(real, realFolders)) return refused();
  const stat = fs.statSync(real);
  if (!stat.isFile()) return fail('not_a_file', `"${text}" is not a file.`);
  if (stat.size > MAX_SCENARIO_BYTES) return tooBig();
  return parse(fs.readFileSync(real, 'utf8'), `file "${text}"`);
}
