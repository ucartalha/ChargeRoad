import { z } from 'zod';

// Offline oracle only: exhaustive enumeration on a bounded DAG and a declared Wh grid.
// No production provider, calibration coefficient or optimized solver is reused here.
const wh = z.number().int().nonnegative().max(1_000_000);
const positive = z.number().finite().positive();
const bandSchema = z.object({
  fromWh: wh, toWh: wh, acceptanceKw: positive, inletVoltageV: positive,
}).strict();
const stationSchema = z.object({
  node: z.string(), compatible: z.boolean(), roadAccessible: z.boolean(),
  status: z.enum(['available', 'unavailable', 'unknown']),
  evseKw: positive, siteKw: positive, pathKw: positive, maxCurrentA: positive,
  minVoltageV: positive, maxVoltageV: positive,
  efficiency: positive.max(1), auxiliaryKw: z.number().finite().nonnegative(),
  connectionSeconds: z.number().finite().nonnegative(),
  waitingSeconds: z.number().finite().nonnegative(), bands: z.array(bandSchema).min(1).max(20),
}).strict();
const edgeSchema = z.object({
  id: z.string(), from: z.string(), to: z.string(), seconds: positive,
  // Positive = consumption, negative = regeneration, in traversal order.
  energyWh: z.array(z.number().int().min(-1_000_000).max(1_000_000)).min(1).max(100),
}).strict();
const fields = {
  capacityWh: wh.refine((n) => n > 0), stepWh: wh.refine((n) => n > 0),
  startWh: wh, reserveWh: wh, targetWh: wh,
  coverageComplete: z.boolean(), unknownAvailability: z.enum(['reject', 'allow_with_risk']),
  nodes: z.array(z.string().min(1)).min(2).max(8),
  edges: z.array(edgeSchema).max(24), stations: z.array(stationSchema).max(8),
};
export const referenceProblemSchema = z.object(fields).strict().superRefine((p, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (new Set(p.nodes).size !== p.nodes.length) issue('Duplicate node');
  if (new Set(p.edges.map((e) => e.id)).size !== p.edges.length) issue('Duplicate edge');
  if (p.capacityWh % p.stepWh || p.capacityWh / p.stepWh > 40) issue('Grid must divide capacity, at most 40 steps');
  if (p.startWh > p.capacityWh || p.targetWh > p.capacityWh || p.reserveWh > p.targetWh)
    issue('Invalid capacity/reserve/target');
  if (new Set(p.stations.map((s) => s.node)).size !== p.stations.length) issue('One station per oracle node');
  for (const e of p.edges) {
    if (!p.nodes.includes(e.from) || !p.nodes.includes(e.to) || p.nodes.indexOf(e.from) >= p.nodes.indexOf(e.to))
      issue('Edges must follow node order (DAG)');
  }
  for (const s of p.stations) {
    if (!p.nodes.includes(s.node) || s.minVoltageV > s.maxVoltageV) issue('Invalid station');
    if (s.bands[0].fromWh !== 0 || s.bands.at(-1)!.toWh !== p.capacityWh) issue('Bands must cover battery');
    s.bands.forEach((b, i) => {
      if (b.fromWh >= b.toWh || (i > 0 && s.bands[i - 1].toWh !== b.fromWh)) issue('Bands must be contiguous');
    });
  }
});
export type ReferenceProblem = z.infer<typeof referenceProblemSchema>;
export type ReferenceStation = ReferenceProblem['stations'][number];
export type ReferencePlan = {
  edgeIds: string[]; stops: { node: string; arrivalWh: number; departureWh: number; chargingSeconds: number }[];
  arrivalWh: number; chargedWh: number; netConsumedWh: number; curtailedRegenerationWh: number;
  drivingSeconds: number; chargingSeconds: number; overheadSeconds: number; totalSeconds: number;
  risks: string[];
};
export type ReferenceResult =
  | { status: 'planned'; plan: ReferencePlan; explored: number }
  | { status: 'infeasible' | 'insufficient_data' | 'search_limit'; explored: number };

// Each synthetic band has constant inlet acceptance/voltage. Analytic integration,
// deliberately different from the future production linear-curve integrator.
export function referenceChargingSeconds(s: ReferenceStation, fromWh: number, toWh: number): number | null {
  if (toWh < fromWh || fromWh < 0 || toWh > s.bands.at(-1)!.toWh) throw new Error('Charge outside curve');
  let seconds = 0;
  for (const b of s.bands) {
    const amount = Math.min(toWh, b.toWh) - Math.max(fromWh, b.fromWh);
    if (amount <= 0) continue;
    if (b.inletVoltageV < s.minVoltageV || b.inletVoltageV > s.maxVoltageV) return null;
    const inletKw = Math.min(b.acceptanceKw, s.pathKw, s.evseKw, s.siteKw, b.inletVoltageV * s.maxCurrentA / 1000);
    const storedKw = inletKw * s.efficiency - s.auxiliaryKw;
    if (storedKw <= 0) return null;
    seconds += amount * 3.6 / storedKw;
  }
  return seconds;
}

export function solveReference(raw: unknown, maxExplored = 100_000): ReferenceResult {
  const p = referenceProblemSchema.parse(raw);
  if (!Number.isSafeInteger(maxExplored) || maxExplored < 1) throw new Error('Invalid exploration budget');
  let explored = 0;
  let limited = false;
  let best: ReferencePlan | undefined;
  const visit = (node: string, energy: number, plan: ReferencePlan): void => {
    if (limited) return;
    if (++explored > maxExplored) { limited = true; return; }
    if (node === p.nodes.at(-1)) {
      if (energy >= p.targetWh && (!best || plan.totalSeconds < best.totalSeconds)) best = plan;
      return;
    }
    const station = p.stations.find((s) => s.node === node);
    const usable = station && station.compatible && station.roadAccessible && station.status !== 'unavailable' &&
      (station.status !== 'unknown' || p.unknownAvailability === 'allow_with_risk');
    const departures = [energy];
    if (usable) for (let e = Math.floor(energy / p.stepWh + 1) * p.stepWh; e <= p.capacityWh; e += p.stepWh) departures.push(e);
    for (const departure of departures) {
      const charge = departure > energy ? referenceChargingSeconds(station!, energy, departure) : 0;
      if (charge === null) continue;
      const overhead = departure > energy ? station!.connectionSeconds + station!.waitingSeconds : 0;
      for (const edge of p.edges.filter((e) => e.from === node)) {
        let remaining = departure;
        let curtailed = 0;
        let safe = remaining >= p.reserveWh;
        for (const consumption of edge.energyWh) {
          const next = remaining - consumption;
          curtailed += Math.max(0, next - p.capacityWh);
          remaining = Math.min(p.capacityWh, next);
          if (remaining < p.reserveWh) safe = false;
        }
        if (!safe) continue;
        const charging = departure > energy;
        const risk = charging && station!.status === 'unknown' ? [`unknown_availability:${node}`] : [];
        visit(edge.to, remaining, {
          edgeIds: [...plan.edgeIds, edge.id],
          stops: charging ? [...plan.stops, { node, arrivalWh: energy, departureWh: departure, chargingSeconds: charge }] : plan.stops,
          arrivalWh: remaining, chargedWh: plan.chargedWh + departure - energy,
          netConsumedWh: plan.netConsumedWh + edge.energyWh.reduce((a, b) => a + b, 0),
          curtailedRegenerationWh: plan.curtailedRegenerationWh + curtailed,
          drivingSeconds: plan.drivingSeconds + edge.seconds,
          chargingSeconds: plan.chargingSeconds + charge, overheadSeconds: plan.overheadSeconds + overhead,
          totalSeconds: plan.totalSeconds + edge.seconds + charge + overhead,
          risks: [...plan.risks, ...risk],
        });
      }
    }
  };
  visit(p.nodes[0], p.startWh, { edgeIds: [], stops: [], arrivalWh: p.startWh, chargedWh: 0,
    netConsumedWh: 0, curtailedRegenerationWh: 0, drivingSeconds: 0, chargingSeconds: 0,
    overheadSeconds: 0, totalSeconds: 0, risks: [] });
  if (limited) return { status: 'search_limit', explored };
  // Missing catalogue coverage prevents a proof of either infeasibility or global optimality.
  if (!p.coverageComplete) return { status: 'insufficient_data', explored };
  return best ? { status: 'planned', plan: best, explored } : { status: 'infeasible', explored };
}

export const referenceCaseSchema = z.object({
  id: z.string().min(1), rationale: z.string().min(1), overrides: z.object(fields).partial().strict(),
  expected: z.object({
    status: z.enum(['planned', 'infeasible', 'insufficient_data']),
    totalSeconds: z.number().nonnegative().optional(), arrivalWh: wh.optional(),
    edgeIds: z.array(z.string()).optional(), stopNodes: z.array(z.string()).optional(),
    chargedWh: wh.optional(), risks: z.array(z.string()).optional(),
  }).strict(),
}).strict();
export const snapshotSchema = z.object({
  schemaVersion: z.literal(1), provenance: z.literal('synthetic_hand_calculated_not_vehicle_measurements'),
  base: referenceProblemSchema, cases: z.array(referenceCaseSchema).min(1),
}).strict().refine((s) => new Set(s.cases.map((c) => c.id)).size === s.cases.length, 'Duplicate case');
