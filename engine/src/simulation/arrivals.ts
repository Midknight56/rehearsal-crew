import type { Scenario } from '../domain/scenario';
import { arrivalKey, createGenerator } from './random';

export type CompiledAttendee = { id: string; cohortId: string; ordinal: number; arrivalMs: number; route: string[] };

/** `${cohortId}#${ordinal}` with the zero-based ordinal padded to four digits. */
export function attendeeId(cohortId: string, ordinal: number): string {
  return `${cohortId}#${String(ordinal).padStart(4, '0')}`;
}

/** Attendee j of `count`, evenly spread over [startMs, endMs), clamped inside the window. */
export function evenArrivalMs(startMs: number, endMs: number, count: number, j: number): number {
  const raw = startMs + Math.round((j + 0.5) * (endMs - startMs) / count);
  return Math.min(Math.max(raw, startMs), endMs - 1);
}

/** One uniform draw u in [0, 1) mapped into [startMs, endMs). */
export function uniformArrivalMs(startMs: number, endMs: number, u: number): number {
  return startMs + Math.floor(u * (endMs - startMs));
}

/** Every attendee of every cohort, sorted by (arrivalMs, id) in code-unit order; ids are never renumbered. */
export function compileAttendees(scenario: Scenario, replication: number): CompiledAttendee[] {
  const attendees: CompiledAttendee[] = [];
  for (const cohort of scenario.cohorts) {
    for (let ordinal = 0; ordinal < cohort.count; ordinal += 1) {
      const id = attendeeId(cohort.id, ordinal);
      const arrivalMs = cohort.arrivals === 'even'
        ? evenArrivalMs(cohort.startMs, cohort.endMs, cohort.count, ordinal)
        : uniformArrivalMs(cohort.startMs, cohort.endMs, createGenerator(arrivalKey(scenario.baseSeed, replication, id))());
      attendees.push({ id, cohortId: cohort.id, ordinal, arrivalMs, route: [...cohort.route] });
    }
  }
  attendees.sort((a, b) => a.arrivalMs - b.arrivalMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return attendees;
}
