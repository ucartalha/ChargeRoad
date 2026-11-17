import type {RoadRoute,RoadSegment} from '@chargeroad/shared';

/** chargeroad-energy 1.4.0 (2026-11-17, user decision, ADR-009 note): a DEM samples the ground surface, not the road, so
 *  30 m modelled knots add false climb/descend cycles through cuts and fills (reference routes: ~2.5x the 1 km climb).
 *  For the physical integration only, every knot of a `modelled` segment becomes the mean elevation over a centred distance
 *  window along the whole route (trapezoid integral, independent of knot spacing). The window shrinks symmetrically at the
 *  route ends, so leg start/end elevations (net climb) are kept. `verified` terrain and the raw road data (QA, gain/loss,
 *  weather gates) are never changed. Returns replacement segments by id; empty when nothing applies. */
export function windowedElevation(route:RoadRoute,windowMeters:number):Map<string,RoadSegment>{
  const out=new Map<string,RoadSegment>();
  if(!(windowMeters>0)||!route.segments.some(s=>s.elevationQuality==='modelled'&&s.elevationProfile))return out;
  const xs:number[]=[],zs:number[]=[];
  for(const s of route.segments)for(const p of s.elevationProfile??[]){xs.push(s.startDistanceMeters+p.distanceFromStartMeters);zs.push(p.elevationMeters);}
  if(xs.length<2)return out;
  for(let i=1;i<xs.length;i++)if(xs[i]<xs[i-1]-1e-6)return out; // unordered knots: no window rather than a wrong one
  const area=[0];for(let i=1;i<xs.length;i++)area.push(area[i-1]+(xs[i]-xs[i-1])*(zs[i]+zs[i-1])/2);
  const first=xs[0],last=xs[xs.length-1];
  const lastAtOrBefore=(x:number)=>{let lo=0,hi=xs.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(xs[mid]<=x)lo=mid;else hi=mid-1;}return lo;};
  const integral=(x:number)=>{
    if(x<=first)return 0;if(x>=last)return area[area.length-1];
    const i=lastAtOrBefore(x),j=i+1,z=zs[i]+(zs[j]-zs[i])*(x-xs[i])/(xs[j]-xs[i]);
    return area[i]+(x-xs[i])*(zs[i]+z)/2;
  };
  const mean=(x:number,raw:number)=>{const half=Math.min(windowMeters/2,x-first,last-x);
    return half>1e-9?(integral(x+half)-integral(x-half))/(2*half):raw;};
  for(const s of route.segments){
    if(s.elevationQuality!=='modelled'||!s.elevationProfile)continue;
    out.set(s.id,{...s,elevationProfile:s.elevationProfile.map(p=>({...p,elevationMeters:mean(s.startDistanceMeters+p.distanceFromStartMeters,p.elevationMeters)}))});
  }
  return out;
}
