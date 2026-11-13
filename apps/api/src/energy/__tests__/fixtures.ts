import type {EnergyEvaluationRequest,EnergyModel} from '@chargeroad/shared';
import {fixture,forecast,source} from '../../planning/__tests__/fixtures';

export function energyFixture():EnergyEvaluationRequest{
  const f=fixture(),at=f.request.departureAt;
  const observed=(value:number)=>({origin:'user_input' as const,value,observedAt:at});
  f.request.policy.vehicleDataQuality='allow_engineering_estimates';
  f.request.stateOfHealthPercent=observed(100);f.request.initialBatteryTemperatureC=observed(30);
  f.request.operatingConditions={payloadKg:observed(0),cabinTargetTemperatureC:observed(20),hvacMode:'off',batteryPreconditioning:'off',tireSetupId:null};
  f.vehicle.physics={curbMassKg:1000,dragAreaSquareMeters:.5,rollingResistanceCoefficient:.01,drivetrainEfficiency:1,maxRegenerationKw:100000};
  f.vehicle.dataQuality={schemaVersion:'vehicle-quality/1.0.0',policy:'allow_engineering_estimates',quality:'engineering_estimate',
    verificationNote:'Synthetic hand-calculable validation vehicle; not Hyundai calibration',assumptions:['synthetic_vehicle_only'],methodId:'test',methodVersion:'1'};
  f.vehicle.energyModel=modelFixture();
  const segment=f.road.segments[0];segment.elevationQuality='verified';
  segment.elevationProfile=[{distanceFromStartMeters:0,elevationMeters:0},{distanceFromStartMeters:1000,elevationMeters:0}];segment.elevationGainMeters=0;segment.elevationLossMeters=0;
  const ref=f.vehicle.consumptionReferences[0];ref.conditions={...ref.conditions,meanSpeedKph:60,ambientTemperatureC:{min:-40,max:50},payloadKg:0,
    windSpeedKph:0,elevationGainMetersPer100Km:0};
  ref.includedEffects={cabinHvac:'excluded',batteryThermalManagement:'excluded',elevation:'included',wind:'included',chargingLosses:'excluded'};
  const climate=forecast({id:'weather-1',segmentId:segment.id,location:f.request.origin,validAt:new Date(Date.parse(at)+30000).toISOString()});
  return {request:f.request,vehicle:f.vehicle,route:f.road,weather:[climate],evaluatedAt:at};
}
export function modelFixture():EnergyModel{return {id:'synthetic-model',version:'1',vehicleVariantId:'synthetic-vehicle',quality:'engineering_estimate',source:source('test-only-calibration'),
  verificationNote:'TEST ONLY: analytical coefficients; not a vehicle or a field accuracy claim',assumptions:['synthetic_calibration_only'],tireSetupId:null,referenceTireDescription:null,
  mode:'physics',speedPolicy:'allow_travel_average_proxy',ambientRangeC:{min:-40,max:50},referenceAirDensityKgPerM3:1,
  referenceCabinKw:null,referenceBatteryThermalKw:null,baseAuxiliaryKw:0,cabin:{heatKwPerDegree:.1,coolKwPerDegree:.1,maxKw:5},
  batteryThermalKw:0,regeneration:{efficiency:1,temperatureRangeC:{min:0,max:40},taperStartSocPercent:95,zeroAtSocPercent:100},
  rotationalMassFactor:1,maxTractionBatteryKw:null,wetRollingMultiplier:null,snowRollingMultiplier:null,capacityTemperatureCurve:null,
  passiveThermal:{heatCapacityKwhPerC:1,conductanceKwPerC:0},
  unknowns:{payloadKg:null,sohPercent:null,cabinTargetC:null,hvacKw:null,capacityTemperatureFactor:null,airDensityKgPerM3:1,allowFlatElevation:false}};}
export function terrain(input:EnergyEvaluationRequest,points:[number,number][]){
  const s=input.route.segments[0];s.elevationProfile=points.map(([distanceFromStartMeters,elevationMeters])=>({distanceFromStartMeters,elevationMeters}));
  s.elevationGainMeters=points.slice(1).reduce((sum,p,i)=>sum+Math.max(0,p[1]-points[i][1]),0);
  s.elevationLossMeters=points.slice(1).reduce((sum,p,i)=>sum+Math.max(0,points[i][1]-p[1]),0);
}
export function idealMechanics(input:EnergyEvaluationRequest){input.vehicle.physics.dragAreaSquareMeters=1e-30;input.vehicle.physics.rollingResistanceCoefficient=1e-30;}
