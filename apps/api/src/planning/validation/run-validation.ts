import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cpus, totalmem } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { loadReferenceSnapshot, replayCase } from './replay';
import { latencySummary, tripAccuracy } from './metrics';
import { solveReference } from './reference-solver';

async function main() {
  const { snapshot, checksum } = loadReferenceSnapshot();
  const replay = snapshot.cases.map((c) => replayCase(snapshot.base, c));
  const failures = replay.filter((r) => r.failures.length);
  if (failures.length) throw new Error(JSON.stringify(failures.map(({ id, failures: issues }) => ({ id, issues }))));
  const sampleCount = 10_000;
  const warmup = 200;
  for (let i = 0; i < warmup; i++) solveReference(replay[i % replay.length].problem);
  const samples: { status: string; durationMs: number }[] = [];
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  await nextTurn();
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  for (let i = 0; i < sampleCount; i++) {
    const t = performance.now();
    try {
      const result = solveReference(replay[i % replay.length].problem);
      samples.push({ status: result.status, durationMs: performance.now() - t });
    } catch {
      samples.push({ status: 'error', durationMs: performance.now() - t });
    }
    if ((i + 1) % 100 === 0) await nextTurn();
  }
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStart);
  loop.disable();
  const observationBytes = readFileSync(join(__dirname, 'fixtures', 'pilot-observations-v1.json'));
  const measurements: unknown = JSON.parse(observationBytes.toString('utf8'));
  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    scope: 'offline_synthetic_reference_only_not_api_capacity_or_vehicle_accuracy',
    snapshotSha256: checksum,
    pilotObservationsSha256: createHash('sha256').update(observationBytes).digest('hex'),
    correctness: { passed: replay.length, failed: 0,
      cases: replay.map(({ id, result }) => ({ id, ...result })) },
    performance: { sampleCount, warmup, concurrency: 1, elapsedMs,
      ...latencySummary(samples),
      cpuMilliseconds: (cpu.user + cpu.system) / 1000,
      rssBytes: process.memoryUsage().rss,
      eventLoopDelay: { samples: loop.count, p95Ms: loop.count ? loop.percentile(95) / 1e6 : null,
        p99Ms: loop.count ? loop.percentile(99) / 1e6 : null },
      environment: { node: process.version, platform: process.platform, architecture: process.arch,
        cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem() },
      limitations: ['Small DAG and declared discrete Wh grid only', 'No HTTP, DB, external provider or concurrent load',
        'Batch yielding does not make this CPU solver suitable for the API event loop',
        'No production latency threshold has been selected'] },
    pilotAccuracy: tripAccuracy(measurements),
  };
  const output = resolve(process.argv[2] ?? join(process.cwd(), '..', '..', 'artifacts', 'planning-validation', 'latest.json'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, snapshotSha256: checksum, correctness: { passed: replay.length },
    performance: report.performance.all, pilotStatus: report.pilotAccuracy.status }, null, 2));
  if (samples.some((s) => s.status === 'error' || s.status === 'search_limit')) process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
