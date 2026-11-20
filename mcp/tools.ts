import fs from 'node:fs';
import path from 'node:path';
import { scenarioHash } from '../engine/src/domain/hash';
import { LIMITS } from '../engine/src/domain/limits';
import type { Scenario } from '../engine/src/domain/scenario';
import { validateScenario } from '../engine/src/domain/validate';
import { simulate, type RunResult } from '../engine/src/simulation/simulate';
import { formatMetricValue, type MetricValue } from '../engine/src/simulation/metrics';
import { MODEL_VERSION } from '../engine/src/simulation/version';
import { formatMinutes, formatService, formatWindow } from '../engine/src/comparison/format';
import { countSentence } from '../engine/src/comparison/labels';
import { METRIC_KEYS, readMetric } from '../engine/src/comparison/metric-keys';
import { formatChange, formatMean, type PairedMetric } from '../engine/src/comparison/paired';
import { REPLICATIONS } from '../engine/src/comparison/replications';
import { runPairedComparison } from '../engine/src/comparison/runner';
import type { Comparison } from '../engine/src/comparison/comparison';
import { createNodeClient } from './node-client';
import { EXAMPLES, loadScenario, type Folders } from './source';
import { FICTION_NOTE, MODEL_LIMITS, fail, type Result } from './text';

type Json = Record<string, unknown>;

/** Checks a loaded scenario with the engine. A failure carries the engine's own messages. */
function validated(raw: unknown, label: string): Result<{ scenario: Scenario; warnings: string[] }> {
  const checked = validateScenario(raw);
  if (!checked.ok) {
    const issues = checked.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));
    const first = issues[0]?.message ?? 'Scenario is invalid.';
    const more = issues.length > 1 ? ` (+${issues.length - 1} more in "issues")` : '';
    return fail('invalid_scenario', `${label}: ${first}${more}`, issues);
  }
  return { ok: true, value: { scenario: checked.scenario, warnings: checked.warnings.map((w) => w.message) } };
}

function load(input: string, folders: Folders, label: string): Result<{ scenario: Scenario; warnings: string[]; source: string }> {
  const loaded = loadScenario(input, folders);
  if (!loaded.ok) return { ...loaded, message: `${label}: ${loaded.message}` };
  const checked = validated(loaded.raw, label);
  return checked.ok ? { ok: true, value: { ...checked.value, source: loaded.source } } : checked;
}

const metricEntry = (key: string, label: string, direction: string, m: MetricValue): Json => ({
  key, label, betterDirection: direction, value: m.value, unit: m.unit, text: formatMetricValue(m),
  n: m.n, population: m.population, conditioned: m.conditioned, note: m.note,
});

function compactMetric(metric: PairedMetric): Json {
  return {
    key: metric.key,
    label: metric.label,
    unit: metric.unit,
    betterDirection: metric.betterDirection,
    baselineMeanText: formatMean(metric.baselineMean, metric.unit),
    candidateMeanText: formatMean(metric.candidateMean, metric.unit),
    meanChange: metric.meanChange,
    meanChangeText: formatChange(metric.meanChange, metric.unit),
    n: metric.n,
    improved: metric.improved,
    worsened: metric.worsened,
    unchanged: metric.unchanged,
    variationAcrossRuns: {
      label: metric.rangeLabel,
      p10Text: formatChange(metric.rangeP10, metric.unit),
      p90Text: formatChange(metric.rangeP90, metric.unit),
    },
    conditioned: metric.conditioned,
    note: metric.note,
  };
}

function headlineOf(comparison: Comparison): Json | null {
  const metric = comparison.metrics.find((m) => m.key === 'queueWait.mean');
  if (metric === undefined || metric.meanChange === null || metric.unit !== 'ms') return null;
  const lower = metric.meanChange < 0;
  const runs = lower ? metric.improved : metric.worsened;
  const size = (Math.abs(metric.meanChange) / 1000).toFixed(1);
  return {
    metric: metric.label,
    text: metric.meanChange === 0 ? `${metric.label} does not change.` : `${metric.label} ${lower ? 'drops' : 'rises'} by ${size} s.`,
    detail: metric.meanChange === 0 || runs === null ? null : `${lower ? 'Lower' : 'Higher'} in ${runs} of ${metric.n} runs.`,
    countText: countSentence({
      direction: 'lower', metricLabel: metric.label, improved: metric.improved, n: metric.n,
      languageMode: comparison.languageMode,
      baselineCount: comparison.population.baselineCount, candidateCount: comparison.population.candidateCount,
    }),
    meanChangeSeconds: Math.round(metric.meanChange / 100) / 10,
    unit: 'seconds, candidate minus baseline',
    runsLower: metric.improved,
    runsHigher: metric.worsened,
    runs: metric.n,
    note: metric.conditioned ? metric.note : null,
  };
}

function comparisonAnswer(comparison: Comparison): Json {
  const ref = (r: Comparison['baseline']): Json => ({ id: r.id, title: r.title, scenarioHash: r.scenarioHash });
  return {
    baseline: ref(comparison.baseline),
    candidate: ref(comparison.candidate),
    modelVersion: comparison.modelVersion,
    baseSeed: comparison.baseSeed,
    horizonText: formatMinutes(comparison.horizonMs),
    runs: REPLICATIONS,
    replications: `0 to ${REPLICATIONS - 1}, the same seed and replication numbers on both sides`,
    headline: headlineOf(comparison),
    changes: comparison.diff.changes.map((c) => c.text),
    populationChanged: comparison.population.changed,
    languageMode: comparison.languageMode,
    drainCapped: comparison.completion,
    metrics: comparison.metrics.map(compactMetric),
    stations: comparison.stations.map((s) => ({
      id: s.id, label: s.label, presence: s.presence,
      metrics: s.metrics.map((m) => ({
        key: m.key, label: m.label, unit: m.unit, meanChangeText: formatChange(m.meanChange, m.unit),
        n: m.n, improved: m.improved, worsened: m.worsened,
      })),
    })),
    limits: MODEL_LIMITS,
  };
}

async function pairedRun(baseline: Scenario, candidate: Scenario): Promise<Result<Comparison>> {
  const client = createNodeClient();
  try {
    const outcome = await runPairedComparison(client, baseline, candidate).done;
    if (outcome.status === 'complete') return { ok: true, value: outcome.comparison };
    if (outcome.status === 'cancelled') return fail('comparison_cancelled', outcome.message);
    return fail('comparison_failed', outcome.message);
  } finally {
    client.dispose();
  }
}

export type Tools = ReturnType<typeof createTools>;

export function createTools(folders: Folders) {
  return {
    async list_examples(): Promise<Result<Json>> {
      const examples = EXAMPLES.map((e) => {
        const file = path.join(folders.examplesDir, `${e.id}.json`);
        const title = (JSON.parse(fs.readFileSync(file, 'utf8')) as { title: string }).title;
        return { id: e.id, title, summary: e.summary };
      });
      return { ok: true, value: { examples, note: FICTION_NOTE } };
    },

    async describe_scenario(input: { scenario: string }): Promise<Result<Json>> {
      const loaded = load(input.scenario, folders, 'Scenario');
      if (!loaded.ok) return loaded;
      const { scenario: s, warnings, source } = loaded.value;
      const hash = await scenarioHash(s);
      return {
        ok: true,
        value: {
          valid: true,
          source,
          id: s.id,
          title: s.title,
          scenarioHash: hash,
          modelVersion: s.modelVersion,
          engineModelVersion: MODEL_VERSION,
          warnings,
          baseSeed: s.baseSeed,
          horizonSeconds: s.horizonMs / 1000,
          horizonText: formatMinutes(s.horizonMs),
          attendeeCount: s.cohorts.reduce((total, c) => total + c.count, 0),
          walkSpeedMetresPerSecond: s.walkSpeedMps,
          stations: s.stations.map((st) => ({
            id: st.id, label: st.label, servers: st.servers, service: formatService(st.service),
          })),
          cohorts: s.cohorts.map((c) => ({
            id: c.id, count: c.count, window: formatWindow(c.startMs, c.endMs), arrivals: c.arrivals, route: c.route,
          })),
          limits: MODEL_LIMITS,
        },
      };
    },

    async run_scenario(input: { scenario: string; replication: number }): Promise<Result<Json>> {
      const r = input.replication;
      if (!Number.isInteger(r) || r < 0 || r >= REPLICATIONS) {
        return fail('bad_replication', `The replication must be a whole number from 0 to ${REPLICATIONS - 1}.`);
      }
      const loaded = load(input.scenario, folders, 'Scenario');
      if (!loaded.ok) return loaded;
      const s = loaded.value.scenario;
      const hash = await scenarioHash(s);
      let result: RunResult;
      try {
        result = simulate(s, r, { trace: false, scenarioHash: hash });
      } catch (error) {
        return fail('run_failed', error instanceof Error ? error.message : 'The run failed.');
      }
      return {
        ok: true,
        value: {
          scenarioHash: result.scenarioHash,
          modelVersion: result.modelVersion,
          baseSeed: result.baseSeed,
          replication: result.replication,
          horizonText: formatMinutes(result.horizonMs),
          completion: result.completion,
          unfinished: result.unfinished.length,
          admitted: result.metrics.admitted,
          metrics: METRIC_KEYS.map((k) => metricEntry(k.key, k.label, k.direction, readMetric(result.metrics, k.key))),
          stations: result.metrics.stations.map((st) => ({
            id: st.id,
            servers: st.servers,
            utilization: metricEntry('utilization', 'Utilization', 'none', st.utilization),
            averageQueueLength: metricEntry('averageQueueLength', 'Average queue length', 'lower', st.averageQueueLength),
            maxQueueLength: metricEntry('maxQueueLength', 'Maximum queue length', 'lower', st.maxQueueLength),
            served: metricEntry('served', 'Served by closing', 'higher', st.served),
          })),
          limits: MODEL_LIMITS,
        },
      };
    },

    async compare_plans(input: { baseline: string; candidate: string }): Promise<Result<Json>> {
      const a = load(input.baseline, folders, 'Baseline');
      if (!a.ok) return a;
      const b = load(input.candidate, folders, 'Candidate');
      if (!b.ok) return b;
      const run = await pairedRun(a.value.scenario, b.value.scenario);
      if (!run.ok) return run;
      return { ok: true, value: comparisonAnswer(run.value) };
    },

    async what_if_add_servers(input: { scenario: string; stationId: string; addServers: number }): Promise<Result<Json>> {
      const add = input.addServers;
      if (!Number.isInteger(add) || add < 1 || add > LIMITS.maxServers - 1) {
        return fail('bad_add_servers', `The number of servers to add must be a whole number from 1 to ${LIMITS.maxServers - 1}.`);
      }
      const loaded = load(input.scenario, folders, 'Scenario');
      if (!loaded.ok) return loaded;
      const baseline = loaded.value.scenario;
      const station = baseline.stations.find((st) => st.id === input.stationId);
      if (station === undefined) {
        const known = baseline.stations.map((st) => `${st.id} (${st.label})`).join(', ');
        return fail('unknown_station', `There is no station "${input.stationId}". The stations are: ${known}.`);
      }
      const to = station.servers + add;
      if (to > LIMITS.maxServers) {
        return fail('bad_add_servers',
          `Station "${station.id}" has ${station.servers} servers. Adding ${add} would make ${to}, above the engine limit of ${LIMITS.maxServers}.`);
      }
      // Only this station's server count changes.
      const candidate = structuredClone(baseline);
      const target = candidate.stations.find((st) => st.id === station.id) as Scenario['stations'][number];
      target.servers = to;
      const run = await pairedRun(baseline, candidate);
      if (!run.ok) return run;
      return {
        ok: true,
        value: {
          change: { stationId: station.id, stationLabel: station.label, field: 'servers', from: station.servers, to },
          ...comparisonAnswer(run.value),
        },
      };
    },
  };
}
