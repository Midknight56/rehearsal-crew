import type { Cell, Cohort, Scenario, Station } from '../domain/scenario';
import { createPathCache } from '../spatial/path-cache';
import type { NodeRef } from '../simulation/heap';
import { formatCell, formatMeters, formatMinutes, formatRoute, formatSeconds, formatService, formatSpeed, formatWindow } from './format';
import { populationChange, type PopulationChange } from './population';

export type ChangeGroup = 'population' | 'staffing' | 'service' | 'layout' | 'arrivals' | 'timing' | 'route' | 'derived';
export type ChangeEntry = {
  path: string; group: ChangeGroup; label: string; before: string; after: string; text: string; highlight: boolean; derived: boolean;
};
export type AssumptionsDiff = { changes: ChangeEntry[]; kind: 'none' | 'single' | 'combined'; population: PopulationChange };

const GROUP_ORDER: ChangeGroup[] = ['population', 'staffing', 'service', 'layout', 'arrivals', 'timing', 'route', 'derived'];
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const cellKey = (cell: Cell): string => `${cell[0]},${cell[1]}`;

function value(path: string, group: ChangeGroup, label: string, before: string, after: string): ChangeEntry {
  return { path, group, label, before, after, text: `${label} ${before} → ${after}`, highlight: false, derived: false };
}
function note(path: string, group: ChangeGroup, label: string, text: string, before = '', after = ''): ChangeEntry {
  return { path, group, label, before, after, text, highlight: false, derived: false };
}

function stationChanges(baseline: Scenario, candidate: Scenario): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  const before = new Map(baseline.stations.map((s) => [s.id, s]));
  const after = new Map(candidate.stations.map((s) => [s.id, s]));
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort(byCodeUnit)) {
    const a: Station | undefined = before.get(id);
    const b: Station | undefined = after.get(id);
    if (a === undefined && b !== undefined) {
      out.push(note(`stations.${id}`, 'layout', `Station "${id}"`, `Station "${id}" added`, '', 'added'));
      continue;
    }
    if (a !== undefined && b === undefined) {
      out.push(note(`stations.${id}`, 'layout', `Station "${id}"`, `Station "${id}" removed`, 'present', ''));
      continue;
    }
    if (a === undefined || b === undefined) continue;
    const name = a.label === b.label ? a.label : id;
    if (a.label !== b.label) {
      out.push(value(`stations.${id}.label`, 'layout', `Station "${id}": label`, `"${a.label}"`, `"${b.label}"`));
    }
    if (a.servers !== b.servers) {
      out.push(value(`stations.${id}.servers`, 'staffing', `Station "${name}": servers`, String(a.servers), String(b.servers)));
    }
    if (JSON.stringify(a.service) !== JSON.stringify(b.service)) {
      out.push(value(`stations.${id}.service`, 'service', `Station "${name}": service`, formatService(a.service), formatService(b.service)));
    }
    if (cellKey(a.cell) !== cellKey(b.cell)) {
      out.push(value(`stations.${id}.cell`, 'layout', `Station "${name}": position`, formatCell(a.cell), formatCell(b.cell)));
    }
  }
  return out;
}

function cohortChanges(baseline: Scenario, candidate: Scenario): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  const before = new Map(baseline.cohorts.map((c) => [c.id, c]));
  const after = new Map(candidate.cohorts.map((c) => [c.id, c]));
  for (const id of [...before.keys()].filter((key) => after.has(key)).sort(byCodeUnit)) {
    const a = before.get(id) as Cohort;
    const b = after.get(id) as Cohort;
    if (a.startMs !== b.startMs || a.endMs !== b.endMs) {
      out.push(value(`cohorts.${id}.window`, 'arrivals', `Cohort "${id}": window`, formatWindow(a.startMs, a.endMs), formatWindow(b.startMs, b.endMs)));
    }
    if (a.arrivals !== b.arrivals) {
      out.push(value(`cohorts.${id}.arrivals`, 'arrivals', `Cohort "${id}": arrivals`, a.arrivals, b.arrivals));
    }
    if (JSON.stringify(a.route) !== JSON.stringify(b.route)) {
      out.push(value(`cohorts.${id}.route`, 'route', `Cohort "${id}": route`, formatRoute(a.route), formatRoute(b.route)));
    }
  }
  return out;
}

function layoutChanges(baseline: Scenario, candidate: Scenario): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  const a = baseline.layout;
  const b = candidate.layout;
  if (a.cols !== b.cols) out.push(value('layout.cols', 'layout', 'Grid columns', String(a.cols), String(b.cols)));
  if (a.rows !== b.rows) out.push(value('layout.rows', 'layout', 'Grid rows', String(a.rows), String(b.rows)));
  if (a.cellSizeM !== b.cellSizeM) out.push(value('layout.cellSizeM', 'layout', 'Cell size', `${a.cellSizeM} m`, `${b.cellSizeM} m`));
  if (cellKey(a.entrance) !== cellKey(b.entrance)) out.push(value('layout.entrance', 'layout', 'Entrance', formatCell(a.entrance), formatCell(b.entrance)));
  if (cellKey(a.exit) !== cellKey(b.exit)) out.push(value('layout.exit', 'layout', 'Exit', formatCell(a.exit), formatCell(b.exit)));
  const was = new Set(a.blockedCells.map(cellKey));
  const now = new Set(b.blockedCells.map(cellKey));
  const added = [...now].filter((key) => !was.has(key)).length;
  const removed = [...was].filter((key) => !now.has(key)).length;
  if (added > 0 || removed > 0) {
    out.push(note('layout.blockedCells', 'layout', 'Blocked cells', `Blocked cells: ${added} added, ${removed} removed`, `${was.size} cells`, `${now.size} cells`));
  }
  if (baseline.walkSpeedMps !== candidate.walkSpeedMps) {
    out.push(value('walkSpeedMps', 'layout', 'Walking speed', formatSpeed(baseline.walkSpeedMps), formatSpeed(candidate.walkSpeedMps)));
  }
  return out;
}

type Walk = { distanceM: number; durationMs: number };

/** Walking per attendee along a cohort's own route in one scenario; null when a leg is unknown or unreachable. */
function walkingOf(scenario: Scenario, route: string[]): Walk | null {
  try {
    const cache = createPathCache(scenario);
    const nodes: NodeRef[] = [{ kind: 'entrance' }, ...route.map((id): NodeRef => ({ kind: 'station', id })), { kind: 'exit' }];
    let distanceM = 0;
    let durationMs = 0;
    for (let i = 0; i + 1 < nodes.length; i += 1) {
      const from = nodes[i] as NodeRef;
      const to = nodes[i + 1] as NodeRef;
      if (cache.unreachable.some((pair) => JSON.stringify(pair.from) === JSON.stringify(from) && JSON.stringify(pair.to) === JSON.stringify(to))) {
        return null;
      }
      const path = cache.lookup(from, to);
      distanceM += path.distanceM;
      durationMs += path.durationMs;
    }
    return { distanceM, durationMs };
  } catch {
    return null;
  }
}

function derivedChanges(baseline: Scenario, candidate: Scenario): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  const after = new Map(candidate.cohorts.map((c) => [c.id, c]));
  for (const cohort of [...baseline.cohorts].sort((x, y) => byCodeUnit(x.id, y.id))) {
    const other = after.get(cohort.id);
    if (other === undefined) continue;
    const a = walkingOf(baseline, cohort.route);
    const b = walkingOf(candidate, other.route);
    if (a === null || b === null || a.distanceM === b.distanceM) continue;
    const label = `Walking per attendee, cohort "${cohort.id}":`;
    out.push({
      path: `derived.walking.${cohort.id}`, group: 'derived', label,
      before: formatMeters(a.distanceM), after: formatMeters(b.distanceM),
      text: `${label} ${formatMeters(a.distanceM)} → ${formatMeters(b.distanceM)} (${formatSeconds(a.durationMs)} → ${formatSeconds(b.durationMs)})`,
      highlight: false, derived: true,
    });
  }
  return out;
}

/** Differences between two scenarios in display units. Metadata (id, title, notes, revision, modelVersion) never appears. */
export function diffScenarios(baseline: Scenario, candidate: Scenario): AssumptionsDiff {
  const population = populationChange(baseline, candidate);
  const changes: ChangeEntry[] = [];
  if (population.changed) {
    changes.push({
      path: 'cohorts', group: 'population', label: 'Attendee population', before: `${population.baselineCount} people`,
      after: `${population.candidateCount} people`, text: population.details.join('; '), highlight: true, derived: false,
    });
  }
  changes.push(...stationChanges(baseline, candidate), ...cohortChanges(baseline, candidate), ...layoutChanges(baseline, candidate));
  if (baseline.horizonMs !== candidate.horizonMs) {
    changes.push(value('horizonMs', 'timing', 'Observation window', formatMinutes(baseline.horizonMs), formatMinutes(candidate.horizonMs)));
  }
  if (baseline.baseSeed !== candidate.baseSeed) changes.push(value('baseSeed', 'timing', 'Seed', baseline.baseSeed, candidate.baseSeed));
  changes.push(...derivedChanges(baseline, candidate));

  const rank = (group: ChangeGroup): number => GROUP_ORDER.indexOf(group);
  changes.sort((a, b) => rank(a.group) - rank(b.group) || byCodeUnit(a.path, b.path));
  const real = changes.filter((c) => !c.derived).length;
  return { changes, kind: real === 0 ? 'none' : real === 1 ? 'single' : 'combined', population };
}
