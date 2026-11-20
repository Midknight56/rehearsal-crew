import type { Cell, Service } from '../domain/scenario';

// Display-unit formatters shared by diff, exports and the run sheet. Internal time is milliseconds; these write minutes,
// seconds and metres for people.

/** The text shown for a value that is undefined (a null metric, change or count). */
export const EMPTY_VALUE = 'n/a';

const minutesOf = (ms: number): string => {
  const minutes = ms / 60_000;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
};

export function formatMinutes(ms: number): string {
  return `${minutesOf(ms)} min`;
}
export function formatWindow(startMs: number, endMs: number): string {
  return `${minutesOf(startMs)} to ${formatMinutes(endMs)}`;
}
export function formatService(service: Service): string {
  return service.kind === 'constant'
    ? `constant ${service.seconds} s`
    : `triangular ${service.minS}/${service.modeS}/${service.maxS} s`;
}
export function formatCell(cell: Cell): string {
  return `(${cell[0]},${cell[1]})`;
}
export function formatMeters(m: number): string {
  return `${m.toFixed(1)} m`;
}
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
export function formatRoute(route: string[]): string {
  return route.length === 0 ? '(no stations)' : route.join(' → ');
}
export function formatPeople(n: number): string {
  return `${n} people`;
}
export function formatSpeed(mps: number): string {
  return `${mps.toFixed(1)} m/s`;
}
