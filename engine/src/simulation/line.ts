export type LineEntry = { attendeeId: string; queueJoinMs: number };

function compareEntries(a: LineEntry, b: LineEntry): number {
  if (a.queueJoinMs !== b.queueJoinMs) return a.queueJoinMs - b.queueJoinMs;
  if (a.attendeeId !== b.attendeeId) return a.attendeeId < b.attendeeId ? -1 : 1;
  return 0;
}

/** One FIFO line kept in (queueJoinMs, attendeeId) order. */
export class Line {
  private readonly items: LineEntry[] = [];

  /** Inserts in order and returns the position at insertion time. */
  insert(entry: LineEntry): number {
    const items = this.items;
    let index = items.length;
    while (index > 0 && compareEntries(items[index - 1] as LineEntry, entry) > 0) index -= 1;
    items.splice(index, 0, entry);
    return index;
  }

  shift(): LineEntry | undefined {
    return this.items.shift();
  }

  get length(): number {
    return this.items.length;
  }

  entries(): readonly LineEntry[] {
    return this.items;
  }
}
