# Requirements: rehearsal-crew

A Kiro Crew app. A Crew agent answers a what if question by running the real Rehearsal simulation engine in Node with paired runs, and reports the measured numbers.

## 1. Engine copy
As a maintainer, I want the engine source inside the app, so that the answers come from the real engine.
1. THE SYSTEM SHALL hold a copy of the Rehearsal engine source under `engine/src`, unchanged byte for byte.
2. THE SYSTEM SHALL name the Rehearsal commit and a sha256 for each copied file in `engine/SOURCE.md`.
3. THE SYSTEM SHALL keep the MIT notice of Rehearsal in `engine/LICENSE`.
4. WHEN `tools/sync-engine.mjs` is run with a Rehearsal folder, THE SYSTEM SHALL copy the same paths again and rewrite `engine/SOURCE.md`.
5. THE SYSTEM SHALL give, for Harbor Hall baseline replication 0, the metrics stored in the Rehearsal snapshot, and the same bytes on a rerun.

## 2. Listing and describing scenarios
As an agent, I want to see which scenarios exist and what one holds.
1. THE SYSTEM SHALL ship the three Harbor Hall scenarios in `examples/` and list their id, title and one line each with `list_examples`.
2. WHEN `describe_scenario` gets an example id, a path to a JSON file or JSON text, THE SYSTEM SHALL run the engine's `validateScenario` and return stations, servers, service times, cohorts, attendee count, seed and horizon.
3. IF validation fails, THEN THE SYSTEM SHALL return the engine's own messages.

## 3. One run
1. WHEN `run_scenario` gets a scenario and a replication from 0 to 29, THE SYSTEM SHALL return the metrics of that run under the engine's keys and labels, with the unit of each, the scenario hash and the model version.
2. IF the replication is outside 0 to 29, THEN THE SYSTEM SHALL refuse it.

## 4. Paired comparison
1. WHEN `compare_plans` gets a baseline and a candidate, THE SYSTEM SHALL run 30 paired replications through `runPairedComparison` with an in-process client that calls `simulate`, and start no worker.
2. THE SYSTEM SHALL return the mean queue wait change in seconds with the count of runs that were lower, and for every metric the paired mean change, n, improved and worsened.
3. THE SYSTEM SHALL write words as `labels.ts` and `format.ts` of the engine do.
4. For baseline against plus-one-checkin, THE SYSTEM SHALL give a mean queue wait change of -297.4 s, lower in 30 of 30 runs.

## 5. What if servers are added
1. WHEN `what_if_add_servers` gets a scenario, a station id and a number from 1 to 19, THE SYSTEM SHALL build a candidate that differs only in that station's server count, and run the same paired comparison.
2. THE SYSTEM SHALL return the exact change made.
3. IF the new count would be above 20, or the station is unknown, THEN THE SYSTEM SHALL refuse with a plain message.
4. For baseline, station checkin, +1, THE SYSTEM SHALL give the same numbers as requirement 4.4.

## 6. Safety
1. THE SYSTEM SHALL refuse a scenario file larger than 2 MiB.
2. THE SYSTEM SHALL refuse a path outside the working folder and the app's examples folder, with a plain message.
3. THE SYSTEM SHALL write no file and use no network.
4. THE SYSTEM SHALL use no spreadsheet brand in any tool name or text.
5. THE SYSTEM SHALL run as a stdio MCP server, `dist/server.mjs`, built by `npm run build`.

## 7. Agent and skill
1. THE SYSTEM SHALL ship the agent `rehearsal-whatif` with the tool value `@rehearsal-crew:rehearsal-engine` and no file write tool.
2. THE SYSTEM SHALL tell the agent to answer only from tool results, run both plans with paired runs, give units and run counts, repeat the model limits sentence, and never forecast or recommend a staffing level.
3. THE SYSTEM SHALL ship the skill `rehearsal-whatif` with the tools, their order, the units and the limits.

## 8. Manifest and checker
1. THE SYSTEM SHALL ship `app.json` with the fields the manifest page lists, no cron job and `node` under dependencies.
2. THE SYSTEM SHALL ship `tools/check-manifest.mjs` that checks the manifest fields, that every named file exists, no placeholder text and no secret patterns.

## 9. README and proof
1. THE SYSTEM SHALL ship a README with what the app is, what it needs, install, the model limits sentence, a real transcript and the two links.
2. WHEN `npm run verify` runs, THE SYSTEM SHALL build, run the tests and run the manifest check, and exit 0.
3. THE SYSTEM SHALL keep the exact inputs and raw answers of one hand run in `docs/proof/hand-run.md`.
