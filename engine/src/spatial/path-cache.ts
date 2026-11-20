import { stableJson } from '../domain/hash';
import type { Cell, Scenario } from '../domain/scenario';
import type { NodeRef } from '../simulation/heap';
import { findPath, pathDistanceM, walkDurationMs } from './grid';

export type CachedPath = { id: number; from: NodeRef; to: NodeRef; cells: Cell[]; distanceM: number; durationMs: number };
export type PathCache = {
  key: string;
  paths: CachedPath[];
  lookup(from: NodeRef, to: NodeRef): CachedPath;
  unreachable: { from: NodeRef; to: NodeRef }[];
  unsafe: { from: NodeRef; to: NodeRef; durationMs: number }[];
};

type CacheInput = Pick<Scenario, 'layout' | 'stations' | 'walkSpeedMps'>;

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function nodeKey(node: NodeRef): string {
  return node.kind === 'station' ? `station:${node.id}` : node.kind;
}

export function nodeCell(input: Pick<Scenario, 'layout' | 'stations'>, node: NodeRef): Cell {
  if (node.kind === 'entrance') return input.layout.entrance;
  if (node.kind === 'exit') return input.layout.exit;
  const station = input.stations.find((s) => s.id === node.id);
  if (station === undefined) throw new Error(`Path cache: unknown station "${node.id}"`);
  return station.cell;
}

export function describeNode(input: Pick<Scenario, 'layout' | 'stations'>, node: NodeRef): string {
  const [x, y] = nodeCell(input, node);
  if (node.kind === 'station') return `station "${node.id}" (${x},${y})`;
  return `${node.kind} (${x},${y})`;
}

export function createPathCache(input: CacheInput): PathCache {
  const blockedCells = [...input.layout.blockedCells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const stations = [...input.stations].sort((a, b) => byCodeUnit(a.id, b.id));
  const key = stableJson({
    layout: { ...input.layout, blockedCells },
    stations: stations.map((s) => ({ id: s.id, cell: s.cell })),
    walkSpeedMps: input.walkSpeedMps,
  });

  const nodes: NodeRef[] = [
    { kind: 'entrance' },
    ...stations.map((s): NodeRef => ({ kind: 'station', id: s.id })),
    { kind: 'exit' },
  ];
  const resolver = { layout: input.layout, stations: input.stations };
  const paths: CachedPath[] = [];
  const byPair = new Map<string, CachedPath>();
  const unreachable: PathCache['unreachable'] = [];
  const unsafe: PathCache['unsafe'] = [];

  for (const from of nodes) {
    for (const to of nodes) {
      if (from === to) continue;
      const cells = findPath(input.layout, nodeCell(resolver, from), nodeCell(resolver, to));
      if (cells === null) {
        unreachable.push({ from, to });
        continue;
      }
      const distanceM = pathDistanceM(cells, input.layout.cellSizeM);
      const durationMs = walkDurationMs(distanceM, input.walkSpeedMps);
      const path: CachedPath = { id: paths.length, from, to, cells, distanceM, durationMs };
      paths.push(path);
      byPair.set(`${nodeKey(from)}>${nodeKey(to)}`, path);
      if (!Number.isSafeInteger(durationMs)) unsafe.push({ from, to, durationMs });
    }
  }

  return {
    key,
    paths,
    unreachable,
    unsafe,
    lookup(from, to) {
      const found = byPair.get(`${nodeKey(from)}>${nodeKey(to)}`);
      if (found === undefined) {
        throw new Error(`Path cache: no path between ${describeNode(resolver, from)} and ${describeNode(resolver, to)}`);
      }
      return found;
    },
  };
}
