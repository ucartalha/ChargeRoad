import { z } from 'zod';
import { planningInputSchema, planningResultSchema } from './planning.js';

// Referential and temporal integrity, not an energy estimator or a route solver.
export const planningEvaluationSchema = z.object({
  input: planningInputSchema,
  result: planningResultSchema,
}).strict().superRefine(({ input, result }, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['result'], message });
  if (result.status !== 'planned') {
    if (result.requestId !== input.request.requestId) issue('Failure result belongs to another request');
    if(result.status==='infeasible' && input.stationSearch &&
      (!input.stationSearch.coverage.completeForQuery||input.stationSearch.search.truncated))
      issue('Incomplete station data/search cannot prove definitive infeasibility');
    return;
  }
  const plan = result.plan;
  if(input.stationSearch && JSON.stringify(plan.stationSearch)!==JSON.stringify(input.stationSearch))
    issue('Plan must retain station search coverage and revision metadata');
  const request = input.request;
  if (plan.requestId !== request.requestId || plan.vehicleVariantId !== request.vehicleVariantId ||
      plan.vehicleProfileId !== input.vehicle.id || plan.vehicleProfileVersion !== input.vehicle.version ||
      plan.policyId !== request.policy.id || plan.policyVersion !== request.policy.version)
    issue('Plan identity, profile or policy differs from input');
  if (plan.minimumReserveChargePercent !== request.constraints.minimumReserveChargePercent ||
      plan.targetArrivalChargePercent !== request.constraints.targetArrivalChargePercent)
    issue('Plan changed requested reserve or arrival constraints');
  const candidate = input.roadCandidates.find((route) => route.id === plan.roadRoute.id);
  if (!candidate || JSON.stringify(candidate) !== JSON.stringify(plan.roadRoute))
    issue('Planned road must match an input road snapshot');
  const expectedSnapshots = [...new Set(input.dataSnapshots.map((snapshot) => snapshot.checksumSha256))].sort();
  const actualSnapshots = [...new Set(plan.dataSnapshotChecksums)].sort();
  if (JSON.stringify(expectedSnapshots) !== JSON.stringify(actualSnapshots)) issue('Plan snapshot identity differs from input');

  const references = new Map(input.vehicle.consumptionReferences.map((reference) => [reference.id, reference]));
  const forecasts = new Map(input.weather.map((forecast) => [forecast.queryId, forecast]));
  const assumptions = new Set(plan.assumptions.map((assumption) => assumption.code));
  for (const energy of plan.energySegments) {
    for (const id of energy.consumptionReferenceIds) {
      const reference = references.get(id);
      if (!reference) issue('Energy segment references unknown consumption data');
      else if (reference.energyBoundary === 'unknown' ||
          (reference.energyBoundary === 'ac_grid' && reference.batteryDcConversion === null))
        issue('A grid/unknown reference cannot be used as battery consumption without conversion');
    }
    if (energy.consumptionReferenceIds.length === 0) {
      const physics = input.vehicle.physics;
      if ([physics.curbMassKg, physics.dragAreaSquareMeters, physics.rollingResistanceCoefficient,
        physics.drivetrainEfficiency].some((value) => value === null))
        issue('No consumption reference or complete physical baseline');
    }
    if (!energy.weatherQueryIds.length &&
        (request.policy.unknownWeather === 'reject' || !assumptions.has('missing_weather')))
      issue('Missing segment weather requires an allowed, documented assumption');
    for (const id of energy.weatherQueryIds) {
      const weather = forecasts.get(id);
      if (!weather || weather.segmentId !== energy.segmentId) {
        issue('Energy segment references missing or unrelated weather');
        continue;
      }
      if (energy.departureAt && energy.arrivalAt &&
          (Date.parse(weather.validAt) < Date.parse(energy.departureAt) || Date.parse(weather.validAt) > Date.parse(energy.arrivalAt)))
        issue('Weather must be sampled at segment passage time, including charging delays');
      const sourceTime=weather.sourceUpdatedAt??weather.forecastIssuedAt;
      if(weather.status&& !['available','partial'].includes(weather.status))issue('Unavailable weather cannot support a reliable energy plan');
      if(weather.temperatureCelsius===null||weather.windSpeedKph===null||(weather.windSpeedKph>0&&weather.windFromDegrees===null))
        issue('Core weather fields are missing');
      const age = sourceTime===null?Infinity:(Date.parse(plan.createdAt) - Date.parse(sourceTime)) / 1000;
      if ((age < 0 || age > request.policy.forecastMaxAgeSeconds) &&
          (request.policy.unknownWeather === 'reject' || !assumptions.has('stale_weather')))
        issue('Stale weather requires an allowed, documented assumption');
    }
  }

  for (const stop of plan.chargingStops) {
    const station = input.stations.find((entry) => entry.id === stop.stationId);
    const evse = station?.evses.find((entry) => entry.id === stop.evseId);
    const connector = evse?.connectors.find((entry) => entry.id === stop.connectorId);
    const curve = input.vehicle.dcChargingCurves.find((entry) => entry.id === stop.curveReference.id);
    const path = input.vehicle.dcChargingPaths.find((entry) => entry.id === stop.chargingPathId);
    if (!station || !evse || !connector || !curve || !path) {
      issue('Charging stop references unknown hardware, curve or charging path');
      continue;
    }
    if (connector.powerType !== 'dc' || !input.vehicle.supportedConnectors.includes(connector.standard))
      issue('DC charging stop uses an incompatible connector');
    if (curve.chargingPathId !== path.id || curve.version !== stop.curveReference.version)
      issue('Charging curve version or charging path differs from profile');
    const points = curve.curve.points;
    if (stop.curveReference.coveredSocPercent.min !== points[0].socPercent ||
        stop.curveReference.coveredSocPercent.max !== points[points.length - 1].socPercent)
      issue('Stop misrepresents the source curve coverage');
    if (connector.powerType === 'dc' && connector.outputVoltageRangeV && path.inletVoltageRangeV &&
        (connector.outputVoltageRangeV.max < path.inletVoltageRangeV.min ||
          connector.outputVoltageRangeV.min > path.inletVoltageRangeV.max))
      issue('EVSE and the selected vehicle input path have disjoint voltage ranges');
    const temperature = stop.batteryTemperatureAtArrivalC.value;
    const range = curve.conditions.batteryTemperatureC;
    if ((temperature === null || range === null || temperature < range.min || temperature > range.max) &&
        stop.thermalModelVersion === null)
      issue('An unverified thermal condition requires a documented thermal model');
    if (stop.availabilitySnapshot.maxAgeSeconds !== request.policy.availabilityMaxAgeSeconds ||
        Date.parse(stop.availabilitySnapshot.evaluatedAt) !== Date.parse(plan.createdAt))
      issue('Stop freshness assessment differs from the planning policy or evaluation time');
    if (stop.availabilitySnapshot.effectiveStatus === 'unknown') {
      if (request.policy.unknownAvailability === 'exclude') issue('Policy excludes stops with unknown availability');
      else if (!plan.warnings.some((warning) => warning.code === 'unknown_availability'))
        issue('Unknown availability requires an explicit risk warning');
    }
    if (stop.availabilitySnapshot.reportedStatus !== evse.availability.reportedStatus ||
        stop.availabilitySnapshot.sourceObservedAt !== evse.availability.sourceObservedAt ||
        stop.availabilitySnapshot.receivedAt !== evse.availability.receivedAt ||
        stop.availabilitySnapshot.sourceId !== evse.availability.source.sourceId)
      issue('Stop availability differs from the EVSE snapshot');
    if (stop.waiting.basis === 'policy_assumption' &&
        !plan.assumptions.some((assumption) => assumption.id === stop.waiting.justificationId))
      issue('Waiting-time assumption is not present in the plan');
  }

  // Walk the route boundaries: charging changes SOC and time before the next driving segment.
  let charge = request.startingChargePercent;
  let time: string | null = request.departureAt;
  const applyStops = (distance: number) => {
    for (const stop of plan.chargingStops.filter((entry) => Math.abs(entry.routeDistanceMeters - distance) <= 0.001)) {
      if (Math.abs(stop.arrivalChargePercent - charge) > 0.001 ||
          (stop.arrivalAt === null) !== (time === null) ||
          (stop.arrivalAt && time && Date.parse(stop.arrivalAt) !== Date.parse(time)))
        issue('Charging arrival does not match preceding battery state or time');
      charge = stop.targetChargePercent;
      time = stop.departureAt;
    }
  };
  applyStops(0);
  for (const [index, segment] of plan.energySegments.entries()) {
    if (Math.abs(segment.startChargePercent - charge) > 0.001 ||
        (segment.departureAt === null) !== (time === null) ||
        (segment.departureAt && time && Date.parse(segment.departureAt) !== Date.parse(time)))
      issue('Driving segment does not continue the preceding SOC or time');
    charge = segment.endChargePercent;
    time = segment.arrivalAt;
    const road = plan.roadRoute.segments[index];
    if (road) applyStops(road.endDistanceMeters);
  }
  if (Math.abs(charge - plan.estimatedArrivalChargePercent) > 0.001 ||
      (plan.estimatedArrivalAt === null) !== (time === null) ||
      (plan.estimatedArrivalAt && time && Date.parse(plan.estimatedArrivalAt) !== Date.parse(time)))
    issue('Final plan arrival differs from the final battery state or time');
});

export type PlanningEvaluation = z.infer<typeof planningEvaluationSchema>;
