import type {Coordinate,WeatherQuery} from '@chargeroad/shared';
import {meters} from '../roads/geometry';
import {WEATHER_POLICY,WEATHER_SAMPLING_POLICY as policy} from './weather-policy';

/** Deterministic rectangular cells; provider coordinates remain separately checked within 30 m. */
export function weatherSampleLocation(query:WeatherQuery):Coordinate{
  const sample=query.sampleLocation??query.location;
  if(query.sampleElevationMeters===undefined||query.sampleReliefMeters===undefined||query.sampleReliefMeters>=policy.terrainReliefMeters)return sample;
  const center=(v:number,max:number)=>Math.max(-max,Math.min(max,Number(((Math.floor(v/policy.spatialGridDegrees)+.5)*policy.spatialGridDegrees).toFixed(6))));
  const cell={latitude:center(sample.latitude,90),longitude:center(sample.longitude,180)};
  return meters(sample,cell)<=policy.spatialMaxOffsetMeters&&meters(query.location,cell)<=WEATHER_POLICY.sampleDistanceMeters?cell:sample;
}

export function terrainSharingIsSafe(query:WeatherQuery,elevation:number|null){
  return elevation!==null&&query.sampleElevationMeters!==undefined&&Math.abs(elevation-query.sampleElevationMeters)<=policy.spatialMaxElevationDeltaMeters;
}
