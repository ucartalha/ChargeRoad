import type {RoadRoute,WeatherQuery,RouteWeatherRequest,WeatherForecast} from '@chargeroad/shared';
import {weatherSampleDistanceLimit} from '@chargeroad/shared';
import type {PlanningWeather} from './planning-weather-policy';
import {sampleRouteWeather} from './weather-sampler';
import {meters} from '../roads/geometry';

/** Experimental v2: geometry/DEM gates first; a single post-evaluation refinement follows. */
export function sampleAdaptiveWeather(input:RouteWeatherRequest,planning:PlanningWeather|undefined,travelled:number,
  soc:number,reserve:number,critical=false){
  const initial=sampleRouteWeather(input,planning,travelled),route=input.route;
  // A 35km cell can only share where the entire local neighbourhood is homogeneous.
  const safe=(distance:number,bearing:number)=>route.segments.filter(s=>Math.abs((s.startDistanceMeters+s.endDistanceMeters)/2-distance)<=35000)
    .every(s=>{
      const heights=s.elevationProfile?.map(p=>p.elevationMeters);
      return ['motorway','primary'].includes(s.roadClass)&&['verified','modelled'].includes(s.elevationQuality??'unknown')&&
        !!heights&&Math.max(...heights)-Math.min(...heights)<=60&&
        Math.abs(((s.bearingDegrees-bearing+540)%360)-180)<=15&&
        (s.elevationGainMeters??Infinity)+(s.elevationLossMeters??Infinity)<=s.distanceMeters*.02&&!s.startsAtChargingAccess&&!s.endsAtChargingAccess;
    });
  const steps=route.segments.map(segment=>{
    const distance=(segment.startDistanceMeters+segment.endDistanceMeters)/2,progress=travelled+distance;
    // Only selects where to spend detail; catalogue range is NOT a reachability certificate.
    const reserveHorizon=planning?.rangeKm==null?null:planning.rangeKm*1000*Math.max(0,soc-reserve)/100;
    const reserveRisk=reserveHorizon!==null&&distance>=Math.max(0,reserveHorizon*.85-15000)&&distance<=reserveHorizon+15000;
    const access=route.segments.some(s=>(s.startsAtChargingAccess||s.endsAtChargingAccess)&&Math.abs(s.startDistanceMeters-distance)<=10000);
    const future=planning&&progress>planning.detailedHorizonMeters;
    const step=critical||soc<=reserve+15?5000:reserveRisk||distance<10000||route.distanceMeters-distance<10000||access?10000:
      safe(distance,segment.bearingDegrees)?future?25000:35000:15000;
    return {step,future:!!future,risk:(step<=10000?'critical':step===35000?'homogeneous':'normal') as 'critical'|'homogeneous'|'normal'};
  });
  const anchors=[{distance:0,location:route.segments[0].geometry[0]}];
  for(let i=0;i<route.segments.length;i++){
    const segment=route.segments[i];if(i>0&&steps[i].step!==steps[i-1].step||segment.startDistanceMeters-anchors.at(-1)!.distance>=steps[i].step)
      anchors.push({distance:segment.startDistanceMeters,location:segment.geometry[0]});
  }
  anchors.push({distance:route.distanceMeters,location:route.segments.at(-1)!.geometry.at(-1)!});
  for(const query of initial.queries){const index=route.segments.findIndex(s=>s.id===query.segmentId),segment=route.segments[index],s=steps[index];
    query.samplingResolution={policyVersion:'range-adaptive/2.0.0',phase:s.future?'future':'near_term',intervalMeters:s.step as 5000|10000|15000|25000|35000,
      maxSampleDistanceMeters:s.step/2,risk:s.risk};
    const heights=segment.elevationProfile?.map(p=>p.elevationMeters);
    if(heights){query.sampleElevationMeters=(Math.max(...heights)+Math.min(...heights))/2;query.sampleReliefMeters=Math.max(...heights)-Math.min(...heights);}
    const anchor=anchors.reduce((a,b)=>meters(query.location,a.location)<meters(query.location,b.location)?a:b);
    query.sampleLocation=anchor.location;
    // A nearby point on the opposite shore/hairpin may be far along the actual road.
    // Geodesic proximity alone does not authorize sharing. 1m covers route rounding only.
    const routeOffset=Math.abs(anchor.distance-(segment.startDistanceMeters+segment.endDistanceMeters)/2);
    if(!heights||routeOffset>weatherSampleDistanceLimit(query.samplingResolution)+1||meters(query.location,query.sampleLocation)>weatherSampleDistanceLimit(query.samplingResolution))query.sampleLocation=query.location;
  }
  return {...initial,queries:initial.queries,samples:[...new Map(initial.queries.map(q=>[JSON.stringify(q.sampleLocation),q.sampleLocation!])).values()]};
}
export function adaptiveWeatherNeedsRefinement(forecasts:WeatherForecast[]){
  const v=(w:WeatherForecast)=>{const radians=(w.windFromDegrees??0)*Math.PI/180;return [(w.windSpeedKph??0)*Math.sin(radians),(w.windSpeedKph??0)*Math.cos(radians)];};
  for(let i=0;i<forecasts.length;i++){
    const a=forecasts[i];if(a.status!=='available'||a.temperatureCelsius===null||a.windSpeedKph===null)return true;
    if(i){const b=forecasts[i-1],x=v(a),y=v(b);if(Math.hypot(x[0]-y[0],x[1]-y[1])>10||Math.abs(a.temperatureCelsius-b.temperatureCelsius!)>3)return true;}
  }return false;
}
