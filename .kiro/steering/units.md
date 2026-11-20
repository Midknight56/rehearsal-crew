---
inclusion: always
---
# Units

- The engine works in integer milliseconds. Every time in a `RunResult`, every `horizonMs`, `startMs` and `endMs` is milliseconds. The vendored engine is never edited.
- Words to a user are in seconds, with one decimal: `297.4 s`. Minutes are used only for an arrival window or a horizon, as the engine's own `formatMinutes` writes them. Distance is metres. Counts are people.
- A field in a tool answer that holds a raw engine number has the unit in its name or in a `unit` field (`ms`, `count`, `people`, `ratio`, `hours`). A field that is text for a person already has its unit in the text.
- The change in a metric is candidate minus baseline. A negative time change means the candidate waited less. State the sign and the unit every time.
- Seconds become milliseconds in one place, `toDurationMs` in the engine. This app never converts a service time itself.
- Every figure comes with its run count (`n`). The paired comparison uses 30 replications, numbered 0 to 29.
