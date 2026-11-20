import { z } from 'zod';
import type { Comparison, ScenarioRef } from './comparison';
import type { AssumptionsDiff } from './diff';
import { RANGE_LABEL } from './labels';
import type { PairedMetric, PairedStation } from './paired';
import type { PopulationChange } from './population';

export const COMPARISON_SUMMARY_MAX_BYTES = 32_768;
export const SAVED_SCENARIO_LIMIT = 10;

export type SummaryMetric = Omit<PairedMetric, 'differences'>;
export type ComparisonSummary = {
  schemaVersion: 1; key: string; createdAt: string;
  modelVersion: string; baseSeed: string; horizonMs: number; replications: 30;
  baseline: ScenarioRef; candidate: ScenarioRef;
  diff: AssumptionsDiff; population: PopulationChange; languageMode: Comparison['languageMode'];
  metrics: SummaryMetric[];
  stations: { id: string; label: string; presence: PairedStation['presence']; metrics: SummaryMetric[] }[];
  completion: Comparison['completion']; replay: { replication: number }; timing: Comparison['timing'];
};

const nullableNumber = z.number().nullable();
const nullableCount = z.number().int().nullable();
const scenarioRef = z.object({ id: z.string(), title: z.string(), revision: z.number(), scenarioHash: z.string() });
const population = z.object({ changed: z.boolean(), baselineCount: z.number(), candidateCount: z.number(), details: z.array(z.string()) });
const changeEntry = z.object({
  path: z.string(),
  group: z.enum(['population', 'staffing', 'service', 'layout', 'arrivals', 'timing', 'route', 'derived']),
  label: z.string(), before: z.string(), after: z.string(), text: z.string(), highlight: z.boolean(), derived: z.boolean(),
});
const summaryMetric = z.object({
  key: z.string(), label: z.string(),
  unit: z.enum(['count', 'ms', 'ratio', 'people', 'hours']),
  population: z.enum(['admitted', 'completedJourney', 'closingWindow']),
  betterDirection: z.enum(['lower', 'higher', 'none']),
  baselineMean: nullableNumber, candidateMean: nullableNumber, meanChange: nullableNumber, rangeP10: nullableNumber, rangeP90: nullableNumber,
  rangeLabel: z.literal(RANGE_LABEL),
  n: z.number().int().min(0), improved: nullableCount, worsened: nullableCount, unchanged: nullableCount,
  conditioned: z.boolean(), note: z.string().nullable(),
});

export const ComparisonSummarySchema: z.ZodType<ComparisonSummary> = z.object({
  schemaVersion: z.literal(1),
  key: z.string(), createdAt: z.string(),
  modelVersion: z.string(), baseSeed: z.string(), horizonMs: z.number(), replications: z.literal(30),
  baseline: scenarioRef, candidate: scenarioRef,
  diff: z.object({ changes: z.array(changeEntry), kind: z.enum(['none', 'single', 'combined']), population }),
  population,
  languageMode: z.enum(['person-for-person', 'population']),
  metrics: z.array(summaryMetric),
  stations: z.array(z.object({
    id: z.string(), label: z.string(), presence: z.enum(['both', 'baseline-only', 'candidate-only']), metrics: z.array(summaryMetric),
  })),
  completion: z.object({ baselineCapped: z.number(), candidateCapped: z.number() }),
  replay: z.object({ replication: z.number().int().min(0).max(29) }),
  timing: z.object({ pairedMs: z.number(), replayMs: z.number() }),
});

const stripDifferences = (metric: PairedMetric): SummaryMetric => {
  const { differences: _differences, ...rest } = metric;
  return rest;
};

/** The stored form: no scenarios, no result arrays, no traces and no per-replication differences. */
export function toComparisonSummary(c: Comparison): ComparisonSummary {
  return {
    schemaVersion: 1,
    key: c.key,
    createdAt: c.createdAt,
    modelVersion: c.modelVersion,
    baseSeed: c.baseSeed,
    horizonMs: c.horizonMs,
    replications: 30,
    baseline: c.baseline,
    candidate: c.candidate,
    diff: c.diff,
    population: c.population,
    languageMode: c.languageMode,
    metrics: c.metrics.map(stripDifferences),
    stations: c.stations.map((s) => ({ id: s.id, label: s.label, presence: s.presence, metrics: s.metrics.map(stripDifferences) })),
    completion: c.completion,
    replay: { replication: c.replay.replication },
    timing: c.timing,
  };
}

export function summaryBytes(s: ComparisonSummary): number {
  return new TextEncoder().encode(JSON.stringify(s)).length;
}

export function fromComparisonSummary(json: string):
  | { ok: true; summary: ComparisonSummary; restored: true }
  | { ok: false; code: 'SUMMARY_INVALID'; message: 'The saved comparison summary could not be read; rerun the comparison.' } {
  const invalid = { ok: false, code: 'SUMMARY_INVALID', message: 'The saved comparison summary could not be read; rerun the comparison.' } as const;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return invalid;
  }
  const checked = ComparisonSummarySchema.safeParse(parsed);
  return checked.success ? { ok: true, summary: checked.data, restored: true } : invalid;
}
