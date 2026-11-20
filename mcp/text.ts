// Fixed words of the app. Times are in seconds here, as the units steering says.

export const MODEL_LIMITS =
  "These are scenario results, not a forecast, under the model's stated limits: each station is one FIFO line feeding identical parallel servers, "
  + 'staffing is constant through a run, queue capacity is unlimited, nobody leaves a line, walking is at one constant speed, '
  + 'service times are constant or triangular, and there is no personal space, crowd pressure or collision. '
  + 'One run is one seed and one replication. The model recommends nothing.';

export const FICTION_NOTE =
  'The Harbor Hall Community Fair scenarios, their 120 attendees and their service times are fictional and illustrative, not measured.';

export const MAX_SCENARIO_BYTES = 2 * 1024 * 1024;
export const MAX_SCENARIO_TEXT = '2 MiB';

export type Failure = {
  ok: false;
  error: string;
  message: string;
  issues?: { code: string; path: string; message: string }[];
};
export type Success<T> = { ok: true; value: T };
export type Result<T> = Success<T> | Failure;

export const fail = (error: string, message: string, issues?: Failure['issues']): Failure =>
  issues === undefined ? { ok: false, error, message } : { ok: false, error, message, issues };
