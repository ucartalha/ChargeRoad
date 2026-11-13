import {consumptionObservationSchema} from '@chargeroad/shared';

// Context consistency only. Never turn a dashboard average into verified capacity/SoH.
export function reviewJourneyObservation(raw:unknown){
  const observation=consumptionObservationSchema.parse(raw),journey=observation.reportedJourneyContext;
  if(!journey)return null;
  const displayAverageDerivedEnergyKwh=observation.distanceKm===null?null:{
    min:observation.distanceKm*observation.consumptionKwhPer100Km.min/100,
    max:observation.distanceKm*observation.consumptionKwhPer100Km.max/100};
  const hasSoc=journey.startingChargePercent!==null&&journey.arrivalChargePercent!==null&&
    journey.chargingStops.every(s=>s.arrivalChargePercent!==null&&s.departureChargePercent!==null&&s.departureChargePercent>=s.arrivalChargePercent);
  const chargedSocPoints=hasSoc?journey.chargingStops.reduce((sum,s)=>sum+s.departureChargePercent!-s.arrivalChargePercent!,0):null;
  const dischargedSocPoints=hasSoc?journey.startingChargePercent!+chargedSocPoints!-journey.arrivalChargePercent!:null;
  const conditionalCapacityKwh=dischargedSocPoints!==null&&dischargedSocPoints>0&&displayAverageDerivedEnergyKwh?
    {min:displayAverageDerivedEnergyKwh.min/(dischargedSocPoints/100),max:displayAverageDerivedEnergyKwh.max/(dischargedSocPoints/100)}:null;
  return {id:observation.id,kind:'user_reported_journey_context',consumptionKwhPer100Km:observation.consumptionKwhPer100Km,
    distanceKm:observation.distanceKm,reportedJourney:journey,displayAverageDerivedEnergyKwh,chargedSocPoints,dischargedSocPoints,conditionalCapacityKwh,
    calibrationEligibility:'context_only_not_independent_accuracy',
    notes:['Conditional capacity requires consistent dashboard energy boundary, unchanged capacity and complete SOC accounting.',
      'It is not a usable-capacity or SoH measurement.','No cruise speed was relabeled as a trip-average speed.','Route/time, charge-session energy and independent battery-DC measurement are missing.']};
}
