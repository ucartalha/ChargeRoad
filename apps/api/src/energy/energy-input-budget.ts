import type {RoadRoute} from '@chargeroad/shared';
/** Shared terrain endpoints are one input knot represented by both adjoining segments. */
export function energyInputUsage(route:RoadRoute){
  let geometryPoints=0,elevationPoints=0,uniqueElevationPoints=0,speedPoints=0;
  let previous:{distance:number;height:number}|null=null;
  for(const segment of route.segments){
    geometryPoints+=segment.geometry.length;speedPoints+=segment.speedProfile?.length??0;
    const profile=segment.elevationProfile;elevationPoints+=profile?.length??0;uniqueElevationPoints+=profile?.length??0;
    const first=profile?.[0];
    if(first&&previous&&Math.abs(segment.startDistanceMeters+first.distanceFromStartMeters-previous.distance)<1e-6&&
      Math.abs(first.elevationMeters-previous.height)<1e-6)uniqueElevationPoints--;
    const last=profile?.at(-1);previous=last?{distance:segment.startDistanceMeters+last.distanceFromStartMeters,height:last.elevationMeters}:null;
  }
  return {segments:route.segments.length,geometryPoints,elevationPoints,uniqueElevationPoints,speedPoints};
}
