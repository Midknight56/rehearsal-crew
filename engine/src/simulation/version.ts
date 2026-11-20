/*
 * MODEL_VERSION changes in the same commit as any change to one of these semantics:
 *   - generator keys (`random.ts`) or the triangular formula (`sampling.ts`)
 *   - `toDurationMs`
 *   - heap order, batch-then-dispatch, line order or server selection (`heap.ts`, `line.ts`, `scheduler.ts`)
 *   - horizon or drain-cap handling
 *   - the breadth-first search tie-break
 *   - the distance or duration formulas
 *   - any metric definition (`metrics.ts`)
 * Because `modelVersion` is inside the canonical hash, any later change to MODEL_VERSION regenerates
 * `public/examples/harbor-hall/expected.json` and `public/examples/harbor-hall/{baseline,plus-one-checkin,shorter-route}.json`
 * through the update run (`UPDATE_EXPECTED=1`) of task 15, in the same commit. Never regenerate them for any other reason.
 * No version in this repository reaches 1.0.0.
 */
export const MODEL_VERSION = '0.1.0';
