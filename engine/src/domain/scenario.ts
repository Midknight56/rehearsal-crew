import { z } from 'zod';

export type Cell = [number, number]; // [x, y]; x grows east, y grows south
export type Service =
  | { kind: 'constant'; seconds: number }
  | { kind: 'triangular'; minS: number; modeS: number; maxS: number };
export type Station = { id: string; label: string; cell: Cell; servers: number; service: Service };
export type Cohort = { id: string; startMs: number; endMs: number; count: number; arrivals: 'even' | 'uniform'; route: string[] };
export type Layout = { cols: number; rows: number; cellSizeM: number; blockedCells: Cell[]; entrance: Cell; exit: Cell };
export type Scenario = {
  schemaVersion: 1; id: string; revision: number; title: string;
  modelVersion: string; baseSeed: string; horizonMs: number;
  layout: Layout; walkSpeedMps: number; stations: Station[]; cohorts: Cohort[]; notes: string;
};

// Structural check only; limits live in validate.ts. Numbers are accepted when typeof is number (so NaN and
// Infinity reach validation, which reports them as NON_FINITE); strings that carry meaning (arrivals, service kind)
// are checked by validation with their own codes.
const num = z.custom<number>((value) => typeof value === 'number');
const cell = z.tuple([num, num]);
const service = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('constant'), seconds: num }),
  z.object({ kind: z.literal('triangular'), minS: num, modeS: num, maxS: num }),
]);

export const ScenarioSchema: z.ZodType<Scenario> = z.object({
  schemaVersion: z.custom<1>((value) => typeof value === 'number'),
  id: z.string(),
  revision: num,
  title: z.string(),
  modelVersion: z.string(),
  baseSeed: z.string(),
  horizonMs: num,
  layout: z.object({
    cols: num,
    rows: num,
    cellSizeM: num,
    blockedCells: z.array(cell),
    entrance: cell,
    exit: cell,
  }),
  walkSpeedMps: num,
  stations: z.array(z.object({ id: z.string(), label: z.string(), cell, servers: num, service })),
  cohorts: z.array(z.object({
    id: z.string(),
    startMs: num,
    endMs: num,
    count: num,
    arrivals: z.custom<'even' | 'uniform'>((value) => typeof value === 'string'),
    route: z.array(z.string()),
  })),
  notes: z.string(),
});
