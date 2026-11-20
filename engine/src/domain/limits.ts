export type Limits = {
  readonly maxAttendees: number; readonly maxStations: number; readonly maxRouteVisits: number;
  readonly maxCols: number; readonly maxRows: number; readonly maxHorizonMs: number;
  readonly minServers: number; readonly maxServers: number; readonly maxServiceSeconds: number;
  readonly maxIdLength: number; readonly maxSeedLength: number;
};
export const LIMITS: Limits = {
  maxAttendees: 5_000, maxStations: 10, maxRouteVisits: 6, maxCols: 80, maxRows: 80,
  maxHorizonMs: 21_600_000, minServers: 1, maxServers: 20, maxServiceSeconds: 86_400,
  maxIdLength: 64, maxSeedLength: 64,
};
export const DRAIN_CAP_MS = 7_200_000;
