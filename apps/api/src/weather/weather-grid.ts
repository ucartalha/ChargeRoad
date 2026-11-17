import type {Coordinate,RoadRoute} from '@chargeroad/shared';
import {WEATHER_POLICY} from './weather-policy';

/**
 * W4 global weather grid. A segment reads the series of the fixed lat/lon cell its midpoint lies in, so every
 * route crossing that cell (any origin, any direction) uses the same MET URL and therefore the same cache row.
 * One cell size per plan; 0.2 deg only when 0.1 deg would not fit the per-plan sample budget. Max centre-to-segment
 * distance is ~6.9 km (0.1) / ~13.9 km (0.2), inside the existing 15 km near-term limit.
 */
export const WEATHER_GRID_POLICY={version:'weather-grid/1.0.0',degrees:[0.1,0.2] as const,maxBaseCells:96,
  maxElevationDeltaMeters:100,
  // Below the lowest land on Earth (~-430 m): provider no-data markers such as Valhalla's -499.9 mean "unknown".
  minPlausibleElevationMeters:-430} as const;
export type WeatherGridDegrees=typeof WEATHER_GRID_POLICY.degrees[number];

/** On by default (user decision 2026-11-17); WEATHER_GRID_ENABLED=false restores route-relative anchors. */
export function weatherGridEnabled(value=process.env.WEATHER_GRID_ENABLED){return value!=='false';}

export function gridCellCenter(location:Coordinate,degrees:number):Coordinate{
  const centre=(v:number)=>Number(((Math.floor(v/degrees+1e-9)+.5)*degrees).toFixed(4));
  return {latitude:centre(location.latitude),longitude:centre(location.longitude)};
}

function cellsOf(route:RoadRoute,degrees:number){
  const cells=new Set<string>();
  for(const s of route.segments){if(!s.elevationProfile?.length||s.elevationProfile.some(p=>p.elevationMeters<=WEATHER_GRID_POLICY.minPlausibleElevationMeters))continue;
    const a=s.geometry[0],b=s.geometry.at(-1)!,c=gridCellCenter({latitude:(a.latitude+b.latitude)/2,longitude:(a.longitude+b.longitude)/2},degrees);
    cells.add(c.latitude+','+c.longitude);}
  return cells.size;
}

/** Deterministic per base route; undefined means the plan keeps the legacy route-relative anchors. */
export function chooseGridDegrees(route:RoadRoute):WeatherGridDegrees|undefined{
  for(const degrees of WEATHER_GRID_POLICY.degrees)if(cellsOf(route,degrees)<=WEATHER_GRID_POLICY.maxBaseCells)return degrees;
  return cellsOf(route,0.2)<=WEATHER_POLICY.maxSamples?0.2:undefined;
}
