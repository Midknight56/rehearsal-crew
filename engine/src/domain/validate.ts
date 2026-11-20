import { MODEL_VERSION } from '../simulation/version';
import type { NodeRef } from '../simulation/heap';
import { createPathCache, describeNode } from '../spatial/path-cache';
import { LIMITS } from './limits';
import { ScenarioSchema, type Cell, type Scenario } from './scenario';

export type IssueCode =
  | 'SCHEMA_VERSION' | 'MODEL_VERSION_FORMAT' | 'SEED_FORMAT' | 'ID_FORMAT' | 'DUPLICATE_ID'
  | 'HORIZON_RANGE' | 'GRID_SIZE' | 'CELL_SIZE' | 'WALK_SPEED' | 'CELL_OUT_OF_BOUNDS' | 'CELL_BLOCKED'
  | 'DUPLICATE_BLOCKED_CELL' | 'SERVERS_RANGE' | 'SERVICE_RANGE' | 'COHORT_WINDOW' | 'COUNT_RANGE'
  | 'ARRIVAL_PATTERN' | 'ROUTE_LENGTH' | 'ROUTE_UNKNOWN_STATION' | 'ROUTE_REPEAT'
  | 'ATTENDEE_LIMIT' | 'STATION_LIMIT' | 'NON_FINITE' | 'UNSAFE_MS' | 'UNREACHABLE'
  | 'SCHEMA_SHAPE';
export type ValidationIssue = { code: IssueCode; path: string; message: string; entity?: { kind: 'station' | 'cohort'; id: string } };
export type ValidationWarning = { code: 'MODEL_VERSION_MISMATCH'; message: string };
export type ValidationResult =
  | { ok: true; scenario: Scenario; warnings: ValidationWarning[] }
  | { ok: false; issues: ValidationIssue[] };

type Args = Record<string, string | number>;

const grouped = (n: number): string => n.toLocaleString('en-US');
const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** Message templates of the design's Error Handling table. `SCHEMA_SHAPE` is the one code the table does not list. */
export const MESSAGES: Record<IssueCode, (args: Args) => string> = {
  SCHEMA_VERSION: (a) => `Unsupported schemaVersion ${a.v}; this build reads version 1.`,
  MODEL_VERSION_FORMAT: (a) => `modelVersion must look like 0.1.0; got "${a.v}".`,
  SEED_FORMAT: () => 'Base seed must be 1 to 64 characters and must not contain "|".',
  ID_FORMAT: (a) => `${cap(String(a.kind))} id "${a.id}" must be 1 to 64 characters and must not contain "|" or "#".`,
  DUPLICATE_ID: (a) => `Duplicate ${a.kind} id "${a.id}".`,
  HORIZON_RANGE: (a) => `Observation window must be a whole number of milliseconds between 1 and ${grouped(LIMITS.maxHorizonMs)} (6 hours); got ${a.v}.`,
  GRID_SIZE: (a) => `Grid must be a whole number of cells, between 1 × 1 and ${LIMITS.maxCols} × ${LIMITS.maxRows}; got ${a.cols} × ${a.rows}.`,
  CELL_SIZE: (a) => `Cell size must be a positive number of meters; got ${a.v}.`,
  WALK_SPEED: (a) => `Walking speed must be a positive number of meters per second; got ${a.v}.`,
  CELL_OUT_OF_BOUNDS: (a) => `${a.label} cell (${a.x},${a.y}) is outside the ${a.cols} × ${a.rows} grid or has a coordinate that is not a whole number.`,
  CELL_BLOCKED: (a) => `${a.label} cell (${a.x},${a.y}) is blocked.`,
  DUPLICATE_BLOCKED_CELL: (a) => `Blocked cell (${a.x},${a.y}) is listed more than once.`,
  SERVERS_RANGE: (a) => `Station "${a.id}": servers must be a whole number from ${LIMITS.minServers} to ${LIMITS.maxServers}; got ${a.v}.`,
  SERVICE_RANGE: (a) =>
    'min' in a
      ? `Station "${a.id}": triangular service needs 0 < min ≤ mode ≤ max (seconds, at most ${grouped(LIMITS.maxServiceSeconds)}); got ${a.min}/${a.mode}/${a.max}.`
      : `Station "${a.id}": service seconds must be greater than 0 and at most ${grouped(LIMITS.maxServiceSeconds)}; got ${a.v}.`,
  COHORT_WINDOW: (a) =>
    `Cohort "${a.id}": start and end must be whole milliseconds, start at or after 0 and before end, and end at or before the horizon; got start ${a.s} ms, end ${a.e} ms, horizon ${a.h} ms.`,
  COUNT_RANGE: (a) => `Cohort "${a.id}": count must be a whole number of 0 or more; got ${a.v}.`,
  ARRIVAL_PATTERN: (a) => `Cohort "${a.id}": arrival pattern must be "even" or "uniform"; got "${a.v}".`,
  ROUTE_LENGTH: (a) => `Cohort "${a.id}": route has ${a.n} visits; the limit is ${LIMITS.maxRouteVisits}.`,
  ROUTE_UNKNOWN_STATION: (a) => `Cohort "${a.id}": route names unknown station "${a.sid}".`,
  ROUTE_REPEAT: (a) => `Cohort "${a.id}": route visits station "${a.sid}" more than once.`,
  ATTENDEE_LIMIT: (a) => `Total attendees ${a.n} exceed the limit of ${grouped(LIMITS.maxAttendees)}.`,
  STATION_LIMIT: (a) => `${a.n} stations exceed the limit of ${LIMITS.maxStations}.`,
  NON_FINITE: (a) => `${a.path} must be a finite number; got ${a.v}.`,
  UNSAFE_MS: (a) =>
    `Walking duration between ${a.from} and ${a.to} is ${a.v} ms, beyond the largest safe integer; reduce the cell size or raise the walking speed.`,
  UNREACHABLE: (a) => `No walkable path between ${a.from} and ${a.to}.`,
  SCHEMA_SHAPE: (a) => `${a.path} is missing or has the wrong type.`,
};

/** The one place seconds become milliseconds. */
export function toDurationMs(seconds: number): number {
  return Math.max(1, Math.round(seconds * 1000));
}

const pathOf = (segments: readonly PropertyKey[]): string => {
  let out = '';
  for (const segment of segments) {
    out += typeof segment === 'number' ? `[${segment}]` : out === '' ? String(segment) : `.${String(segment)}`;
  }
  return out;
};

function collectNonFinite(value: unknown, segments: PropertyKey[], out: { path: string; v: number }[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push({ path: pathOf(segments), v: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => collectNonFinite(item, [...segments, i], out));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) collectNonFinite(item, [...segments, key], out);
  }
}

const isWhole = (v: number): boolean => Number.isInteger(v);

export function validateScenario(input: unknown): ValidationResult {
  // Pass 1: structural. A shape or non-finite defect ends validation, because later passes need typed data.
  const parsed = ScenarioSchema.safeParse(input);
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((issue) => {
      const path = pathOf(issue.path) || 'scenario';
      return { code: 'SCHEMA_SHAPE', path, message: MESSAGES.SCHEMA_SHAPE({ path }) };
    });
    return { ok: false, issues };
  }
  const s = parsed.data;
  const nonFinite: { path: string; v: number }[] = [];
  collectNonFinite(s, [], nonFinite);
  if (nonFinite.length > 0) {
    return {
      ok: false,
      issues: nonFinite.map(({ path, v }) => ({ code: 'NON_FINITE', path, message: MESSAGES.NON_FINITE({ path, v: String(v) }) })),
    };
  }

  const issues: ValidationIssue[] = [];
  const add = (
    code: IssueCode, path: string, args: Args, entity?: ValidationIssue['entity'],
  ): void => {
    issues.push({ code, path, message: MESSAGES[code](args), ...(entity === undefined ? {} : { entity }) });
  };

  if (s.schemaVersion !== 1) add('SCHEMA_VERSION', 'schemaVersion', { v: String(s.schemaVersion) });
  if (!/^\d+\.\d+\.\d+$/.test(s.modelVersion)) add('MODEL_VERSION_FORMAT', 'modelVersion', { v: s.modelVersion });

  // Pass 2: limits.
  const { layout } = s;
  if (!isWhole(s.horizonMs) || s.horizonMs < 1 || s.horizonMs > LIMITS.maxHorizonMs) add('HORIZON_RANGE', 'horizonMs', { v: s.horizonMs });
  const colsOk = isWhole(layout.cols) && layout.cols >= 1 && layout.cols <= LIMITS.maxCols;
  const rowsOk = isWhole(layout.rows) && layout.rows >= 1 && layout.rows <= LIMITS.maxRows;
  if (!colsOk || !rowsOk) add('GRID_SIZE', colsOk ? 'layout.rows' : 'layout.cols', { cols: layout.cols, rows: layout.rows });
  if (!(layout.cellSizeM > 0)) add('CELL_SIZE', 'layout.cellSizeM', { v: layout.cellSizeM });
  if (!(s.walkSpeedMps > 0)) add('WALK_SPEED', 'walkSpeedMps', { v: s.walkSpeedMps });
  if (s.stations.length > LIMITS.maxStations) add('STATION_LIMIT', 'stations', { n: s.stations.length });

  s.stations.forEach((station, i) => {
    const entity = { kind: 'station' as const, id: station.id };
    if (!isWhole(station.servers) || station.servers < LIMITS.minServers || station.servers > LIMITS.maxServers) {
      add('SERVERS_RANGE', `stations[${i}].servers`, { id: station.id, v: station.servers }, entity);
    }
    const service = station.service;
    if (service.kind === 'constant') {
      if (!(service.seconds > 0 && service.seconds <= LIMITS.maxServiceSeconds)) {
        add('SERVICE_RANGE', `stations[${i}].service.seconds`, { id: station.id, v: service.seconds }, entity);
      }
    } else if (!(service.minS > 0 && service.minS <= service.modeS && service.modeS <= service.maxS && service.maxS <= LIMITS.maxServiceSeconds)) {
      add('SERVICE_RANGE', `stations[${i}].service.minS`, { id: station.id, min: service.minS, mode: service.modeS, max: service.maxS }, entity);
    }
  });

  let total = 0;
  s.cohorts.forEach((cohort, i) => {
    const entity = { kind: 'cohort' as const, id: cohort.id };
    const windowOk = isWhole(cohort.startMs) && isWhole(cohort.endMs) && cohort.startMs >= 0
      && cohort.startMs < cohort.endMs && cohort.endMs <= s.horizonMs;
    if (!windowOk) add('COHORT_WINDOW', `cohorts[${i}].startMs`, { id: cohort.id, s: cohort.startMs, e: cohort.endMs, h: s.horizonMs }, entity);
    if (!isWhole(cohort.count) || cohort.count < 0) add('COUNT_RANGE', `cohorts[${i}].count`, { id: cohort.id, v: cohort.count }, entity);
    else total += cohort.count;
    if (cohort.arrivals !== 'even' && cohort.arrivals !== 'uniform') {
      add('ARRIVAL_PATTERN', `cohorts[${i}].arrivals`, { id: cohort.id, v: String(cohort.arrivals) }, entity);
    }
    if (cohort.route.length > LIMITS.maxRouteVisits) add('ROUTE_LENGTH', `cohorts[${i}].route`, { id: cohort.id, n: cohort.route.length }, entity);
  });
  if (total > LIMITS.maxAttendees) add('ATTENDEE_LIMIT', 'cohorts', { n: total });

  // Pass 3: identifiers.
  const idOk = (id: string): boolean => id.length >= 1 && id.length <= LIMITS.maxIdLength && !id.includes('|') && !id.includes('#');
  if (s.baseSeed.length < 1 || s.baseSeed.length > LIMITS.maxSeedLength || s.baseSeed.includes('|')) add('SEED_FORMAT', 'baseSeed', {});
  const stationIds = new Set<string>();
  s.stations.forEach((station, i) => {
    const entity = { kind: 'station' as const, id: station.id };
    if (!idOk(station.id)) add('ID_FORMAT', `stations[${i}].id`, { kind: 'station', id: station.id }, entity);
    if (stationIds.has(station.id)) add('DUPLICATE_ID', `stations[${i}].id`, { kind: 'station', id: station.id }, entity);
    stationIds.add(station.id);
  });
  const cohortIds = new Set<string>();
  s.cohorts.forEach((cohort, i) => {
    const entity = { kind: 'cohort' as const, id: cohort.id };
    if (!idOk(cohort.id)) add('ID_FORMAT', `cohorts[${i}].id`, { kind: 'cohort', id: cohort.id }, entity);
    if (cohortIds.has(cohort.id)) add('DUPLICATE_ID', `cohorts[${i}].id`, { kind: 'cohort', id: cohort.id }, entity);
    cohortIds.add(cohort.id);
    const seen = new Set<string>();
    cohort.route.forEach((sid, k) => {
      if (!stationIds.has(sid)) add('ROUTE_UNKNOWN_STATION', `cohorts[${i}].route[${k}]`, { id: cohort.id, sid }, entity);
      else if (seen.has(sid)) add('ROUTE_REPEAT', `cohorts[${i}].route[${k}]`, { id: cohort.id, sid }, entity);
      seen.add(sid);
    });
  });

  if (issues.length === 0) {
    // Pass 4: geometry.
    const outside = (cell: Cell): boolean =>
      !isWhole(cell[0]) || !isWhole(cell[1]) || cell[0] < 0 || cell[1] < 0 || cell[0] >= layout.cols || cell[1] >= layout.rows;
    const blockedKeys = new Set<string>();
    layout.blockedCells.forEach((cell, k) => {
      const args = { label: 'Blocked', x: cell[0], y: cell[1], cols: layout.cols, rows: layout.rows };
      if (outside(cell)) add('CELL_OUT_OF_BOUNDS', `layout.blockedCells[${k}]`, args);
      else if (blockedKeys.has(`${cell[0]},${cell[1]}`)) add('DUPLICATE_BLOCKED_CELL', `layout.blockedCells[${k}]`, args);
      else blockedKeys.add(`${cell[0]},${cell[1]}`);
    });
    const named: { label: string; path: string; cell: Cell; entity?: ValidationIssue['entity'] }[] = [
      { label: 'Entrance', path: 'layout.entrance', cell: layout.entrance },
      { label: 'Exit', path: 'layout.exit', cell: layout.exit },
      ...s.stations.map((station, i) => ({
        label: `Station "${station.id}"`, path: `stations[${i}].cell`, cell: station.cell, entity: { kind: 'station' as const, id: station.id },
      })),
    ];
    for (const { label, path, cell, entity } of named) {
      const args = { label, x: cell[0], y: cell[1], cols: layout.cols, rows: layout.rows };
      if (outside(cell)) add('CELL_OUT_OF_BOUNDS', path, args, entity);
      else if (blockedKeys.has(`${cell[0]},${cell[1]}`)) add('CELL_BLOCKED', path, args, entity);
    }
  }

  if (issues.length === 0) {
    // Pass 5: reachability and safe integer walking durations.
    const cache = createPathCache(s);
    const unreachable = new Set(cache.unreachable.map(({ from, to }) => pairKey(from, to)));
    const reported = new Set<string>();
    const report = (from: NodeRef, to: NodeRef, path: string): void => {
      const key = pairKey(from, to);
      if (!unreachable.has(key) || reported.has(key)) return;
      reported.add(key);
      add('UNREACHABLE', path, { from: describeNode(s, from), to: describeNode(s, to) });
    };
    const entrance: NodeRef = { kind: 'entrance' };
    for (const station of s.stations) report(entrance, { kind: 'station', id: station.id }, 'layout');
    report(entrance, { kind: 'exit' }, 'layout');
    s.cohorts.forEach((cohort, i) => {
      for (let k = 1; k < cohort.route.length; k += 1) {
        report({ kind: 'station', id: cohort.route[k - 1] as string }, { kind: 'station', id: cohort.route[k] as string }, `cohorts[${i}].route[${k}]`);
      }
    });
    for (const { from, to, durationMs } of cache.unsafe) {
      add('UNSAFE_MS', 'walkSpeedMps', { from: describeNode(s, from), to: describeNode(s, to), v: String(durationMs) });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  const warnings: ValidationWarning[] = [];
  if (s.modelVersion !== MODEL_VERSION) {
    warnings.push({
      code: 'MODEL_VERSION_MISMATCH',
      message: `This scenario was saved with model version ${s.modelVersion}; the engine is ${MODEL_VERSION}. Results may differ from the saved export.`,
    });
  }
  return { ok: true, scenario: s, warnings };
}

function pairKey(from: NodeRef, to: NodeRef): string {
  const key = (n: NodeRef): string => (n.kind === 'station' ? `station:${n.id}` : n.kind);
  return `${key(from)}>${key(to)}`;
}
