import type { Scenario } from '../domain/scenario';
import type { RunResult } from '../simulation/simulate';
import { CANCEL_DEADLINE_MS, FromWorkerSchema, type ToWorker } from './protocol';

export type WorkerLike = {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
};
export type RunOutcome =
  | { status: 'complete'; results: RunResult[] }
  | { status: 'cancelled'; message: string }
  | { status: 'error'; message: string };
export type RunHandle = { runId: number; done: Promise<RunOutcome> };
export type RunCallbacks = { onProgress?: (done: number, total: number) => void; onResult?: (result: RunResult) => void };
export type SimulationClient = {
  run(scenario: Scenario, replications: number[], options: { trace: boolean } & RunCallbacks): RunHandle;
  cancel(): void;
  dispose(): void;
  readonly currentRunId: number;
  readonly discardedMessages: number;
};
export type ClientDeps = {
  createWorker: () => WorkerLike;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
};

const CANCELLED = 'Simulation cancelled.';
const RESTARTED = 'Simulation cancelled. The simulation worker did not respond within 250 ms and was restarted.';
const MALFORMED = 'Malformed worker message.';

type ActiveRun = {
  runId: number;
  total: number;
  results: RunResult[];
  callbacks: RunCallbacks;
  resolve: (outcome: RunOutcome) => void;
};
type PendingCancel = { run: ActiveRun; timer: ReturnType<typeof globalThis.setTimeout> };

/** The default worker: a Vite-resolvable module worker URL, so the build emits a chunk for simulation.worker.ts. */
function createDefaultWorker(): WorkerLike {
  return new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export function createSimulationClient(deps?: Partial<ClientDeps>): SimulationClient {
  const createWorker = deps?.createWorker ?? createDefaultWorker;
  const schedule = deps?.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const unschedule = deps?.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);

  let worker: WorkerLike | null = null;
  let currentRunId = 0;
  let discardedMessages = 0;
  let active: ActiveRun | null = null;
  const pendingCancels = new Map<number, PendingCancel>();

  function attach(created: WorkerLike): WorkerLike {
    created.onmessage = (event) => {
      if (worker === created) receive(event.data);
    };
    created.onerror = (event) => {
      if (worker === created) fail(event.message ?? 'message could not be delivered');
    };
    created.onmessageerror = () => {
      if (worker === created) fail('message could not be delivered');
    };
    return created;
  }

  function ensureWorker(): WorkerLike {
    if (worker === null) worker = attach(createWorker());
    return worker;
  }

  function restartWorker(): void {
    const old = worker;
    worker = null;
    old?.terminate();
    worker = attach(createWorker());
  }

  function finish(run: ActiveRun | null, outcome: RunOutcome): void {
    if (run === null) return;
    if (active === run) active = null;
    run.resolve(outcome);
  }

  function clearPendingCancels(outcome: RunOutcome): void {
    for (const pending of pendingCancels.values()) {
      unschedule(pending.timer);
      pending.run.resolve(outcome);
    }
    pendingCancels.clear();
  }

  /** onerror and onmessageerror: the pending run is an error, the worker is replaced, late messages become stale. */
  function fail(reason: string): void {
    const run = active;
    clearPendingCancels({ status: 'cancelled', message: CANCELLED });
    currentRunId += 1;
    finish(run, { status: 'error', message: `The simulation worker stopped unexpectedly: ${reason}.` });
    restartWorker();
  }

  function receive(data: unknown): void {
    const parsed = FromWorkerSchema.safeParse(data);
    if (!parsed.success) {
      discardedMessages += 1;
      return;
    }
    const message = parsed.data;

    if (message.type === 'cancelled') {
      const pending = pendingCancels.get(message.runId);
      if (pending === undefined) {
        discardedMessages += 1;
        return;
      }
      unschedule(pending.timer);
      pendingCancels.delete(message.runId);
      pending.run.resolve({ status: 'cancelled', message: CANCELLED });
      return;
    }

    if (message.type === 'error' && message.runId === 0) {
      const run = active;
      if (run === null) {
        discardedMessages += 1;
        return;
      }
      currentRunId += 1;
      finish(run, { status: 'error', message: MALFORMED });
      return;
    }

    if (message.runId !== currentRunId) {
      discardedMessages += 1;
      return;
    }
    // A progress message can follow the last result of the current run. The run has resolved and the message is not stale.
    if (active === null || message.runId !== active.runId) return;
    const run = active;
    if (message.type === 'progress') {
      run.callbacks.onProgress?.(message.done, message.total);
    } else if (message.type === 'result') {
      run.results.push(message.result);
      run.callbacks.onResult?.(message.result);
      if (run.results.length === run.total) finish(run, { status: 'complete', results: run.results });
    } else {
      finish(run, { status: 'error', message: message.message });
    }
  }

  function onCancelDeadline(runId: number): void {
    const pending = pendingCancels.get(runId);
    if (pending === undefined) return;
    // The worker did not answer: restart it, which also ends every other run it was serving.
    const lost = active;
    const outcome: RunOutcome = { status: 'cancelled', message: RESTARTED };
    clearPendingCancels(outcome);
    if (lost !== null) currentRunId += 1;
    finish(lost, outcome);
    restartWorker();
  }

  return {
    run(scenario, replications, options) {
      if (replications.length === 0) {
        return { runId: currentRunId, done: Promise.resolve({ status: 'complete', results: [] }) };
      }
      if (active !== null) finish(active, { status: 'cancelled', message: 'Simulation replaced by a newer run.' });
      currentRunId += 1;
      const runId = currentRunId;
      const done = new Promise<RunOutcome>((resolve) => {
        active = {
          runId,
          total: replications.length,
          results: [],
          callbacks: { onProgress: options.onProgress, onResult: options.onResult },
          resolve,
        };
      });
      const message: ToWorker = { type: 'run', runId, scenario, replications, trace: options.trace };
      ensureWorker().postMessage(message);
      return { runId, done };
    },

    cancel() {
      const run = active;
      if (run === null) return;
      active = null;
      currentRunId += 1;
      const message: ToWorker = { type: 'cancel', runId: run.runId };
      const timer = schedule(() => onCancelDeadline(run.runId), CANCEL_DEADLINE_MS);
      pendingCancels.set(run.runId, { run, timer });
      ensureWorker().postMessage(message);
    },

    dispose() {
      const run = active;
      active = null;
      clearPendingCancels({ status: 'cancelled', message: CANCELLED });
      finish(run, { status: 'cancelled', message: CANCELLED });
      const old = worker;
      worker = null;
      old?.terminate();
    },

    get currentRunId() {
      return currentRunId;
    },
    get discardedMessages() {
      return discardedMessages;
    },
  };
}
