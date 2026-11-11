import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { referenceProblemSchema, snapshotSchema, solveReference, type ReferenceProblem } from './reference-solver';

export function loadReferenceSnapshot(directory = join(__dirname, 'fixtures')) {
  const bytes = readFileSync(join(directory, 'reference-v1.json'));
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const manifest: unknown = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || !('sha256' in manifest) || manifest.sha256 !== checksum)
    throw new Error('Reference snapshot checksum mismatch; review and version fixture changes');
  const snapshot = snapshotSchema.parse(JSON.parse(bytes.toString('utf8')));
  return { snapshot, checksum };
}

export function replayCase(base: ReferenceProblem, test: ReturnType<typeof loadReferenceSnapshot>['snapshot']['cases'][number]) {
  const problem = referenceProblemSchema.parse({ ...base, ...test.overrides });
  const result = solveReference(problem);
  const failures: string[] = [];
  for (const [field, expected] of Object.entries(test.expected)) {
    const actual = field === 'status' ? result.status : result.status === 'planned'
      ? field === 'stopNodes' ? result.plan.stops.map((s) => s.node)
        : result.plan[field as keyof typeof result.plan] : undefined;
    const matches = typeof expected === 'number' && typeof actual === 'number'
      ? Math.abs(actual - expected) <= 1e-7 : isDeepStrictEqual(actual, expected);
    if (!matches) failures.push(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  if (result.status === 'planned') {
    const p = result.plan;
    if (problem.startWh + p.chargedWh - p.netConsumedWh - p.curtailedRegenerationWh !== p.arrivalWh)
      failures.push('Energy conservation failed');
    if (Math.abs(p.drivingSeconds + p.chargingSeconds + p.overheadSeconds - p.totalSeconds) > 1e-7)
      failures.push('Duration conservation failed');
    if (p.arrivalWh < problem.targetWh) failures.push('Arrival target violated');
  }
  return { id: test.id, problem, result, failures };
}
