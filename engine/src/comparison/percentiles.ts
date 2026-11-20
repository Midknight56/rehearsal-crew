/** Index of the p-th percentile in an ascending array of n values: max(0, ceil(p·n) − 1). The engine's p95 rule. */
export function percentileIndex(p: number, n: number): number {
  return Math.max(0, Math.ceil(p * n) - 1);
}

/** The p-th percentile of an already-ascending array, or null for an empty array. */
export function percentile(sortedAscending: readonly number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  return sortedAscending[percentileIndex(p, sortedAscending.length)] as number;
}
