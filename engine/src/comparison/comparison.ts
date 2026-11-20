import type { Scenario } from '../domain/scenario';
import type { RunResult } from '../simulation/simulate';
import { diffScenarios, type AssumptionsDiff } from './diff';
import { pairResults, type PairedMetric, type PairedStation } from './paired';
import { populationChange, type PopulationChange } from './population';
import { buildReplaySelection, type ReplaySelection } from './replay-contract';
import { REPLICATION_INDICES } from './replications';

export type ScenarioRef = { id: string; title: string; revision: number; scenarioHash: string };
export type Comparison = {
  schemaVersion: 1; key: string; createdAt: string;
  modelVersion: string; baseSeed: string; horizonMs: number; replications: readonly number[];
  baseline: ScenarioRef; candidate: ScenarioRef;
  baselineScenario: Scenario; candidateScenario: Scenario;
  baselineResults: RunResult[]; candidateResults: RunResult[];
  traced: { baseline: Record<number, RunResult>; candidate: Record<number, RunResult> };
  replay: ReplaySelection;
  diff: AssumptionsDiff; population: PopulationChange; languageMode: 'person-for-person' | 'population';
  metrics: PairedMetric[]; stations: PairedStation[];
  completion: { baselineCapped: number; candidateCapped: number };
  timing: { pairedMs: number; replayMs: number };
};

export type BuildComparisonInput = {
  baseline: Scenario; candidate: Scenario; baselineHash: string; candidateHash: string;
  baselineResults: RunResult[]; candidateResults: RunResult[];
  baselineReplay: RunResult; candidateReplay: RunResult; replayReplication: number;
  timing: Comparison['timing']; createdAt: string;
};

export function comparisonKey(c: Pick<Comparison, 'modelVersion' | 'baseSeed' | 'baseline' | 'candidate' | 'replications'>): string {
  return `${c.modelVersion}|${c.baseSeed}|${c.baseline.scenarioHash}|${c.candidate.scenarioHash}|${c.replications.length}`;
}

const refOf = (scenario: Scenario, scenarioHash: string): ScenarioRef => ({
  id: scenario.id, title: scenario.title, revision: scenario.revision, scenarioHash,
});

/** Assembles the immutable record. Throws the `pairResults` message when the 60 results do not pair. */
export function buildComparison(input: BuildComparisonInput): Comparison {
  const paired = pairResults(input.baselineResults, input.candidateResults, {
    baseline: input.baseline.stations,
    candidate: input.candidate.stations,
  });
  if (!paired.ok) throw new Error(paired.message);
  const first = input.baselineResults[0] as RunResult;
  const baseline = refOf(input.baseline, input.baselineHash);
  const candidate = refOf(input.candidate, input.candidateHash);
  const population = populationChange(input.baseline, input.candidate);
  const parts = { modelVersion: first.modelVersion, baseSeed: first.baseSeed, baseline, candidate, replications: REPLICATION_INDICES };
  return {
    schemaVersion: 1,
    key: comparisonKey(parts),
    createdAt: input.createdAt,
    ...parts,
    horizonMs: first.horizonMs,
    baselineScenario: input.baseline,
    candidateScenario: input.candidate,
    baselineResults: input.baselineResults,
    candidateResults: input.candidateResults,
    traced: {
      baseline: { [input.replayReplication]: input.baselineReplay },
      candidate: { [input.replayReplication]: input.candidateReplay },
    },
    replay: buildReplaySelection(input.baselineReplay, input.candidateReplay, input.replayReplication),
    diff: diffScenarios(input.baseline, input.candidate),
    population,
    languageMode: population.changed ? 'population' : 'person-for-person',
    metrics: paired.metrics,
    stations: paired.stations,
    completion: paired.completion,
    timing: input.timing,
  };
}
/** True while both scenarios still hash to the values the comparison was built from. */
export function isComparisonCurrent(c: Comparison, baselineHashNow: string, candidateHashNow: string): boolean {
  return c.baseline.scenarioHash === baselineHashNow && c.candidate.scenarioHash === candidateHashNow;
}
