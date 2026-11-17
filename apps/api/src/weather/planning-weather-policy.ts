import {z} from 'zod';
import {sourceReferenceSchema,coordinateSchema} from '@chargeroad/shared';
import type {VehicleEnergyProfile,RoadRoute} from '@chargeroad/shared';
import {interpolate,meters} from '../roads/geometry';
import {chooseGridDegrees} from './weather-grid';

export const PLANNING_WEATHER_POLICY={version:'range-adaptive/1.0.0',longRouteMeters:200000,nearStepMeters:15000,futureStepMeters:25000,
  partitionThresholdMeters:1000000,futurePartitions:25,rangeFraction:.85,maxSegmentPasses:32,maxSegmentEvaluations:200000,maxSamples:128} as const;
export const catalogueRangeSchema=z.object({rangeKm:z.number().positive().max(20000),cycle:z.string(),source:sourceReferenceSchema});
export type CatalogueRange=z.infer<typeof catalogueRangeSchema>;
export const planningWeatherSchema=z.object({version:z.literal('range-adaptive/1.0.0'),routeMeters:z.number().positive().max(20000000),
  rangeKm:z.number().positive().nullable(),rangeBasis:z.enum(['catalogue','capacity_consumption_estimate','fixed_window_no_range_reference']),rangeReferenceIds:z.array(z.string()),rangeSource:sourceReferenceSchema.nullable(),
  detailedHorizonMeters:z.number().nonnegative(),futureStepMeters:z.number().positive().max(800000),
  anchors:z.array(z.object({distanceMeters:z.number().nonnegative(),location:coordinateSchema})).min(2).max(128),
  // W4: present only when the global grid is enabled for this plan; absent keeps legacy anchors (and old replays).
  gridDegrees:z.union([z.literal(0.1),z.literal(0.2)]).optional()});
export type PlanningWeather=z.infer<typeof planningWeatherSchema>;
export function samplingRange(vehicle:VehicleEnergyProfile,catalogue:CatalogueRange|null){
  if(catalogue?.source.license)return {rangeKm:catalogue.rangeKm,rangeBasis:'catalogue' as const,rangeReferenceIds:[catalogue.source.sourceId+':'+catalogue.cycle],rangeSource:catalogue.source};
  const refs=vehicle.consumptionReferences.filter(r=>r.source.license&&r.energyBoundary==='battery_dc'&&r.includedEffects.chargingLosses==='excluded');
  if(!vehicle.capacity.source.license||!refs.length)return {rangeKm:null,rangeBasis:'fixed_window_no_range_reference' as const,rangeReferenceIds:[],rangeSource:null};
  // Conservative selection among licensed reference rates; this defines sampling only, never physical reachability.
  const ref=[...refs].sort((a,b)=>b.valueKwhPer100Km-a.valueKwhPer100Km||a.id.localeCompare(b.id))[0];
  return {rangeKm:vehicle.capacity.referenceUsableBatteryKwh/ref.valueKwhPer100Km*100,rangeBasis:'capacity_consumption_estimate' as const,rangeReferenceIds:[ref.id],rangeSource:ref.source};
}
function pointAt(route:RoadRoute,distance:number){
  const segment=route.segments.find(s=>s.endDistanceMeters>=distance)??route.segments.at(-1)!,span=segment.geometry.slice(1).map((p,i)=>meters(segment.geometry[i],p));
  let remaining=span.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,(distance-segment.startDistanceMeters)/segment.distanceMeters)),i=0;
  while(i<span.length-1&&remaining>span[i])remaining-=span[i++];
  return interpolate(segment.geometry[i],segment.geometry[i+1],span[i]===0?0:remaining/span[i]);
}
export function buildPlanningWeather(route:RoadRoute,range:ReturnType<typeof samplingRange>,options:{grid?:boolean}={}):PlanningWeather{
  const gridDegrees=options.grid?chooseGridDegrees(route):undefined;
  const p=PLANNING_WEATHER_POLICY,total=route.distanceMeters,
    horizon=total<=p.longRouteMeters?total:Math.min(total,range.rangeKm===null?p.longRouteMeters:range.rangeKm*1000*p.rangeFraction),
    future=total>p.partitionThresholdMeters?(total-horizon)/p.futurePartitions:p.futureStepMeters,
    distances=new Set<number>([0,horizon,total]);
  for(let d=p.nearStepMeters;d<horizon;d+=p.nearStepMeters)distances.add(d);
  if(total>horizon)for(let i=1;horizon+i*future<total-1e-5;i++)distances.add(horizon+i*future);
  return planningWeatherSchema.parse({version:p.version,routeMeters:total,...range,detailedHorizonMeters:horizon,futureStepMeters:future||p.futureStepMeters,
    anchors:[...distances].sort((a,b)=>a-b).map(distanceMeters=>({distanceMeters,location:pointAt(route,distanceMeters)})),
    ...(gridDegrees===undefined?{}:{gridDegrees})});
}
