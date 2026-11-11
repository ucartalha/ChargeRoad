import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadReferenceSnapshot, replayCase } from './replay';
import { latencySummary, percentile, tripAccuracy, tripValidationRecordSchema } from './metrics';
import { referenceChargingSeconds, solveReference, type ReferenceProblem, type ReferenceStation } from './reference-solver';
import { compareCandidate } from './compare-candidate';

const { snapshot } = loadReferenceSnapshot();
const base = () => structuredClone(snapshot.base);
function stationOnly(change: Partial<ReferenceStation> = {}): ReferenceStation {
  const s = base().stations[0];
  return { ...s, bands: [{ fromWh: 0, toWh: 50000, acceptanceKw: 100, inletVoltageV: 800 }], ...change };
}
function planned(p: ReferenceProblem) {
  const result = solveReference(p);
  if (result.status !== 'planned') throw new Error(`Expected plan, got ${result.status}`);
  return result.plan;
}

describe('Independent exhaustive reference replay', () => {
  it.each(snapshot.cases.map((c) => [c.id, c] as const))('%s matches hand-calculated expectations', (_id, c) => {
    expect(replayCase(snapshot.base, c).failures).toEqual([]);
  });

  it('replays byte-identical input deterministically and does not mutate it', () => {
    const input = base();
    const before = JSON.stringify(input);
    const results = Array.from({ length: 4 }, () => solveReference(input));
    results.forEach((r) => expect(r).toEqual(results[0]));
    expect(JSON.stringify(input)).toBe(before);
  });

  it('refuses changed snapshots even when their JSON is still valid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chargeroad-reference-'));
    try {
      const bytes = readFileSync(join(__dirname, 'fixtures', 'reference-v1.json'));
      writeFileSync(join(directory, 'reference-v1.json'), Buffer.concat([bytes, Buffer.from(' ')]));
      writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ sha256: createHash('sha256').update(bytes).digest('hex') }));
      expect(() => loadReferenceSnapshot(directory)).toThrow('checksum mismatch');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('exposes an exhausted budget instead of claiming infeasibility or optimality', () => {
    expect(solveReference(base(), 1).status).toBe('search_limit');
    expect(() => solveReference(base(), Infinity)).toThrow('budget');
  });

  it.each([
    ['cyclic road', (p: ReferenceProblem) => { p.edges[0].from = 'd'; }],
    ['unknown node', (p: ReferenceProblem) => { p.edges[0].to = 'missing'; }],
    ['duplicate edge', (p: ReferenceProblem) => { p.edges.push(p.edges[0]); }],
    ['oversize search grid', (p: ReferenceProblem) => { p.stepWh = 1; }],
    ['out of capacity start', (p: ReferenceProblem) => { p.startWh = 50001; }],
    ['target below reserve', (p: ReferenceProblem) => { p.targetWh = 0; }],
    ['gap in charge curve', (p: ReferenceProblem) => { p.stations[0].bands[1].fromWh += 1; }],
    ['negative time', (p: ReferenceProblem) => { p.edges[0].seconds = -1; }],
  ] as const)('rejects invalid reference input: %s', (_label, mutate) => {
    const p = base(); mutate(p);
    expect(() => solveReference(p)).toThrow();
  });

  it.each([
    { status: 'unavailable' as const }, { compatible: false }, { roadAccessible: false },
  ])('cannot use an unusable station: %j', (change) => {
    const p = base(); Object.assign(p.stations[0], change);
    expect(solveReference(p).status).toBe('infeasible');
  });

  it('treats stale/unknown availability according to policy and preserves the risk', () => {
    const p = base(); p.stations[0].status = 'unknown';
    expect(solveReference(p).status).toBe('infeasible');
    p.unknownAvailability = 'allow_with_risk';
    expect(planned(p).risks).toEqual(['unknown_availability:a']);
  });

  it('includes detour driving time and queue time when comparing routes', () => {
    const p = base();
    p.edges[2] = { id: 'slower-road-no-charge', from: 'o', to: 'd', seconds: 5000, energyWh: [20000] };
    expect(planned(p).edgeIds).toEqual(['oa', 'ad']);
    p.stations[0].waitingSeconds = 600;
    expect(planned(p).edgeIds).toEqual(['slower-road-no-charge']);
    expect(planned(p).totalSeconds).toBe(5000);
  });

  it('higher starting energy cannot worsen the optimum in this fixed-energy network', () => {
    const times = [25000, 30000, 35000, 40000, 45000, 50000].map((startWh) => planned({ ...base(), startWh }).totalSeconds);
    times.slice(1).forEach((time, i) => expect(time).toBeLessThanOrEqual(times[i]));
  });

  it('preserves regeneration clipping in its energy ledger', () => {
    const c = snapshot.cases.find((c) => c.id === 'regeneration-capacity-clipping')!;
    const result = replayCase(snapshot.base, c).result;
    expect(result.status === 'planned' && result.plan.curtailedRegenerationWh).toBe(10000);
  });
});

describe('Analytic charging reference with explicit electrical boundaries', () => {
  it('integrates the tapered bands rather than dividing energy by peak power', () => {
    expect(referenceChargingSeconds(base().stations[0], 20000, 40000)).toBe(1080);
  });
  it.each([
    ['EVSE power', { evseKw: 50 }, 1440],
    ['shared site power', { siteKw: 25 }, 2880],
    ['vehicle charging path', { pathKw: 40 }, 1800],
    ['inlet current at 800 V', { maxCurrentA: 125 }, 720],
    ['conversion and auxiliaries', { efficiency: .9, auxiliaryKw: 10 }, 900],
  ] as const)('respects %s', (_label, limits, expected) => {
    expect(referenceChargingSeconds(stationOnly(limits), 10000, 30000)).toBeCloseTo(expected, 8);
  });
  it('uses inlet V × I, not the vehicle voltage architecture label', () => {
    const s = stationOnly({ maxCurrentA: 125 });
    expect(referenceChargingSeconds(s, 10000, 30000)).toBe(720);
    s.bands[0].inletVoltageV = 400;
    expect(referenceChargingSeconds(s, 10000, 30000)).toBe(1440);
  });
  it('does not invent a converter for a voltage-incompatible station', () => {
    expect(referenceChargingSeconds(stationOnly({ maxVoltageV: 500 }), 10000, 30000)).toBeNull();
  });
  it('rejects a charge with no net stored power', () => {
    expect(referenceChargingSeconds(stationOnly({ auxiliaryKw: 100 }), 10000, 30000)).toBeNull();
  });
  it('compares explicit cold/warm acceptance without fabricating thermal coefficients', () => {
    const warm = stationOnly();
    const cold = stationOnly({ bands: [{ fromWh: 0, toWh: 50000, acceptanceKw: 25, inletVoltageV: 800 }] });
    expect(referenceChargingSeconds(warm, 10000, 30000)).toBe(720);
    expect(referenceChargingSeconds(cold, 10000, 30000)).toBe(2880);
    expect(() => referenceChargingSeconds(warm, 10000, 50001)).toThrow('outside curve');
  });
});

describe('Future optimized-solver comparison boundary', () => {
  it('audits a candidate before recognizing the optimum', () => {
    const p = base();
    expect(compareCandidate(p, planned(p))).toMatchObject({ status: 'optimal_on_grid', gapSeconds: 0 });
  });
  it('rejects a candidate that reports a fake fast total', () => {
    const p = base(); const candidate = planned(p); candidate.totalSeconds = 1;
    expect(compareCandidate(p, candidate).status).toBe('invalid');
  });
  it('rejects a candidate missing the required charging stop', () => {
    const p = base(); const candidate = planned(p); candidate.stops = [];
    expect(compareCandidate(p, candidate).status).toBe('invalid');
  });
  it('reports a feasible slower candidate rather than approving its optimum', () => {
    const p = base();
    p.edges.push({ id: 'slow-direct', from: 'o', to: 'd', seconds: 6000, energyWh: [20000] });
    const candidate = { edgeIds: ['slow-direct'], stops: [], arrivalWh: 20000, chargedWh: 0,
      netConsumedWh: 20000, curtailedRegenerationWh: 0, drivingSeconds: 6000,
      chargingSeconds: 0, overheadSeconds: 0, totalSeconds: 6000, risks: [] };
    expect(compareCandidate(p, candidate)).toMatchObject({ status: 'suboptimal_on_grid', gapSeconds: 1260 });
  });
  it('does not issue an optimality comparison on incomplete coverage', () => {
    const p = base(); const candidate = planned(p); p.coverageComplete = false;
    expect(compareCandidate(p, candidate)).toEqual({ status: 'unavailable', reason: 'insufficient_data' });
  });
});

describe('Validation statistics and field-record safeguards', () => {
  it('uses nearest-rank p95/p99 with an independently known sequence', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, .95)).toBe(95);
    expect(percentile(values, .99)).toBe(99);
    expect(percentile([], .99)).toBeNull();
    expect(() => percentile([NaN], .99)).toThrow();
  });
  it('keeps fast 429/errors separate from successful planned latency', () => {
    const report = latencySummary([{ status: 'planned', durationMs: 100 }, { status: '429', durationMs: 1 },
      { status: 'error', durationMs: 2 }]);
    expect(report.plannedOnly.p99Ms).toBe(100);
    expect(report.counts).toEqual({ planned: 1, '429': 1, error: 1 });
    expect(report.all.samples).toBe(3);
  });
  it('reports missing observations without claiming zero model error', () => {
    expect(tripAccuracy([])).toMatchObject({ holdoutRecords: 0, status: 'awaiting_field_data', errors: [], groups: [] });
    const template: unknown = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'pilot-observation-template.json'), 'utf8'));
    expect(tripValidationRecordSchema.safeParse(template).success).toBe(false);
  });
  it('keeps signed optimistic SOC errors and excludes calibration trips', () => {
    const record = {
      id: 'anonymous-1', vehicleKey: 'ioniq6-2023-53-rwd-18', split: 'holdout',
      collectionPermission: 'explicit_validation_permission', distanceKm: 200,
      speed: { kind: 'trip_average', kph: 80 }, ambientTemperatureC: null, hvac: 'unknown',
      measuredEnergyBoundary: 'battery_dc',
      evidence: { kind: 'user_report', method: 'Synthetic statistic test', referenceId: 'test-only' },
      measured: { arrivalSocPercent: 20, consumedKwh: 30, chargingSeconds: 600 },
      predicted: { arrivalSocPercent: 25, consumedKwh: 28, chargingSeconds: 660, modelVersion: 'test-only' },
    };
    const report = tripAccuracy([record, { ...record, id: 'calibration-1', split: 'calibration' }]);
    expect(report.holdoutRecords).toBe(1);
    expect(report.calibrationRecords).toBe(1);
    expect(report.errors[0]).toMatchObject({ socErrorPercentagePoints: 5, energyErrorKwh: -2,
      consumptionErrorKwhPer100Km: -1, chargingErrorSeconds: 60 });
    expect(report.groups[0].optimisticSocErrorP99).toBe(5);
    expect(() => tripAccuracy([record, { ...record, split: 'calibration' }])).toThrow('Duplicate trip');
    expect(() => tripAccuracy([{ ...record, preciseLocation: [39, 32] }])).toThrow();
  });
});
