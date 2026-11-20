import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createTools } from './tools';
import type { Result } from './text';

const scenarioText =
  'A scenario: an example id (baseline, plus-one-checkin or shorter-route), a path to a .json file inside the working folder, or the JSON text of a scenario. A file larger than 2 MiB is refused.';

/** Standard output is kept for MCP messages, so problems go to standard error. */
function stop(message: string): never {
  process.stderr.write(`rehearsal-crew: ${message}\n`);
  process.exit(1);
}

function answer(result: Result<Record<string, unknown>>) {
  if (result.ok) return { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] };
  const { ok: _ok, ...rest } = result;
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(rest) }] };
}

function guarded<T>(handler: (input: T) => Promise<Result<Record<string, unknown>>>) {
  return async (input: T) => {
    try {
      return answer(await handler(input));
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      return answer({ ok: false, error: 'internal_error', message: 'The tool failed. The details are on standard error.' });
    }
  };
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tools = createTools({ workDir: process.cwd(), examplesDir: path.resolve(here, '..', 'examples') });
  const server = new McpServer({ name: 'rehearsal-engine', version: '0.1.0' });

  server.registerTool('list_examples', {
    description: 'List the three bundled Harbor Hall scenarios with their id, title and one line each. They are fictional and illustrative.',
    inputSchema: {},
  }, guarded(() => tools.list_examples()));

  server.registerTool('describe_scenario', {
    description: 'Check a scenario with the real engine validation and describe it: stations, servers, service times in seconds, cohorts, attendee count, seed and horizon. A scenario that is not valid gets the engine messages. Changes nothing.',
    inputSchema: { scenario: z.string().min(1).describe(scenarioText) },
  }, guarded((input: { scenario: string }) => tools.describe_scenario(input)));

  server.registerTool('run_scenario', {
    description: 'Run one replication of one scenario through the real engine. Returns the metrics of that run with their units, the scenario hash and the model version. One run is an example, not an average.',
    inputSchema: {
      scenario: z.string().min(1).describe(scenarioText),
      replication: z.number().int().min(0).max(29).describe('Replication number, a whole number from 0 to 29.'),
    },
  }, guarded((input: { scenario: string; replication: number }) => tools.run_scenario(input)));

  server.registerTool('compare_plans', {
    description: 'Run 30 paired replications of a baseline and a candidate through the real engine, with the same seed and replication numbers on both sides. Returns the change in mean queue wait in seconds with the count of runs that were lower, and for every metric the paired mean change, n, improved and worsened. A change is candidate minus baseline.',
    inputSchema: {
      baseline: z.string().min(1).describe(scenarioText),
      candidate: z.string().min(1).describe(scenarioText),
    },
  }, guarded((input: { baseline: string; candidate: string }) => tools.compare_plans(input)));

  server.registerTool('what_if_add_servers', {
    description: 'Add servers to one station and compare with paired runs. The candidate is the scenario with only that station server count changed. Returns the exact change made and the same answer as compare_plans. The station can have at most 20 servers.',
    inputSchema: {
      scenario: z.string().min(1).describe(scenarioText),
      stationId: z.string().min(1).describe('The id of the station, for example checkin. describe_scenario lists the ids.'),
      addServers: z.number().int().min(1).max(19).describe('How many servers to add, a whole number from 1 to 19.'),
    },
  }, guarded((input: { scenario: string; stationId: string; addServers: number }) => tools.what_if_add_servers(input)));

  process.stdin.on('end', () => {
    void server.close().then(() => process.exit(0));
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  stop(`unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
});
