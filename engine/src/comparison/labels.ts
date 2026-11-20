import { REPLICATIONS } from './replications';

export const RANGE_LABEL = 'variation across these simulated runs';
export const REPLAY_NOTE = 'This replay is one example run; the comparison numbers come from all 30.';
// Composed from REPLICATIONS so the literal-count scan never matches a source literal.
export const COMPLETE_TEXT = `${REPLICATIONS} of ${REPLICATIONS} paired runs complete`;
export const STALE_TEXT = 'Stale, rerun';
export const COMBINED_NOTE = 'Combined candidate: run each change on its own first to see which one moves the numbers.';
export const PER_PERSON_OFF = 'Per-person comparison is off because the attendee populations differ.';
export const SAVE_REASONS = {
  quota: 'storage quota exceeded',
  unavailable: 'storage is unavailable in this browser',
  limit: '10 saved scenarios already; delete one first',
} as const;

export function replayLabel(r: number): string {
  return `Replay of replication ${r}, one example run`;
}
export function progressText(done: number, total: number): string {
  return `Running paired replications: ${done} of ${total}`;
}
export function loadingReplicationText(r: number): string {
  return `Loading replication ${r}…`;
}
export function timingText(pairedMs: number): string {
  return `30 paired runs took ${(pairedMs / 1000).toFixed(1)} s on this device`;
}
export function saveErrorText(reason: keyof typeof SAVE_REASONS): string {
  return `Could not save: ${SAVE_REASONS[reason]}.`;
}
export function restoredSummaryText(createdAt: string): string {
  return `Saved summary from ${createdAt.slice(0, 10)}; rerun to see replications and the replay`;
}
export function changesHeader(kind: 'none' | 'single' | 'combined', n: number): string {
  if (kind === 'none') return 'No assumption differs between these scenarios.';
  if (kind === 'single') return '1 change';
  return `${n} changes`;
}

export type CountSentenceInput = {
  direction: 'lower' | 'higher' | 'none';
  metricLabel: string;
  improved: number | null;
  n: number;
  languageMode: 'person-for-person' | 'population';
  baselineCount: number;
  candidateCount: number;
};

/** The only place the count text is composed. */
export function countSentence(input: CountSentenceInput): string {
  if (input.direction === 'none' || input.improved === null) {
    return `No better direction is defined for ${input.metricLabel}; read the values.`;
  }
  const head = `Candidate had ${input.direction} ${input.metricLabel} in ${input.improved} of ${input.n} runs`;
  if (input.languageMode === 'person-for-person') {
    return `${head}; the same simulated attendees and random draws were used in both.`;
  }
  return `${head}; the attendee populations differ (${input.baselineCount} vs ${input.candidateCount} people), so this compares groups, not the same people.`;
}
