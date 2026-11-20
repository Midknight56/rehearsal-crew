import type { RunResult } from '../simulation/simulate';
import type { Comparison } from './comparison';
import { replayLabel } from './labels';
import { REPLICATIONS } from './replications';

export type ReplaySelection = {
  replication: number; baseline: RunResult; candidate: RunResult;
  label: string;
  clock: { horizonMs: number; endMs: number };
};

const lastEventMs = (result: RunResult): number =>
  (result.trace?.events ?? []).reduce((max, event) => Math.max(max, event.timeMs), 0);

/** One labeled replicate on one clock; both results must carry a trace. */
export function buildReplaySelection(baseline: RunResult, candidate: RunResult, replication: number): ReplaySelection {
  if (baseline.trace === undefined || candidate.trace === undefined) {
    throw new Error('A replay needs a traced result on both sides.');
  }
  return {
    replication, baseline, candidate,
    label: replayLabel(replication),
    clock: { horizonMs: baseline.horizonMs, endMs: Math.max(lastEventMs(baseline), lastEventMs(candidate)) },
  };
}

export function selectReplay(comparison: Comparison, r: number):
  | { ok: true; selection: ReplaySelection }
  | { ok: false; code: 'REPLICATION_RANGE'; message: 'Replication must be between 0 and 29.' }
  | { ok: false; code: 'TRACE_NOT_LOADED'; message: string } {
  if (!Number.isInteger(r) || r < 0 || r >= REPLICATIONS) {
    return { ok: false, code: 'REPLICATION_RANGE', message: 'Replication must be between 0 and 29.' };
  }
  if (comparison.replay.replication === r) return { ok: true, selection: comparison.replay };
  const baseline = comparison.traced.baseline[r];
  const candidate = comparison.traced.candidate[r];
  if (baseline === undefined || candidate === undefined) {
    return { ok: false, code: 'TRACE_NOT_LOADED', message: `Replication ${r} has not been loaded for replay yet.` };
  }
  return { ok: true, selection: buildReplaySelection(baseline, candidate, r) };
}
export const GHOST_STYLE = { role: 'baseline', alpha: 0.45, outline: 'dashed', fill: 'hatched', hue: 'orange' } as const;
export const CANDIDATE_STYLE = { role: 'candidate', alpha: 1, outline: 'solid', fill: 'solid', hue: 'cyan' } as const;
export const GHOST_LEGEND = 'Baseline: dashed outline, hatched, translucent · Candidate: solid';
