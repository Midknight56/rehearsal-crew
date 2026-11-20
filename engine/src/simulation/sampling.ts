import { toDurationMs } from '../domain/validate';
import type { Scenario, Service } from '../domain/scenario';
import { createGenerator, serviceKey } from './random';

/** Inverse-CDF sample of a triangular distribution with minimum a, mode c, maximum b (all in the same unit). */
export function triangular(u: number, a: number, c: number, b: number): number {
  if (a === b) return a;
  if (u <= (c - a) / (b - a)) return a + Math.sqrt(u * (b - a) * (c - a));
  return b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

/** Milliseconds for one service. Constant, or triangular with minS === maxS, takes no draw. */
export function serviceDurationMs(service: Service, draw: () => number): number {
  if (service.kind === 'constant') return toDurationMs(service.seconds);
  if (service.minS === service.maxS) return toDurationMs(service.minS);
  return toDurationMs(triangular(draw(), service.minS, service.modeS, service.maxS));
}

/**
 * One generator per (attendeeId, stationId), created on first use; the drawn duration is memoized so that
 * asking again, in any order, returns the same value.
 */
export function compileServiceSampler(scenario: Scenario, replication: number): (attendeeId: string, stationId: string) => number {
  const stations = new Map(scenario.stations.map((station) => [station.id, station]));
  const memo = new Map<string, number>();
  return (attendeeId, stationId) => {
    const key = serviceKey(scenario.baseSeed, replication, attendeeId, stationId);
    const known = memo.get(key);
    if (known !== undefined) return known;
    const station = stations.get(stationId);
    if (station === undefined) throw new Error(`Sampler: unknown station "${stationId}"`);
    const duration = serviceDurationMs(station.service, createGenerator(key));
    memo.set(key, duration);
    return duration;
  };
}
