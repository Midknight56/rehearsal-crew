import type { Scenario } from '../domain/scenario';
import { PER_PERSON_OFF } from './labels';
import type { ReplaySelection } from './replay-contract';

export type PopulationChange = { changed: boolean; baselineCount: number; candidateCount: number; details: string[] };
export type AttendeePair = {
  id: string; cohortId: string; arrivalMs: number;
  baselineWaitMs: number | null; candidateWaitMs: number | null;
  baselineJourneyMs: number | null; candidateJourneyMs: number | null;
};

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const total = (scenario: Scenario): number => scenario.cohorts.reduce((sum, cohort) => sum + cohort.count, 0);

/** Compares the multiset of (cohort id, count); attendee ids derive from cohort id and ordinal, so this is the population. */
export function populationChange(baseline: Scenario, candidate: Scenario): PopulationChange {
  const before = new Map(baseline.cohorts.map((cohort) => [cohort.id, cohort.count]));
  const after = new Map(candidate.cohorts.map((cohort) => [cohort.id, cohort.count]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort(byCodeUnit);
  const details: string[] = [];
  for (const id of ids) {
    const a = before.get(id);
    const b = after.get(id);
    if (a === undefined && b !== undefined) details.push(`Cohort "${id}" added (${b} people)`);
    else if (a !== undefined && b === undefined) details.push(`Cohort "${id}" removed (${a} people)`);
    else if (a !== b) details.push(`Cohort "${id}": count ${a} → ${b} people`);
  }
  return { changed: details.length > 0, baselineCount: total(baseline), candidateCount: total(candidate), details };
}

type Trace = NonNullable<ReplaySelection['baseline']['trace']>;

function waitsAndJourneys(trace: Trace): Map<string, { arrivalMs: number; cohortId: string; waitMs: number | null; journeyMs: number | null }> {
  const waits = new Map<string, number>();
  for (const event of trace.events) {
    if (event.kind === 'start') waits.set(event.attendeeId, (waits.get(event.attendeeId) ?? 0) + event.waitMs);
  }
  const out = new Map<string, { arrivalMs: number; cohortId: string; waitMs: number | null; journeyMs: number | null }>();
  for (const attendee of trace.attendees) {
    const finished = attendee.exitMs !== null;
    out.set(attendee.id, {
      arrivalMs: attendee.arrivalMs,
      cohortId: attendee.cohortId,
      waitMs: finished ? (waits.get(attendee.id) ?? 0) : null,
      journeyMs: finished ? (attendee.exitMs as number) - attendee.arrivalMs : null,
    });
  }
  return out;
}

/** Per-attendee pairs for the replayed replication; unavailable when the populations differ. */
export function attendeePairs(selection: ReplaySelection, population: PopulationChange):
  | { ok: true; pairs: AttendeePair[] }
  | { ok: false; code: 'POPULATION_CHANGED'; message: string } {
  if (population.changed) return { ok: false, code: 'POPULATION_CHANGED', message: PER_PERSON_OFF };
  const left = selection.baseline.trace;
  const right = selection.candidate.trace;
  if (left === undefined || right === undefined) return { ok: true, pairs: [] };
  const base = waitsAndJourneys(left);
  const cand = waitsAndJourneys(right);
  const pairs: AttendeePair[] = [];
  for (const [id, b] of base) {
    const c = cand.get(id);
    if (c === undefined) continue;
    pairs.push({
      id, cohortId: b.cohortId, arrivalMs: b.arrivalMs,
      baselineWaitMs: b.waitMs, candidateWaitMs: c.waitMs,
      baselineJourneyMs: b.journeyMs, candidateJourneyMs: c.journeyMs,
    });
  }
  return { ok: true, pairs: pairs.sort((a, b) => a.arrivalMs - b.arrivalMs || byCodeUnit(a.id, b.id)) };
}
