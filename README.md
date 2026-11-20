# rehearsal-crew

`rehearsal-crew` is an app for Kiro Crew. Its agent, `rehearsal-whatif`, answers a question such as "what if we add a desk at check in?" by running the real Rehearsal simulation engine in Node with 30 paired runs, and reports the measured numbers with their units.

The engine is a copy of the Rehearsal source, unchanged, in `engine/`. `engine/SOURCE.md` names the commit it came from and lists a sha256 for each file. The app has one agent, one skill and one MCP server with five tools. It has no cron job, no account and no network use, and it writes no file.

## What you need

- Kiro Crew 0.12.2 or later.
- Node 20 or newer. The manifest lists `node` under `dependencies.commands`.

## Build

```
npm install
npm run build
```

The build writes `dist/server.mjs`, the MCP server. `npm run verify` builds, runs the tests and checks the manifest and the files.

## Install

The Crew pages give these two requests for a local app:

```
curl.exe -X POST http://localhost:5476/api/apps/install -H "Content-Type: application/json" -d '{\"source\": \"<APP_FOLDER>\"}'
curl.exe -X POST http://localhost:5476/api/apps/rehearsal-crew/enable
```

The CLI has the same two steps:

```
kirocrew app install <APP_FOLDER>
kirocrew app enable rehearsal-crew
```

Three things Kiro Crew 0.12.2 did with a local app, as recorded for an earlier app of the same kind:

- A plain request to the API without the dashboard token was refused with 403. Send the requests from a session opened with the URL that `kirocrew token` prints.
- The install of an app that was already installed was refused with "update it in place".
- On 20 Nov 2026 the install was refused with "execution trust predates repository binding and is inactive for repository-backed code" until `agent.apps_trusted_local` held `["rehearsal-crew"]`. The enable was then refused until `agent.apps_trusted` held `rehearsal-crew` too. Set both with `kirocrew config set`, or trust the app in the dashboard's App Store prompt.
- `kirocrew spawn run` was refused ("no surface could show the approval prompt") while no dashboard page was open. With the dashboard open, the spawn waited for approval and ran.

After the enable, Crew registers the agent `rehearsal-whatif`, the skill `rehearsal-whatif` and the tool server `rehearsal-crew:rehearsal-engine`. If `dist/server.mjs` is missing in the installed copy, run `npm install` and `npm run build` in it.

The manifest page says `mcpServers` entries are not path checked, and it gives no variable for the app folder. The folder of the server process is not known, so the entry in `app.json` does not use a relative path. It is `node -e` with a short inline script. The script takes the Crew home from `KIROCREW_HOME` when that is set, and otherwise uses the `.kiro/crew` folder inside the user's home folder. It then imports `apps/rehearsal-crew/dist/server.mjs` from that Crew home by file URL. So the app must sit at the default Crew app folder, `<crew home>/apps/rehearsal-crew`, which a normal install does. If that file is missing, the script writes one line to standard error that names the file and says to run `npm install` and `npm run build` in the app folder, and exits with code 1. The tests start the entry from an unrelated folder with a temporary Crew home. It was run on an installed app under Crew 0.12.2: see "A run in Kiro Crew" below. The first version of the entry used the relative path `dist/server.mjs`, and Crew answered "failed to start: rehearsal-crew:rehearsal-engine (Connection closed)".

## Ask

> What if we add a desk at check in? Use the baseline Harbor Hall scenario.

Each tool call needs your approval unless you allow it.

## The tools

| Tool | What it does |
| --- | --- |
| `list_examples` | Lists the three bundled Harbor Hall scenarios. |
| `describe_scenario` | Validates a scenario with the engine and describes it. |
| `run_scenario` | One replication, 0 to 29, with the metrics and their units. |
| `compare_plans` | 30 paired replications of a baseline and a candidate. |
| `what_if_add_servers` | Adds 1 to 19 servers to one station and runs the same paired comparison. |

A scenario is an example id (`baseline`, `plus-one-checkin`, `shorter-route`), a path to a `.json` file inside the working folder, or the JSON text. A file larger than 2 MiB and a path outside the working folder and the app's `examples/` folder are refused. A station has at most 20 servers.

## Model limits

These are scenario results, not a forecast, under the model's stated limits: each station is one FIFO line feeding identical parallel servers, staffing is constant through a run, queue capacity is unlimited, nobody leaves a line, walking is at one constant speed, service times are constant or triangular, and there is no personal space, crowd pressure or collision. One run is one seed and one replication. The model recommends nothing.

The Harbor Hall scenarios, their 120 attendees and their service times are fictional and illustrative, not measured.

## What a run looks like

This is a hand run of the built server through the SDK client, not an agent chat. The exact inputs and the full raw answers are in `docs/proof/hand-run.md`. The values below are copied from those answers.

1. `list_examples` with no input gave three examples: `baseline`, `plus-one-checkin` and `shorter-route`.
2. `describe_scenario` with `{"scenario":"baseline"}` gave 120 attendees, seed `harbor-hall-2026`, a horizon of 2400 s (40 min), the station `checkin` ("Check-in desk", 1 server, triangular 8/15/22 s) and the station `packs` ("Welcome packs", 2 servers, triangular 6/10/14 s). The scenario hash starts `ecb84997`.
3. `compare_plans` with `{"baseline":"baseline","candidate":"plus-one-checkin"}` gave:
   - Headline: `Mean queue wait drops by 297.4 s.` and `Lower in 30 of 30 runs.` The change is candidate minus baseline, in seconds, `meanChangeSeconds` -297.4.
   - Change listed: `Station "Check-in desk": servers 1 to 2`.
   - Mean queue wait: 305.3 s for the baseline, 7.9 s for the candidate, change -297.4 s, n 30, improved 30, worsened 0.
   - p95 queue wait: change -553.5 s, n 30, improved 30, worsened 0.
   - Maximum queue length: change -35.9 people, n 30, improved 30, worsened 0.
   - Mean walking time: change 0.0 s, no change in any run.
   - Staff-hours: 2.00 h for the baseline, 2.67 h for the candidate, change +0.67 h. It has no better direction, so it has no counts.
4. `what_if_add_servers` with `{"scenario":"baseline","stationId":"checkin","addServers":1}` gave the change `{"stationId":"checkin","stationLabel":"Check-in desk","field":"servers","from":1,"to":2}` and the same headline: `Mean queue wait drops by 297.4 s.`, `Lower in 30 of 30 runs.`

Every answer ends with the model limits sentence above. These are scenario results for a fictional scenario, not a forecast.

## A run in Kiro Crew

On 20 Nov 2026, on Kiro Crew 0.12.2 (Windows), after the install and enable above, the agent was started with `kirocrew spawn run --agent rehearsal-whatif` and the question "What if we add one desk at check in? Use the bundled baseline example." The agent called `list_examples`, `describe_scenario` and `what_if_add_servers` (station `checkin`, 1 added server). The full tool inputs and raw answers are in `docs/proof/crew-run-2026-11-20.md`. Its answer, shortened:

- The Check-in desk went from 1 server to 2. Nothing else changed. 120 people, 30 paired runs, the same seed and replication numbers on both sides.
- Mean queue wait changed by -297.4 s (candidate minus baseline), from 305.3 s to 7.9 s. Lower in 30 of 30 paired runs.
- p95 queue wait -553.5 s, maximum queue length -35.9 people, staff-hours +0.67 h (2.00 h to 2.67 h), mean walking time unchanged.
- It ended with the model limits sentence and recommended nothing.

## Links

- Rehearsal repository: https://github.com/Midknight56/rehearsal
- Live app: https://rehearsal.midknight-ent-llc.workers.dev

## Licence

MIT. See `LICENSE`. The engine copy keeps the Rehearsal notice in `engine/LICENSE`.
