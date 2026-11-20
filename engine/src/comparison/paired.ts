import type { Station } from '../domain/scenario';
import { formatMetricValue, type Population, type Unit } from '../simulation/metrics';
import type { RunResult } from '../simulation/simulate';
import { RANGE_LABEL } from './labels';
import { METRIC_KEYS, STATION_METRIC_KEYS, readMetric, readStationMetric, type Direction, type StationMetricKey } from './metric-keys';
import { EMPTY_VALUE } from './format';
import { percentile } from './percentiles';
import { REPLICATIONS, REPLICATION_INDICES } from './replications';

export { REPLICATIONS, REPLICATION_INDICES };

export type PairedDifference = { replication: number; baseline: number | null; candidate: number | null; difference: number | null };
export type PairedMetric = {
  key: string;
  label: string; unit: Unit; population: Population; betterDirection: Direction;
  baselineMean: number | null; candidateMean: number | null;
  meanChange: number | null; rangeP10: number | null; rangeP90: number | null;
  rangeLabel: typeof RANGE_LABEL;
  n: number; improved: number | null; worsened: number | null; unchanged: number | null;
  conditioned: boolean; note: string | null;
  differences: PairedDifference[];
};
export type PairedStation = { id: string; label: string; presence: 'both' | 'baseline-only' | 'candidate-only'; metrics: PairedMetric[] };
export type PairResult =
  | { ok: true; metrics: PairedMetric[]; stations: PairedStation[]; completion: { baselineCapped: number; candidateCapped: number } }
  | { ok: false; code: 'INCOMPLETE_RESULTS' | 'MODEL_VERSION_MISMATCH' | 'SEED_MISMATCH' | 'HORIZON_MISMATCH'; message: string };

const STATION_UNITS: Record<StationMetricKey, { unit: Unit; population: Population }> = {
  utilization: { unit: 'ratio', population: 'closingWindow' },
  averageQueueLength: { unit: 'people', population: 'closingWindow' },
  maxQueueLength: { unit: 'people', population: 'closingWindow' },
  served: { unit: 'count', population: 'closingWindow' },
};

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const mean = (values: number[]): number => values.reduce((total, value) => total + value, 0) / values.length;

type Side = { values: (number | null)[] };

function buildMetric(args: {
  key: string; label: string; unit: Unit; population: Population; direction: Direction;
  baseline: Side; candidate: Side; cappedBaseline: number; cappedCandidate: number;
}): PairedMetric {
  const differences: PairedDifference[] = REPLICATION_INDICES.map((replication) => {
    const b = args.baseline.values[replication] ?? null;
    const c = args.candidate.values[replication] ?? null;
    return { replication, baseline: b, candidate: c, difference: b !== null && c !== null ? c - b : null };
  });
  const paired = differences.filter((d) => d.difference !== null);
  const n = paired.length;
  const sorted = paired.map((d) => d.difference as number).sort((a, b) => a - b);
  const baselineMean = n === 0 ? null : mean(paired.map((d) => d.baseline as number));
  const candidateMean = n === 0 ? null : mean(paired.map((d) => d.candidate as number));
  const counted = args.direction !== 'none';
  const better = (d: number): boolean => (args.direction === 'lower' ? d < 0 : d > 0);
  const worse = (d: number): boolean => (args.direction === 'lower' ? d > 0 : d < 0);
  const conditioned = args.population === 'completedJourney' && args.cappedBaseline + args.cappedCandidate > 0;
  return {
    key: args.key, label: args.label, unit: args.unit, population: args.population, betterDirection: args.direction,
    baselineMean, candidateMean,
    meanChange: baselineMean === null || candidateMean === null ? null : candidateMean - baselineMean,
    rangeP10: percentile(sorted, 0.1), rangeP90: percentile(sorted, 0.9),
    rangeLabel: RANGE_LABEL,
    n,
    improved: counted ? sorted.filter(better).length : null,
    worsened: counted ? sorted.filter(worse).length : null,
    unchanged: counted ? sorted.filter((d) => d === 0).length : null,
    conditioned,
    note: conditioned
      ? `${args.cappedBaseline} of ${REPLICATIONS} baseline runs and ${args.cappedCandidate} of ${REPLICATIONS} candidate runs hit the drain cap; completed-journey metrics count completed attendees only`
      : null,
    differences,
  };
}

function checkSide(name: string, results: RunResult[]): PairResult | null {
  const present = new Set(results.map((r) => r.replication).filter((r) => Number.isInteger(r) && r >= 0 && r < REPLICATIONS));
  if (results.length !== REPLICATIONS || present.size !== REPLICATIONS) {
    return {
      ok: false, code: 'INCOMPLETE_RESULTS',
      message: `${name} has results for ${present.size} of ${REPLICATIONS} replications; rerun the comparison.`,
    };
  }
  if (results.some((r, i) => r.replication !== i)) {
    return { ok: false, code: 'INCOMPLETE_RESULTS', message: `${name} results are not in replication order; rerun the comparison.` };
  }
  return null;
}
/** Paired differences (candidate − baseline) per replication for every metric, with the labeled empirical range. */
export function pairResults(
  baseline: RunResult[],
  candidate: RunResult[],
  stations: { baseline: Station[]; candidate: Station[] },
): PairResult {
  const incomplete = checkSide('Baseline', baseline) ?? checkSide('Candidate', candidate);
  if (incomplete !== null) return incomplete;
  const all = [...baseline, ...candidate];
  const first = all[0] as RunResult;
  if (all.some((r) => r.modelVersion !== first.modelVersion)) {
    return { ok: false, code: 'MODEL_VERSION_MISMATCH', message: 'The 60 results come from different model versions; rerun the comparison.' };
  }
  if (all.some((r) => r.baseSeed !== first.baseSeed)) {
    return { ok: false, code: 'SEED_MISMATCH', message: 'The 60 results use different seeds; rerun the comparison.' };
  }
  if (all.some((r) => r.horizonMs !== first.horizonMs)) {
    return { ok: false, code: 'HORIZON_MISMATCH', message: 'The 60 results use different observation windows; rerun the comparison.' };
  }

  const baselineCapped = baseline.filter((r) => r.completion === 'drain-capped').length;
  const candidateCapped = candidate.filter((r) => r.completion === 'drain-capped').length;
  const capped = { cappedBaseline: baselineCapped, cappedCandidate: candidateCapped };

  const metrics = METRIC_KEYS.map(({ key, label, direction }) => {
    const sample = readMetric(first.metrics, key);
    return buildMetric({
      key, label, direction, unit: sample.unit, population: sample.population,
      baseline: { values: baseline.map((r) => readMetric(r.metrics, key).value) },
      candidate: { values: candidate.map((r) => readMetric(r.metrics, key).value) },
      ...capped,
    });
  });

  const baselineIds = new Set(stations.baseline.map((s) => s.id));
  const candidateIds = new Set(stations.candidate.map((s) => s.id));
  const ids = [...new Set([...baselineIds, ...candidateIds])].sort(byCodeUnit);
  const pairedStations = ids.map((id): PairedStation => {
    const inBaseline = baselineIds.has(id);
    const inCandidate = candidateIds.has(id);
    const label = (stations.baseline.find((s) => s.id === id) ?? stations.candidate.find((s) => s.id === id))?.label ?? id;
    return {
      id, label,
      presence: inBaseline && inCandidate ? 'both' : inBaseline ? 'baseline-only' : 'candidate-only',
      metrics: STATION_METRIC_KEYS.map(({ key, label: metricLabel, direction }) =>
        buildMetric({
          key: `stations.${id}.${key}`, label: metricLabel, direction, ...STATION_UNITS[key],
          baseline: { values: baseline.map((r) => (inBaseline ? readStationMetric(r.metrics, id, key)?.value ?? null : null)) },
          candidate: { values: candidate.map((r) => (inCandidate ? readStationMetric(r.metrics, id, key)?.value ?? null : null)) },
          ...capped,
        })),
    };
  });

  return { ok: true, metrics, stations: pairedStations, completion: { baselineCapped, candidateCapped } };
}

function signed(text: string, value: number): string {
  return value > 0 ? `+${text}` : text;
}

/** A paired change in display units with an ASCII sign; an exact zero reads "(no change)". */
export function formatChange(value: number | null, unit: Unit): string {
  if (value === null) return EMPTY_VALUE;
  let text: string;
  switch (unit) {
    case 'ms': text = `${(value / 1000).toFixed(1)} s`; break;
    case 'ratio': text = `${(value * 100).toFixed(1)} percentage points`; break;
    case 'hours': text = `${value.toFixed(2)} h`; break;
    default: text = Number.isInteger(value) ? String(value) : value.toFixed(1); break;
  }
  return value === 0 ? `${text} (no change)` : signed(text, value);
}

/** A mean in display units through the engine's formatter; `—` for null. */
export function formatMean(value: number | null, unit: Unit): string {
  return formatMetricValue({ value, unit, population: 'admitted', n: 0, conditioned: false, note: null });
}
