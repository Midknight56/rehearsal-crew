import { scenarioHash } from '../engine/src/domain/hash';
import type { Scenario } from '../engine/src/domain/scenario';
import { validateScenario } from '../engine/src/domain/validate';
import { simulate, type RunResult } from '../engine/src/simulation/simulate';
import type { RunCallbacks, RunHandle, RunOutcome, SimulationClient } from '../engine/src/workers/client';

/**
 * A SimulationClient for Node. It calls `simulate` in this process. No worker is started.
 * Cancel stops a run before its next replication.
 */
export function createNodeClient(): SimulationClient {
  let currentRunId = 0;
  let cancelActive: (() => void) | null = null;

  return {
    run(scenario: Scenario, replications: number[], options: { trace: boolean } & RunCallbacks): RunHandle {
      currentRunId += 1;
      const runId = currentRunId;
      let cancelled = false;
      cancelActive = () => {
        cancelled = true;
      };
      const done = (async (): Promise<RunOutcome> => {
        const validated = validateScenario(scenario);
        if (!validated.ok) return { status: 'error', message: validated.issues[0]?.message ?? 'Scenario is invalid.' };
        const hash = await scenarioHash(validated.scenario);
        const results: RunResult[] = [];
        for (const replication of replications) {
          if (cancelled) return { status: 'cancelled', message: 'Simulation cancelled.' };
          let result: RunResult;
          try {
            result = simulate(validated.scenario, replication, { trace: options.trace, scenarioHash: hash });
          } catch (error) {
            return { status: 'error', message: error instanceof Error ? error.message : String(error) };
          }
          results.push(result);
          options.onResult?.(result);
          options.onProgress?.(results.length, replications.length);
          // Let a cancel request run between replications.
          await Promise.resolve();
        }
        return { status: 'complete', results };
      })();
      return { runId, done };
    },
    cancel(): void {
      cancelActive?.();
      cancelActive = null;
      currentRunId += 1;
    },
    dispose(): void {
      cancelActive?.();
      cancelActive = null;
    },
    get currentRunId(): number {
      return currentRunId;
    },
    get discardedMessages(): number {
      return 0;
    },
  };
}
