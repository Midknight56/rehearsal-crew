import { z } from 'zod';
import { ScenarioSchema, type Scenario } from '../domain/scenario';
import type { RunResult } from '../simulation/simulate';

export type ToWorker =
  | { type: 'run'; runId: number; scenario: Scenario; replications: number[]; trace: boolean }
  | { type: 'cancel'; runId: number };
export type FromWorker =
  | { type: 'progress'; runId: number; done: number; total: number }
  | { type: 'result'; runId: number; replication: number; result: RunResult }
  | { type: 'cancelled'; runId: number }
  | { type: 'error'; runId: number; message: string };

const runId = z.number().int().min(0);
const count = z.number().int().min(0);

/** Every key a RunResult carries at its top level; the envelope check does not walk metrics or the trace. */
const RUN_RESULT_KEYS = ['scenarioHash', 'modelVersion', 'baseSeed', 'replication', 'horizonMs', 'completion', 'unfinished', 'metrics'] as const;
const runResult = z.custom<RunResult>((value) => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return RUN_RESULT_KEYS.every((key) => key in record)
    && typeof record.scenarioHash === 'string'
    && (record.completion === 'complete' || record.completion === 'drain-capped')
    && Array.isArray(record.unfinished)
    && typeof record.metrics === 'object' && record.metrics !== null;
});

export const ToWorkerSchema: z.ZodType<ToWorker> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run'), runId, scenario: ScenarioSchema, replications: z.array(count), trace: z.boolean() }),
  z.object({ type: z.literal('cancel'), runId }),
]);

export const FromWorkerSchema: z.ZodType<FromWorker> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), runId, done: count, total: count }),
  z.object({ type: z.literal('result'), runId, replication: count, result: runResult }),
  z.object({ type: z.literal('cancelled'), runId }),
  z.object({ type: z.literal('error'), runId, message: z.string() }),
]);

export const PROGRESS_INTERVAL_MS = 200; // at most 5 progress messages per second
export const CANCEL_DEADLINE_MS = 250;