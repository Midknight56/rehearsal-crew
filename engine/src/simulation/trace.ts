import type { PathCache, CachedPath } from '../spatial/path-cache';
import type { NodeRef } from './heap';
import type { ScheduleOutput } from './scheduler';
export type TraceEvent =
  | { kind: 'arrive'; timeMs: number; attendeeId: string }
  | { kind: 'depart'; timeMs: number; attendeeId: string; from: NodeRef; to: NodeRef; pathId: number; arriveMs: number }
  | { kind: 'join'; timeMs: number; attendeeId: string; stationId: string; position: number }
  | { kind: 'start'; timeMs: number; attendeeId: string; stationId: string; server: number; waitMs: number }
  | { kind: 'complete'; timeMs: number; attendeeId: string; stationId: string; server: number }
  | { kind: 'exit'; timeMs: number; attendeeId: string }
  | { kind: 'cap'; timeMs: number };
export type MovementSegment = { attendeeId: string; startMs: number; endMs: number; pathId: number };
export type TraceAttendee = { id: string; cohortId: string; arrivalMs: number; exitMs: number | null };
export type Trace = { version: 1; paths: CachedPath[]; attendees: TraceAttendee[]; events: TraceEvent[]; segments: MovementSegment[] };

const byArrivalThenId = (a: TraceAttendee, b: TraceAttendee): number =>
  a.arrivalMs !== b.arrivalMs ? a.arrivalMs - b.arrivalMs : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Assemble the trace of one run: referenced paths in id order, attendees by (arrivalMs, id), events in processing order. */
export function buildTrace(out: ScheduleOutput, cache: PathCache): Trace {
  const referenced = new Set(out.segments.map((segment) => segment.pathId));
  return {
    version: 1,
    paths: cache.paths.filter((path) => referenced.has(path.id)).sort((a, b) => a.id - b.id),
    attendees: out.attendees
      .map((record): TraceAttendee => ({ id: record.id, cohortId: record.cohortId, arrivalMs: record.arrivalMs, exitMs: record.exitMs }))
      .sort(byArrivalThenId),
    events: out.events,
    segments: out.segments,
  };
}
