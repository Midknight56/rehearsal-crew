import { DRAIN_CAP_MS } from '../domain/limits';
import type { Scenario } from '../domain/scenario';
import { validateScenario, type ValidationIssue } from '../domain/validate';
import { createPathCache } from '../spatial/path-cache';
import { compileAttendees } from './arrivals';
import { computeMetrics, type Metrics } from './metrics';
import { compileServiceSampler } from './sampling';
import { runSchedule } from './scheduler';
import { buildTrace, type Trace } from './trace';

export type SimulateOptions = { trace: boolean; scenarioHash: string };
export type RunResult = {
  scenarioHash: string; modelVersion: string; baseSeed: string; replication: number;
  horizonMs: number; completion: 'complete' | 'drain-capped'; unfinished: string[];
  metrics: Metrics; trace?: Trace;
};

export class ScenarioInvalidError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    const first = issues[0]?.message ?? 'Scenario is invalid.';
    super(issues.length > 1 ? `${first} (+${issues.length - 1} more)` : first);
    this.name = 'ScenarioInvalidError';
    this.issues = issues;
  }
}

export function simulate(scenario: Scenario, replication: number, options: SimulateOptions): RunResult {
  const validated = validateScenario(scenario);
  if (!validated.ok) throw new ScenarioInvalidError(validated.issues);
  const s = validated.scenario;
  const attendees = compileAttendees(s, replication);
  const cache = createPathCache(s);
  const sampler = compileServiceSampler(s, replication);
  const out = runSchedule({
    attendees,
    stations: s.stations.map((station) => ({
      id: station.id,
      servers: station.servers,
      serviceMs: (attendeeId: string) => sampler(attendeeId, station.id),
    })),
    travel: (from, to) => {
      const path = cache.lookup(from, to);
      return { pathId: path.id, durationMs: path.durationMs };
    },
    horizonMs: s.horizonMs,
    drainCapMs: DRAIN_CAP_MS,
    trace: options.trace,
  });
  return {
    scenarioHash: options.scenarioHash,
    modelVersion: s.modelVersion,
    baseSeed: s.baseSeed,
    replication,
    horizonMs: s.horizonMs,
    completion: out.completion,
    unfinished: out.unfinished,
    metrics: computeMetrics(out, s, cache),
    ...(options.trace ? { trace: buildTrace(out, cache) } : {}),
  };
}
