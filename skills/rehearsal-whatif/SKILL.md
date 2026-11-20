---
name: rehearsal-whatif
description: How to answer a what if question about queues by running the Rehearsal engine with paired runs.
triggers: [what if, rehearsal, queue wait, add a desk, add servers, staffing scenario]
always: false
---

# Rehearsal what if

Use this when you are asked what would change in a queue if a plan changed, for example "what if we add a desk at check in?".

## The tools

- `list_examples`: no input. Lists the three bundled Harbor Hall scenarios: `baseline`, `plus-one-checkin`, `shorter-route`.
- `describe_scenario`: input `scenario`. Validates it with the engine and lists stations, servers, service times, cohorts, attendee count, seed and horizon.
- `run_scenario`: input `scenario` and `replication` (0 to 29). One run, with the metrics and their units. It is an example run, not an average.
- `compare_plans`: input `baseline` and `candidate`. 30 paired runs.
- `what_if_add_servers`: input `scenario`, `stationId`, `addServers` (1 to 19). Changes only that station's server count, then runs the same 30 paired runs. A station has at most 20 servers.

A scenario is an example id, a path to a `.json` file inside the working folder, or the JSON text. A file over 2 MiB, or a path outside the working folder and the examples folder, is refused.

## Order

1. `list_examples` if no scenario was given.
2. `describe_scenario` on the baseline. Read the station ids. Use the id, not the label.
3. `what_if_add_servers` for added servers, or `compare_plans` for any other pair.
4. Report. Use `run_scenario` only to show what one run looks like.

## Units

- Words to the user are in seconds with one decimal, for example `297.4 s`. Raw engine fields hold milliseconds and say so in `unit`.
- A change is candidate minus baseline. A negative time change means the candidate waited less.
- Give n with every figure. The paired comparison has 30 runs, numbered 0 to 29.
- Counts of runs come from `improved`, `worsened` and `unchanged`. Staff-hours has no better direction, so it has no counts.
- The spread of the paired differences is called "variation across these simulated runs".

## Report

- The change made, or the changes listed.
- The headline: mean queue wait change in seconds and the count of runs lower, out of 30.
- The other metrics: change with its unit, n, improved, worsened.
- Any note about runs that hit the drain cap.
- The model limits sentence from the tool answer.

## Limits

These are scenario results, not a forecast, under the model's stated limits. One station is one FIFO line feeding identical parallel servers. Staffing is constant. Queue capacity is unlimited and nobody leaves a line. Walking is at one constant speed. There is no personal space, crowd pressure or collision. The Harbor Hall scenarios are fictional and illustrative.

## Never

- Never claim a forecast or a prediction.
- Never recommend a staffing level or say a plan is best.
- Never give a number the tools did not return.
- Never judge a plan from one run.
