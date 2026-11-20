export type EventKind = 'service-complete' | 'movement-arrival' | 'external-arrival';
export const KIND_PRIORITY: Record<EventKind, 0 | 1 | 2> = {
  'service-complete': 0,
  'movement-arrival': 1,
  'external-arrival': 2,
};
export type NodeRef = { kind: 'entrance' } | { kind: 'exit' } | { kind: 'station'; id: string };
export type SimEvent = {
  timeMs: number; kind: EventKind; attendeeId: string; sequence: number;
  stationId?: string; server?: number; // service-complete
  node?: NodeRef; pathId?: number; // movement-arrival
};

/** Orders by (timeMs, kind priority, attendeeId in code-unit order, sequence). */
export function compareEvents(a: SimEvent, b: SimEvent): number {
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
  const kindDelta = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
  if (kindDelta !== 0) return kindDelta;
  if (a.attendeeId !== b.attendeeId) return a.attendeeId < b.attendeeId ? -1 : 1;
  return a.sequence - b.sequence;
}

/** Array-backed binary min-heap; each push receives the next per-run sequence number. */
export class EventHeap {
  private readonly items: SimEvent[] = [];
  private nextSequence = 0;

  push(event: Omit<SimEvent, 'sequence'>): void {
    const item: SimEvent = { ...event, sequence: this.nextSequence };
    this.nextSequence += 1;
    const items = this.items;
    let index = items.length;
    items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compareEvents(item, items[parent] as SimEvent) >= 0) break;
      items[index] = items[parent] as SimEvent;
      index = parent;
    }
    items[index] = item;
  }

  pop(): SimEvent | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0] as SimEvent;
    const last = items.pop() as SimEvent;
    const n = items.length;
    if (n > 0) {
      let index = 0;
      for (;;) {
        const left = 2 * index + 1;
        if (left >= n) break;
        const right = left + 1;
        const child = right < n && compareEvents(items[right] as SimEvent, items[left] as SimEvent) < 0 ? right : left;
        if (compareEvents(items[child] as SimEvent, last) >= 0) break;
        items[index] = items[child] as SimEvent;
        index = child;
      }
      items[index] = last;
    }
    return top;
  }

  peek(): SimEvent | undefined {
    return this.items[0];
  }

  size(): number {
    return this.items.length;
  }
}
