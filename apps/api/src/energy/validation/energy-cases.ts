import {energyFixture,idealMechanics,terrain} from '../__tests__/fixtures';
import type {EnergyEvaluationRequest} from '@chargeroad/shared';

// Fixed analytical fixtures. None are measured Hyundai consumption data.
export function analyticalEnergyCases():{id:string;input:EnergyEvaluationRequest;expectedNetKwh:number;expectedStatus:string}[]{
  const flat=energyFixture(),hill=energyFixture(),reference=energyFixture(),auxiliary=energyFixture();
  idealMechanics(hill);terrain(hill,[[0,0],[500,100],[1000,0]]);hill.vehicle.energyModel!.regeneration.efficiency=.5;
  reference.vehicle.energyModel!.mode='reference_corrected';
  auxiliary.vehicle.energyModel!.baseAuxiliaryKw=.3;auxiliary.vehicle.energyModel!.batteryThermalKw=.2;
  auxiliary.weather[0].temperatureCelsius=0;auxiliary.request.operatingConditions.hvacMode='heat';
  return [
    {id:'flat-roll-and-drag-1km',input:flat,expectedNetKwh:0.04653081790123456,expectedStatus:'estimated'},
    {id:'internal-100m-peak-half-recovery',input:hill,expectedNetKwh:0.13620347222222223,expectedStatus:'estimated'},
    {id:'reference-baseline-no-double-count',input:reference,expectedNetKwh:0.2,expectedStatus:'estimated'},
    {id:'base-cabin-thermal-time-loads',input:auxiliary,expectedNetKwh:0.08819748456790123,expectedStatus:'estimated'},
  ];
}
export function longEnergyCase(count=1000):EnergyEvaluationRequest{
  const input=energyFixture(),segment=input.route.segments[0],base=Date.parse(input.request.departureAt);
  input.route.segments=Array.from({length:count},(_,i)=>({...structuredClone(segment),id:'long-'+i,startDistanceMeters:i*1000,endDistanceMeters:(i+1)*1000,
    geometry:[{latitude:39.9+i*.009,longitude:32.8},{latitude:39.9+(i+1)*.009,longitude:32.8}]}));
  input.route.distanceMeters=count*1000;input.route.drivingDurationSeconds=count*60;
  input.weather=input.route.segments.map((s,i)=>({...structuredClone(input.weather[0]),queryId:'weather-'+i,segmentId:s.id,location:s.geometry[0],
    validAt:new Date(base+(i*60+30)*1000).toISOString()}));
  return input;
}
