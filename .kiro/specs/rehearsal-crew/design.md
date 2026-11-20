# Design: rehearsal-crew

## Layout
- `engine/src/...` copy of Rehearsal `domain`, `simulation`, `spatial`, `comparison`, and `workers/client.ts` with `workers/protocol.ts` (the client file imports it). `engine/SOURCE.md`, `engine/LICENSE`.
- `examples/` three scenario JSON files.
- `mcp/text.ts` limits sentence and wording. `mcp/node-client.ts` the in-process `SimulationClient`. `mcp/source.ts` loads a scenario with path and size rules. `mcp/tools.ts` the five handlers, built by `createTools({ workDir, examplesDir })`. `mcp/server.ts` registers them with zod schemas on a stdio transport.
- `tools/build.mjs` esbuild to `dist/server.mjs`. `tools/sync-engine.mjs`. `tools/check-manifest.mjs`.
- `agents/rehearsal-whatif.json`, `skills/rehearsal-whatif/SKILL.md`, `app.json`.
- `tests/*.test.mjs` use `node:test`. Tests of the engine and the handlers bundle the TypeScript with esbuild into a temporary folder and import it. The process test starts `dist/server.mjs`.

## Decisions
- A scenario input is one string: an example id, else text starting with `{` as JSON text, else a path. Paths must end in `.json`, resolve through `realpath`, and lie inside the working folder or the examples folder. Size is checked with `stat` before the read, and the length of JSON text is checked too.
- Handlers return `{ ok, value }` or `{ ok: false, error, message }`. The server turns the second into an MCP error result.
- `compare_plans` calls `runPairedComparison` and reads `Comparison.metrics`. The headline is the `queueWait.mean` metric: `meanChange` in seconds, and `improved` as the count of lower runs.
- `what_if_add_servers` clones the validated scenario and changes `servers` of one station. Title and id stay, so only the hash differs. The hash ignores id and title, so the candidate hash equals that of the bundled plus-one-checkin file.
- Metrics are listed from the engine's `METRIC_KEYS` (eleven keys), with per-station metrics beside them.
- The manifest page says `mcpServers` entries are not path checked. `args` is `["dist/server.mjs"]` and is handed to `node` as written. Whether Crew starts the process in the app folder is not stated on the page.

## Errors
Plain sentences, no stack. Engine validation messages are passed through.
