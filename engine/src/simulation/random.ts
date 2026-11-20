// The only file that imports seedrandom 3.0.5. Import form: default import (`import seedrandom from 'seedrandom'`),
// which typechecks under TypeScript 7 strict settings with moduleResolution Bundler and @types/seedrandom 3.0.8.
import seedrandom from 'seedrandom';

export type Generator = () => number; // uniform in [0, 1)

/** A new ARC4 stream seeded by the key alone; no entropy, no global state. */
export function createGenerator(key: string): Generator {
  return seedrandom(key);
}

export function serviceKey(baseSeed: string, replication: number, attendeeId: string, stationId: string): string {
  return `${baseSeed}|${replication}|${attendeeId}|${stationId}|service`;
}

export function arrivalKey(baseSeed: string, replication: number, attendeeId: string): string {
  return `${baseSeed}|${replication}|${attendeeId}|arrival`;
}
