import type { Cell, Layout } from '../domain/scenario';

export function isInBounds(layout: Layout, cell: Cell): boolean {
  const [x, y] = cell;
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < layout.cols && y < layout.rows;
}

export function isBlocked(layout: Layout, cell: Cell): boolean {
  return layout.blockedCells.some(([bx, by]) => bx === cell[0] && by === cell[1]);
}

// Neighbour order is fixed: north (x, y-1), east (x+1, y), south (x, y+1), west (x-1, y).
const NEIGHBOURS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Breadth-first search over four-neighbour unblocked in-bounds cells. The parent is recorded on first
 * discovery, so equal-length ties resolve the same way on every run. Returns the cells from start to goal
 * inclusive, `[start]` when start equals goal, `null` when unreachable.
 */
export function findPath(layout: Layout, start: Cell, goal: Cell): Cell[] | null {
  if (!isInBounds(layout, start) || !isInBounds(layout, goal)) return null;
  if (isBlocked(layout, start) || isBlocked(layout, goal)) return null;
  const { cols, rows } = layout;
  const index = (x: number, y: number): number => y * cols + x;
  const blocked = new Uint8Array(cols * rows);
  for (const [bx, by] of layout.blockedCells) {
    if (bx >= 0 && by >= 0 && bx < cols && by < rows) blocked[index(bx, by)] = 1;
  }
  const startIndex = index(start[0], start[1]);
  const goalIndex = index(goal[0], goal[1]);
  if (startIndex === goalIndex) return [[start[0], start[1]]];
  const parent = new Int32Array(cols * rows).fill(-2); // -2 undiscovered, -1 the start
  parent[startIndex] = -1;
  const queue: number[] = [startIndex];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] as number;
    const cx = current % cols;
    const cy = (current - cx) / cols;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = index(nx, ny);
      if (blocked[next] === 1 || parent[next] !== -2) continue;
      parent[next] = current;
      if (next === goalIndex) {
        const cells: Cell[] = [];
        for (let at = next; at !== -1; at = parent[at] as number) {
          const ax = at % cols;
          cells.push([ax, (at - ax) / cols]);
        }
        return cells.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/** Edge count times the cell size: `(cells.length - 1) * cellSizeM`. */
export function pathDistanceM(cells: Cell[], cellSizeM: number): number {
  return (cells.length - 1) * cellSizeM;
}

export function walkDurationMs(distanceM: number, walkSpeedMps: number): number {
  return Math.ceil(distanceM / walkSpeedMps * 1000);
}
