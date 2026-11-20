import type { Scenario } from './scenario';

/** JSON with keys sorted at every object level; arrays keep the order they are given. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key]);
    return sorted;
  }
  return value;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Canonical JSON of every field except the top-level id, revision, title and notes (station and cohort
 * ids stay): keys sorted at every level, stations and cohorts by id, blockedCells by x then y.
 */
export function canonicalJson(scenario: Scenario): string {
  const { id: _id, revision: _revision, title: _title, notes: _notes, ...rest } = scenario;
  return stableJson({
    ...rest,
    layout: { ...rest.layout, blockedCells: [...rest.layout.blockedCells].sort((a, b) => a[0] - b[0] || a[1] - b[1]) },
    stations: [...rest.stations].sort((a, b) => byCodeUnit(a.id, b.id)),
    cohorts: [...rest.cohorts].sort((a, b) => byCodeUnit(a.id, b.id)),
  });
}

/** Lowercase hex SHA-256 of the UTF-8 bytes of canonicalJson. */
export async function scenarioHash(scenario: Scenario): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(scenario));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}