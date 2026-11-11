import { referenceChargingSeconds, referenceProblemSchema, solveReference, type ReferencePlan } from './reference-solver';

// A future production-solver adapter can export this small neutral plan format.
// Feasibility is audited before cost comparison; equal objective does not require an identical path.
export function compareCandidate(rawProblem: unknown, candidate: ReferencePlan) {
  const p = referenceProblemSchema.parse(rawProblem);
  const reference = solveReference(p);
  if (reference.status !== 'planned') return { status: 'unavailable' as const, reason: reference.status };
  const issues: string[] = [];
  let node = p.nodes[0];
  let energy = p.startWh;
  let chargeWh = 0;
  let netWh = 0;
  let curtailedWh = 0;
  let driving = 0;
  let charging = 0;
  let overhead = 0;
  let stopIndex = 0;
  const risks: string[] = [];
  const close = (a: number, b: number) => Number.isFinite(a) && Math.abs(a - b) <= 1e-7;
  for (const id of candidate.edgeIds) {
    const edge = p.edges.find((e) => e.id === id);
    if (!edge || edge.from !== node) { issues.push('Disconnected or unknown road'); break; }
    const stop = candidate.stops[stopIndex];
    if (stop?.node === node) {
      stopIndex++;
      const s = p.stations.find((s) => s.node === node);
      if (!s || !s.compatible || !s.roadAccessible || s.status === 'unavailable' ||
          (s.status === 'unknown' && p.unknownAvailability === 'reject')) {
        issues.push('Unusable charging stop'); break;
      }
      if (stop.arrivalWh !== energy || stop.departureWh <= energy || stop.departureWh > p.capacityWh ||
          stop.departureWh % p.stepWh !== 0) { issues.push('Invalid charge or different search grid'); break; }
      const seconds = referenceChargingSeconds(s, energy, stop.departureWh);
      if (seconds === null || !close(stop.chargingSeconds, seconds)) { issues.push('Invalid charging time'); break; }
      charging += seconds;
      chargeWh += stop.departureWh - energy;
      energy = stop.departureWh;
      overhead += s.connectionSeconds + s.waitingSeconds;
      if (s.status === 'unknown') risks.push(`unknown_availability:${node}`);
    }
    if (energy < p.reserveWh) issues.push('Reserve violated at departure');
    for (const draw of edge.energyWh) {
      const next = energy - draw;
      curtailedWh += Math.max(0, next - p.capacityWh);
      energy = Math.min(next, p.capacityWh);
      netWh += draw;
      if (energy < p.reserveWh) issues.push('Reserve violated inside road segment');
    }
    driving += edge.seconds;
    node = edge.to;
  }
  if (node !== p.nodes.at(-1) || energy < p.targetWh) issues.push('Destination/arrival target not reached');
  if (stopIndex !== candidate.stops.length) issues.push('Unused or out-of-order charging stop');
  const computed = { arrivalWh: energy, chargedWh: chargeWh, netConsumedWh: netWh,
    curtailedRegenerationWh: curtailedWh, drivingSeconds: driving, chargingSeconds: charging,
    overheadSeconds: overhead, totalSeconds: driving + charging + overhead };
  for (const [key, expected] of Object.entries(computed)) {
    if (!close(candidate[key as keyof typeof computed], expected)) issues.push(`Incorrect ledger: ${key}`);
  }
  if (JSON.stringify(candidate.risks) !== JSON.stringify(risks)) issues.push('Missing or incorrect risk disclosure');
  if (issues.length) return { status: 'invalid' as const, issues };
  const gapSeconds = candidate.totalSeconds - reference.plan.totalSeconds;
  return { status: Math.abs(gapSeconds) <= 1e-7 ? 'optimal_on_grid' as const :
    gapSeconds > 0 ? 'suboptimal_on_grid' as const : 'reference_disagreement' as const,
    gapSeconds, referenceSeconds: reference.plan.totalSeconds };
}
