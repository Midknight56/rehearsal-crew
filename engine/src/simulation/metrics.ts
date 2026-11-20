import type { Scenario } from '../domain/scenario';
import type { PathCache } from '../spatial/path-cache';
import type { AttendeeRecord, ScheduleOutput, SettledSample } from './scheduler';

export type Unit = 'count' | 'ms' | 'ratio' | 'people' | 'hours';
export type Population = 'admitted' | 'completedJourney' | 'closingWindow';
export type MetricValue = { value: number | null; unit: Unit; population: Population; n: number; conditioned: boolean; note: string | null };
export type StationMetrics = {
  id: string; servers: number;
  busyMs: MetricValue; utilization: MetricValue; averageQueueLength: MetricValue; maxQueueLength: MetricValue; served: MetricValue;
};
export type Metrics = {
  horizonMs: number; admitted: number;
  completedByClosing: MetricValue;
  activeAtClosing: { total: MetricValue; walking: MetricValue; waiting: MetricValue; inService: MetricValue };
  queueWait: { total: MetricValue; mean: MetricValue; p95: MetricValue };
  journeyTime: { mean: MetricValue; p95: MetricValue };
  walkingTime: { mean: MetricValue };
  queues: { averageLength: MetricValue; maxLength: MetricValue };
  stations: StationMetrics[];
  staffHours: MetricValue;
};

/** Index of the 95th percentile in an ascending array of n values: ceil(0.95 n) - 1. */
export function p95Index(n: number): number {
  return Math.ceil(0.95 * n) - 1;
}

export function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[p95Index(sorted.length)] as number;
}

/**
 * Text of one metric: `—` for null, whole numbers for counts and people (one decimal when a people value is
 * fractional, such as an average queue length), seconds with one decimal, a percentage with one decimal, hours
 * with two decimals, and one `*` after a conditioned number.
 */
export function formatMetricValue(m: MetricValue): string {
  if (m.value === null) return 'n/a';
  let text: string;
  switch (m.unit) {
    case 'ms': text = `${(m.value / 1000).toFixed(1)} s`; break;
    case 'ratio': text = `${(m.value * 100).toFixed(1)}%`; break;
    case 'hours': text = `${m.value.toFixed(2)} h`; break;
    default: text = Number.isInteger(m.value) ? String(m.value) : m.value.toFixed(1); break;
  }
  return m.conditioned ? `${text}*` : text;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Time integral and maximum of one waiting count over the settled samples, restricted to [0, H]. */
function queueStats(samples: SettledSample[], horizonMs: number, waitingOf: (sample: SettledSample) => number): { average: number; max: number } {
  let integral = 0;
  let max = 0;
  samples.forEach((sample, i) => {
    if (sample.timeMs > horizonMs) return;
    max = Math.max(max, waitingOf(sample));
    if (sample.timeMs >= horizonMs) return;
    const next = samples[i + 1];
    const until = next === undefined ? horizonMs : Math.min(next.timeMs, horizonMs);
    integral += waitingOf(sample) * (until - sample.timeMs);
  });
  return { average: integral / horizonMs, max };
}

export function computeMetrics(out: ScheduleOutput, scenario: Scenario, cache: PathCache): Metrics {
  void cache; // walking durations are summed per attendee by the scheduler from the same cache
  const H = scenario.horizonMs;
  const admittedRecords: AttendeeRecord[] = out.attendees.filter((record) => record.state !== 'pending');
  const admitted = admittedRecords.length;
  const completed = admittedRecords.filter((record) => record.exitMs !== null);
  const conditioned = out.unfinished.length > 0;
  const note = conditioned ? `from ${completed.length} of ${admitted} admitted attendees; ${out.unfinished.length} unfinished at the drain cap` : null;

  const admittedMetric = (value: number | null, unit: Unit): MetricValue => ({ value, unit, population: 'admitted', n: admitted, conditioned: false, note: null });
  const closingMetric = (value: number | null, unit: Unit): MetricValue => ({ value, unit, population: 'closingWindow', n: admitted, conditioned: false, note: null });
  const journeyMetric = (value: number | null, unit: Unit): MetricValue => ({
    value: completed.length === 0 ? null : value, unit, population: 'completedJourney', n: completed.length, conditioned, note,
  });

  const waits = completed.map((record) => sum(record.visits.map((v) => (v.serviceStartMs ?? v.queueJoinMs) - v.queueJoinMs)));
  const journeys = completed.map((record) => (record.exitMs as number) - record.arrivalMs);
  const mean = (values: number[]): number => sum(values) / values.length;

  const lastSample = [...out.settled].reverse().find((sample) => sample.timeMs <= H);
  const active = lastSample === undefined
    ? { total: 0, walking: 0, waiting: 0, inService: 0 }
    : { total: lastSample.admitted - lastSample.exited, walking: lastSample.walking, waiting: lastSample.waiting, inService: lastSample.inService };

  const stations = [...scenario.stations].sort((a, b) => byCodeUnit(a.id, b.id)).map((station): StationMetrics => {
    let busyMs = 0;
    let served = 0;
    for (const record of admittedRecords) {
      for (const visit of record.visits) {
        if (visit.stationId !== station.id) continue;
        if (visit.serviceStartMs !== null) {
          const start = Math.min(visit.serviceStartMs, H);
          const end = Math.min(visit.completeMs ?? Number.POSITIVE_INFINITY, H);
          busyMs += Math.max(0, end - start);
        }
        if (visit.completeMs !== null && visit.completeMs <= H) served += 1;
      }
    }
    const queue = queueStats(out.settled, H, (sample) => sample.waitingByStation[station.id] ?? 0);
    return {
      id: station.id,
      servers: station.servers,
      busyMs: closingMetric(busyMs, 'ms'),
      utilization: closingMetric(busyMs / (station.servers * H), 'ratio'),
      averageQueueLength: closingMetric(queue.average, 'people'),
      maxQueueLength: closingMetric(queue.max, 'people'),
      served: closingMetric(served, 'count'),
    };
  });

  const totalQueue = queueStats(out.settled, H, (sample) => sample.waiting);
  return {
    horizonMs: H,
    admitted,
    completedByClosing: admittedMetric(admittedRecords.filter((record) => record.exitMs !== null && record.exitMs <= H).length, 'count'),
    activeAtClosing: {
      total: admittedMetric(active.total, 'people'),
      walking: admittedMetric(active.walking, 'people'),
      waiting: admittedMetric(active.waiting, 'people'),
      inService: admittedMetric(active.inService, 'people'),
    },
    queueWait: {
      total: journeyMetric(sum(waits), 'ms'),
      mean: journeyMetric(waits.length === 0 ? null : mean(waits), 'ms'),
      p95: journeyMetric(percentile95(waits), 'ms'),
    },
    journeyTime: {
      mean: journeyMetric(journeys.length === 0 ? null : mean(journeys), 'ms'),
      p95: journeyMetric(percentile95(journeys), 'ms'),
    },
    walkingTime: { mean: admittedMetric(admitted === 0 ? null : mean(admittedRecords.map((record) => record.walkingMs)), 'ms') },
    queues: { averageLength: closingMetric(totalQueue.average, 'people'), maxLength: closingMetric(totalQueue.max, 'people') },
    stations,
    staffHours: closingMetric((sum(scenario.stations.map((station) => station.servers)) * H) / 3_600_000, 'hours'),
  };
}
