import type { CompiledAttendee } from './arrivals';
import { EventHeap, type NodeRef, type SimEvent } from './heap';
import { Line } from './line';
import type { MovementSegment, TraceEvent } from './trace';

export type ScheduleStation = { id: string; servers: number; serviceMs: (attendeeId: string) => number };
export type TravelLookup = (from: NodeRef, to: NodeRef) => { pathId: number; durationMs: number };
export type ScheduleInput = {
  attendees: CompiledAttendee[]; stations: ScheduleStation[]; travel: TravelLookup;
  horizonMs: number; drainCapMs: number; trace: boolean;
};
export type Visit = { stationId: string; queueJoinMs: number; serviceStartMs: number | null; completeMs: number | null; server: number | null };
export type AttendeeRecord = {
  id: string; cohortId: string; arrivalMs: number; route: string[]; visits: Visit[]; walkingMs: number; exitMs: number | null;
  state: 'pending' | 'walking' | 'waiting' | 'inService' | 'exited';
};
export type SettledSample = {
  timeMs: number; admitted: number; walking: number; waiting: number; inService: number; exited: number;
  waitingByStation: Record<string, number>;
};
export type ScheduleOutput = {
  attendees: AttendeeRecord[]; settled: SettledSample[];
  events: TraceEvent[]; segments: MovementSegment[]; // empty arrays when trace is false
  completion: 'complete' | 'drain-capped'; unfinished: string[]; capMs: number;
};

type StationState = { id: string; servers: number; serviceMs: (attendeeId: string) => number; line: Line; busy: boolean[] };

const ENTRANCE: NodeRef = { kind: 'entrance' };
const EXIT: NodeRef = { kind: 'exit' };

export function runSchedule(input: ScheduleInput): ScheduleOutput {
  const capMs = input.horizonMs + input.drainCapMs;
  const heap = new EventHeap();
  const events: TraceEvent[] = [];
  const segments: MovementSegment[] = [];
  const settled: SettledSample[] = [];
  const records = new Map<string, AttendeeRecord>();
  const attendees: AttendeeRecord[] = [];
  const stations = new Map<string, StationState>();
  for (const station of input.stations) {
    stations.set(station.id, {
      id: station.id,
      servers: station.servers,
      serviceMs: station.serviceMs,
      line: new Line(),
      busy: new Array<boolean>(station.servers).fill(false),
    });
  }
  const dispatchOrder = [...stations.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let admitted = 0;
  let walking = 0;
  let waiting = 0;
  let inService = 0;
  let exited = 0;
  let capReached = false;

  const emit = (event: TraceEvent): void => {
    if (input.trace) events.push(event);
  };

  const nodeAfter = (record: AttendeeRecord, visited: number): NodeRef => {
    const next = record.route[visited];
    return next === undefined ? EXIT : { kind: 'station', id: next };
  };

  const depart = (t: number, record: AttendeeRecord, from: NodeRef, to: NodeRef): void => {
    const { pathId, durationMs } = input.travel(from, to);
    const arriveMs = t + durationMs;
    heap.push({ timeMs: arriveMs, kind: 'movement-arrival', attendeeId: record.id, node: to, pathId });
    emit({ kind: 'depart', timeMs: t, attendeeId: record.id, from, to, pathId, arriveMs });
    if (input.trace) segments.push({ attendeeId: record.id, startMs: t, endMs: arriveMs, pathId });
  };

  for (const attendee of input.attendees) {
    const record: AttendeeRecord = {
      id: attendee.id,
      cohortId: attendee.cohortId,
      arrivalMs: attendee.arrivalMs,
      route: [...attendee.route],
      visits: [],
      walkingMs: 0,
      exitMs: null,
      state: 'pending',
    };
    records.set(record.id, record);
    attendees.push(record);
    heap.push({ timeMs: attendee.arrivalMs, kind: 'external-arrival', attendeeId: attendee.id });
  }

  for (;;) {
    const head = heap.peek();
    if (head === undefined) break;
    const t = head.timeMs;
    if (t > capMs) {
      capReached = true;
      break;
    }
    const joined: { attendeeId: string; stationId: string }[] = [];

    for (let event: SimEvent | undefined = heap.peek(); event !== undefined && event.timeMs === t; event = heap.peek()) {
      heap.pop();
      const record = records.get(event.attendeeId) as AttendeeRecord;
      if (event.kind === 'external-arrival') {
        admitted += 1;
        walking += 1;
        record.state = 'walking';
        let from: NodeRef = ENTRANCE;
        let walkingMs = 0;
        for (let k = 0; k <= record.route.length; k += 1) {
          const to = nodeAfter(record, k);
          walkingMs += input.travel(from, to).durationMs;
          from = to;
        }
        record.walkingMs = walkingMs;
        emit({ kind: 'arrive', timeMs: t, attendeeId: record.id });
        depart(t, record, ENTRANCE, nodeAfter(record, 0));
      } else if (event.kind === 'movement-arrival') {
        const node = event.node as NodeRef;
        if (node.kind === 'station') {
          const station = stations.get(node.id) as StationState;
          walking -= 1;
          waiting += 1;
          record.state = 'waiting';
          station.line.insert({ attendeeId: record.id, queueJoinMs: t });
          record.visits.push({ stationId: node.id, queueJoinMs: t, serviceStartMs: null, completeMs: null, server: null });
          joined.push({ attendeeId: record.id, stationId: node.id });
        } else {
          walking -= 1;
          exited += 1;
          record.state = 'exited';
          record.exitMs = t;
          emit({ kind: 'exit', timeMs: t, attendeeId: record.id });
        }
      } else {
        const stationId = event.stationId as string;
        const server = event.server as number;
        const station = stations.get(stationId) as StationState;
        station.busy[server] = false;
        const visit = record.visits[record.visits.length - 1] as Visit;
        visit.completeMs = t;
        inService -= 1;
        walking += 1;
        record.state = 'walking';
        emit({ kind: 'complete', timeMs: t, attendeeId: record.id, stationId, server });
        depart(t, record, { kind: 'station', id: stationId }, nodeAfter(record, record.visits.length));
      }
    }

    for (const { attendeeId, stationId } of joined) {
      const station = stations.get(stationId) as StationState;
      const position = station.line.entries().findIndex((entry) => entry.attendeeId === attendeeId);
      emit({ kind: 'join', timeMs: t, attendeeId, stationId, position });
    }

    for (const station of dispatchOrder) {
      while (station.line.length > 0) {
        const server = station.busy.indexOf(false);
        if (server === -1) break;
        const entry = station.line.shift() as { attendeeId: string; queueJoinMs: number };
        station.busy[server] = true;
        waiting -= 1;
        inService += 1;
        const record = records.get(entry.attendeeId) as AttendeeRecord;
        record.state = 'inService';
        const serviceMs = station.serviceMs(entry.attendeeId);
        const visit = record.visits[record.visits.length - 1] as Visit;
        visit.serviceStartMs = t;
        visit.server = server;
        emit({ kind: 'start', timeMs: t, attendeeId: entry.attendeeId, stationId: station.id, server, waitMs: t - entry.queueJoinMs });
        heap.push({ timeMs: t + serviceMs, kind: 'service-complete', attendeeId: entry.attendeeId, stationId: station.id, server });
      }
    }

    const waitingByStation: Record<string, number> = {};
    for (const station of dispatchOrder) waitingByStation[station.id] = station.line.length;
    settled.push({ timeMs: t, admitted, walking, waiting, inService, exited, waitingByStation });
  }

  const unfinished = attendees.filter((record) => record.state !== 'exited').map((record) => record.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (capReached) emit({ kind: 'cap', timeMs: capMs });
  return {
    attendees,
    settled,
    events,
    segments,
    completion: unfinished.length === 0 ? 'complete' : 'drain-capped',
    unfinished,
    capMs,
  };
}
