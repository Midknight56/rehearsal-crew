import { scenarioHash } from '../domain/hash';
import type { Scenario } from '../domain/scenario';
import { validateScenario } from '../domain/validate';
import type { RunResult } from '../simulation/simulate';
import type { RunOutcome, SimulationClient } from '../workers/client';
import { buildComparison, type Comparison } from './comparison';
import { formatMinutes } from './format';
import { buildReplaySelection } from './replay-contract';
import { REPLICATIONS, REPLICATION_INDICES } from './replications';

export type ComparisonErrorCode = 'SEED_MISMATCH' | 'HORIZON_MISMATCH' | 'INVALID_SCENARIO' | 'RUN_FAILED' | 'NONDETERMINISTIC' | 'INCOMPLETE_RESULTS';
export type ComparisonOutcome =
  | { status: 'complete'; comparison: Comparison }
  | { status: 'cancelled'; message: 'Comparison cancelled.' }
  | { status: 'error'; code: ComparisonErrorCode; message: string };
export type RunnerClock = { now: () => number; isoNow: () => string };
export type RunnerOptions = { replayReplication?: number; onProgress?: (done: number, total: number) => void; clock?: RunnerClock };
export type ComparisonHandle = { done: Promise<ComparisonOutcome>; cancel(): void };
export type ReplicateOutcome =
  | { status: 'complete'; comparison: Comparison }
  | { status: 'cancelled'; message: 'Comparison cancelled.' }
  | { status: 'error'; code: ComparisonErrorCode; message: string };
export type ReplicateHandle = { done: Promise<ReplicateOutcome>; cancel(): void };

const CANCELLED = { status: 'cancelled', message: 'Comparison cancelled.' } as const;
const RANGE_MESSAGE = `Replication must be between 0 and ${REPLICATIONS - 1}.`;
/** 30 + 30 untraced replications and one traced replication on each side. */
const TOTAL_STEPS = 2 * REPLICATIONS + 2;

const defaultClock: RunnerClock = { now: () => performance.now(), isoNow: () => new Date().toISOString() };
const fail = (code: ComparisonErrorCode, message: string): { status: 'error'; code: ComparisonErrorCode; message: string } => ({ status: 'error', code, message });
const validReplication = (r: number): boolean => Number.isInteger(r) && r >= 0 && r < REPLICATIONS;

/** Runs client.run calls one after another and turns cancel() into an outcome. */
function createSequence(client: SimulationClient) {
  let cancelled = false;
  let active = false;
  return {
    cancel(): void {
      cancelled = true;
      if (active) client.cancel();
    },
    get cancelled(): boolean {
      return cancelled;
    },
    async run(
      scenario: Scenario, replications: number[], trace: boolean, onResult: () => void,
    ): Promise<{ ok: true; results: RunResult[] } | { ok: false; outcome: ReturnType<typeof fail> | typeof CANCELLED }> {
      if (cancelled) return { ok: false, outcome: CANCELLED };
      active = true;
      let outcome: RunOutcome;
      try {
        outcome = await client.run(scenario, replications, { trace, onResult }).done;
      } finally {
        active = false;
      }
      if (outcome.status === 'cancelled') return { ok: false, outcome: CANCELLED };
      if (outcome.status === 'error') return { ok: false, outcome: fail('RUN_FAILED', `Comparison failed: ${outcome.message}`) };
      return { ok: true, results: outcome.results };
    },
  };
}

const sameMetrics = (a: RunResult, b: RunResult): boolean => JSON.stringify(a.metrics) === JSON.stringify(b.metrics);
const nondeterministic = (r: number) =>
  fail('NONDETERMINISTIC', `Traced and untraced runs of replication ${r} disagree; this is an engine defect and nothing was shown.`);

function issueMessage(prefix: string, issues: { message: string }[]): string {
  const first = issues[0]?.message ?? 'Scenario is invalid.';
  return `${prefix}: ${first}${issues.length > 1 ? ` (+${issues.length - 1} more)` : ''}`;
}

export function runPairedComparison(client: SimulationClient, baseline: Scenario, candidate: Scenario, options: RunnerOptions = {}): ComparisonHandle {
  const sequence = createSequence(client);
  const clock = options.clock ?? defaultClock;
  const replay = options.replayReplication ?? 0;

  const done = (async (): Promise<ComparisonOutcome> => {
    const a = validateScenario(baseline);
    if (!a.ok) return fail('INVALID_SCENARIO', issueMessage('Baseline', a.issues));
    const b = validateScenario(candidate);
    if (!b.ok) return fail('INVALID_SCENARIO', issueMessage('Candidate', b.issues));
    if (!validReplication(replay)) return fail('RUN_FAILED', RANGE_MESSAGE);
    if (a.scenario.baseSeed !== b.scenario.baseSeed) {
      return fail('SEED_MISMATCH', `Baseline and candidate use different seeds ("${a.scenario.baseSeed}" and "${b.scenario.baseSeed}"); give both the same seed to compare them run for run.`);
    }
    if (a.scenario.horizonMs !== b.scenario.horizonMs) {
      return fail('HORIZON_MISMATCH', `Baseline and candidate use different observation windows (${formatMinutes(a.scenario.horizonMs)} and ${formatMinutes(b.scenario.horizonMs)}); give both the same window to compare closing-time numbers.`);
    }
    const baselineHash = await scenarioHash(a.scenario);
    const candidateHash = await scenarioHash(b.scenario);

    // The worker throttles its own progress messages, so progress is counted from each delivered result.
    let finished = 0;
    options.onProgress?.(0, TOTAL_STEPS);
    const tick = (): void => {
      finished += 1;
      options.onProgress?.(finished, TOTAL_STEPS);
    };

    const started = clock.now();
    const untracedBaseline = await sequence.run(a.scenario, [...REPLICATION_INDICES], false, tick);
    if (!untracedBaseline.ok) return untracedBaseline.outcome;
    const untracedCandidate = await sequence.run(b.scenario, [...REPLICATION_INDICES], false, tick);
    if (!untracedCandidate.ok) return untracedCandidate.outcome;
    const pairedMs = clock.now() - started;

    const replayStarted = clock.now();
    const tracedBaseline = await sequence.run(a.scenario, [replay], true, tick);
    if (!tracedBaseline.ok) return tracedBaseline.outcome;
    const tracedCandidate = await sequence.run(b.scenario, [replay], true, tick);
    if (!tracedCandidate.ok) return tracedCandidate.outcome;
    const replayMs = clock.now() - replayStarted;

    const left = tracedBaseline.results[0];
    const right = tracedCandidate.results[0];
    const untracedLeft = untracedBaseline.results[replay];
    const untracedRight = untracedCandidate.results[replay];
    if (left === undefined || right === undefined || untracedLeft === undefined || untracedRight === undefined) {
      return fail('INCOMPLETE_RESULTS', 'A run returned fewer results than were requested; rerun the comparison.');
    }
    if (!sameMetrics(left, untracedLeft) || !sameMetrics(right, untracedRight)) return nondeterministic(replay);

    try {
      return {
        status: 'complete',
        comparison: buildComparison({
          baseline: a.scenario, candidate: b.scenario, baselineHash, candidateHash,
          baselineResults: untracedBaseline.results, candidateResults: untracedCandidate.results,
          baselineReplay: left, candidateReplay: right, replayReplication: replay,
          timing: { pairedMs, replayMs }, createdAt: clock.isoNow(),
        }),
      };
    } catch (error) {
      return fail('INCOMPLETE_RESULTS', error instanceof Error ? error.message : 'The results could not be paired; rerun the comparison.');
    }
  })();

  return { done, cancel: () => sequence.cancel() };
}

/** Loads the traces of replication `r` and returns a new Comparison with the replay switched; the input is not changed. */
export function selectReplicate(
  client: SimulationClient,
  comparison: Comparison,
  r: number,
  options: Pick<RunnerOptions, 'onProgress' | 'clock'> = {},
): ReplicateHandle {
  const sequence = createSequence(client);
  const clock = options.clock ?? defaultClock;

  const done = (async (): Promise<ReplicateOutcome> => {
    if (!validReplication(r)) return fail('RUN_FAILED', RANGE_MESSAGE);
    const have = { baseline: comparison.traced.baseline[r], candidate: comparison.traced.candidate[r] };
    let left = have.baseline;
    let right = have.candidate;
    const started = clock.now();
    if (left === undefined || right === undefined) {
      let finished = 0;
      options.onProgress?.(0, 2);
      const tick = (): void => {
        finished += 1;
        options.onProgress?.(finished, 2);
      };
      const first = await sequence.run(comparison.baselineScenario, [r], true, tick);
      if (!first.ok) return first.outcome;
      const second = await sequence.run(comparison.candidateScenario, [r], true, tick);
      if (!second.ok) return second.outcome;
      left = first.results[0];
      right = second.results[0];
      const untracedLeft = comparison.baselineResults[r];
      const untracedRight = comparison.candidateResults[r];
      if (left === undefined || right === undefined || untracedLeft === undefined || untracedRight === undefined) {
        return fail('INCOMPLETE_RESULTS', 'A run returned fewer results than were requested; rerun the comparison.');
      }
      if (!sameMetrics(left, untracedLeft) || !sameMetrics(right, untracedRight)) return nondeterministic(r);
    }
    return {
      status: 'complete',
      comparison: {
        ...comparison,
        traced: {
          baseline: { ...comparison.traced.baseline, [r]: left },
          candidate: { ...comparison.traced.candidate, [r]: right },
        },
        replay: buildReplaySelection(left, right, r),
        timing: have.baseline !== undefined && have.candidate !== undefined ? comparison.timing : { ...comparison.timing, replayMs: clock.now() - started },
      },
    };
  })();

  return { done, cancel: () => sequence.cancel() };
}
