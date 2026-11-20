import type { MetricValue, Metrics } from '../simulation/metrics';

export type Direction = 'lower' | 'higher' | 'none';
export type MetricKey =
  | 'completedByClosing' | 'activeAtClosing.total' | 'queueWait.total' | 'queueWait.mean' | 'queueWait.p95'
  | 'journeyTime.mean' | 'journeyTime.p95' | 'walkingTime.mean' | 'queues.averageLength' | 'queues.maxLength' | 'staffHours';
export type StationMetricKey = 'utilization' | 'averageQueueLength' | 'maxQueueLength' | 'served';

/**
 * Two rows have direction `none` (staff-hours and utilization): a higher value is neither better nor worse on its own,
 * so no improvement count is ever shown for them.
 */
export const METRIC_KEYS: readonly { key: MetricKey; label: string; direction: Direction }[] = [
  { key: 'completedByClosing', label: 'Completed by closing', direction: 'higher' },
  { key: 'activeAtClosing.total', label: 'Still active at closing', direction: 'lower' },
  { key: 'queueWait.total', label: 'Total queue wait', direction: 'lower' },
  { key: 'queueWait.mean', label: 'Mean queue wait', direction: 'lower' },
  { key: 'queueWait.p95', label: 'p95 queue wait', direction: 'lower' },
  { key: 'journeyTime.mean', label: 'Mean journey time', direction: 'lower' },
  { key: 'journeyTime.p95', label: 'p95 journey time', direction: 'lower' },
  { key: 'walkingTime.mean', label: 'Mean walking time', direction: 'lower' },
  { key: 'queues.averageLength', label: 'Average queue length', direction: 'lower' },
  { key: 'queues.maxLength', label: 'Maximum queue length', direction: 'lower' },
  { key: 'staffHours', label: 'Staff-hours', direction: 'none' },
];

export const STATION_METRIC_KEYS: readonly { key: StationMetricKey; label: string; direction: Direction }[] = [
  { key: 'utilization', label: 'Utilization', direction: 'none' },
  { key: 'averageQueueLength', label: 'Average queue length', direction: 'lower' },
  { key: 'maxQueueLength', label: 'Maximum queue length', direction: 'lower' },
  { key: 'served', label: 'Served by closing', direction: 'higher' },
];

export function readMetric(metrics: Metrics, key: MetricKey): MetricValue {
  switch (key) {
    case 'completedByClosing': return metrics.completedByClosing;
    case 'activeAtClosing.total': return metrics.activeAtClosing.total;
    case 'queueWait.total': return metrics.queueWait.total;
    case 'queueWait.mean': return metrics.queueWait.mean;
    case 'queueWait.p95': return metrics.queueWait.p95;
    case 'journeyTime.mean': return metrics.journeyTime.mean;
    case 'journeyTime.p95': return metrics.journeyTime.p95;
    case 'walkingTime.mean': return metrics.walkingTime.mean;
    case 'queues.averageLength': return metrics.queues.averageLength;
    case 'queues.maxLength': return metrics.queues.maxLength;
    case 'staffHours': return metrics.staffHours;
  }
}

/** The metric of one station, or null when the scenario has no station with that id. */
export function readStationMetric(metrics: Metrics, stationId: string, key: StationMetricKey): MetricValue | null {
  const station = metrics.stations.find((s) => s.id === stationId);
  return station === undefined ? null : station[key];
}
