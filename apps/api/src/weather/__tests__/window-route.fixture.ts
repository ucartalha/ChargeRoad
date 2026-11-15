import type {RouteWeatherRequest} from '@chargeroad/shared';
import {normalizeRoadTrip} from '../../roads/normalize-road';
import {trip,roadRequest,config} from '../../roads/__tests__/fixtures';
export function windowRoute(km:number):RouteWeatherRequest{
 const route=normalizeRoadTrip(trip(),roadRequest(),config,new Map()),base=route.segments[0];
 route.id='window-'+km;route.distanceMeters=km*1000;route.drivingDurationSeconds=km*36;
 route.segments=Array.from({length:km},(_,i)=>({...structuredClone(base),id:'segment-'+i,startDistanceMeters:i*1000,endDistanceMeters:(i+1)*1000,
  distanceMeters:1000,drivingDurationSeconds:36,expectedSpeedKph:100,speedLimitKph:null,speedLimitKind:'unknown',
  geometry:[{latitude:39.9+i/111.195,longitude:32.8},{latitude:39.9+(i+1)/111.195,longitude:32.8}],
  elevationProfile:[{distanceFromStartMeters:0,elevationMeters:800},{distanceFromStartMeters:1000,elevationMeters:800}],
  elevationGainMeters:0,elevationLossMeters:0,startsAtChargingAccess:false,endsAtChargingAccess:false}));
 return {route,departureAt:new Date(Date.now()+300000).toISOString(),stops:[]};
}
