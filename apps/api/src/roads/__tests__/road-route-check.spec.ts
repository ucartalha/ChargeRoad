import {roadRouteSchema} from '@chargeroad/shared';
import {normalizeRoadTrip} from '../normalize-road';
import {roadRouteFastCheck} from '../road-route-check';
import {config,roadRequest,trip,tags} from './fixtures';

// Copy-free road route check (2026-11-20): normalizeRoadTrip re-validated each normalized route with a full Zod parse
// (1.1 GB of 6.5 GB Zod allocations in 5 long plans). The fast check accepts only what the schema accepts, using the schema's
// own route and segment rules; anything else goes through the same Zod parse, which throws the same error.
function routes(){
  const none=new Map(),speed=new Map([['123',tags({maxspeed:'90'})]]);
  const half={...roadRequest(),segmentationPolicy:{...roadRequest().segmentationPolicy,maxDistanceMeters:roadRequest().segmentationPolicy.maxDistanceMeters/4}};
  return [normalizeRoadTrip(trip(),roadRequest(),config,none),normalizeRoadTrip(trip(),roadRequest(),config,speed),normalizeRoadTrip(trip(),half,config,none)]
    .map(r=>JSON.parse(JSON.stringify(r)));
}
const set=(value:unknown,path:(string|number)[],next:unknown)=>{const copy=structuredClone(value) as Record<string|number,unknown>;let at=copy;
  for(const key of path.slice(0,-1))at=at[key] as Record<string|number,unknown>;if(next===undefined)delete at[path.at(-1)!];else at[path.at(-1)!]=next;return copy;};
describe('Road route fast check',()=>{
  it('accepts real normalized routes and returns exactly what the Zod parse returns (same JSON, same key order)',()=>{
    for(const r of routes()){expect(roadRouteFastCheck(r)).toBe(true);expect(JSON.stringify(roadRouteSchema.parse(r))).toBe(JSON.stringify(r));}
  });
  it('never accepts what the schema rejects (shape, ranges, segment and route rules)',()=>{
    const bad:[(string|number)[],unknown][]=[[['id'],''],[['distanceMeters'],0],[['distanceMeters'],999999],[['drivingDurationSeconds'],-1],[['extra'],1],
      [['segments'],[]],[['segments',0,'id'],''],[['segments',0,'sourceEdgeIds'],[]],[['segments',0,'geometry'],[{latitude:1,longitude:1}]],
      [['segments',0,'geometry',0,'latitude'],95],[['segments',0,'roadClass'],'highway'],[['segments',0,'bearingDegrees'],360],
      [['segments',0,'expectedSpeedKph'],999],[['segments',0,'distanceMeters'],1],[['segments',0,'speedLimitKph'],0],[['segments',0,'speedLimitKind'],'maybe'],
      [['segments',0,'elevationGainMeters'],12345],[['segments',0,'elevationProfile',0,'distanceFromStartMeters'],5],[['segments',0,'elevationQuality'],'great'],
      [['segments',0,'startsAtChargingAccess'],'no'],[['segments',0,'extra'],1],[['segments',0,'speedProfile'],[{elapsedSeconds:0,speedKph:1}]],
      [['segments',1,'startDistanceMeters'],7],[['segments',1,'id'],'dup'],[['segments',1,'geometry',0,'latitude'],0],
      [['segmentationPolicy','splitAtRoadClassChanges'],false],[['segmentationPolicy','maxDistanceMeters'],1],[['source','url'],'nope'],
      [['metadata','traffic'],'heavy'],[['metadata','departureUsedAt'],'now'],[['metadata','attributions'],[{text:'x',url:'bad',license:'y'}]],
      [['metadata','maneuvers'],[{instruction:'x',type:1.5,startDistanceMeters:0,endDistanceMeters:1}]],[['metadata','usage'],'prod']];
    for(const r of routes()){
      const segments=(r as {segments:unknown[]}).segments;
      for(const [path,value] of bad){
        if(path[0]==='segments'&&typeof path[1]==='number'&&path[1]>=segments.length)continue;
        let mutated=set(r,path,value);
        if(path.join('.')==='segments.1.id')mutated=set(mutated,['segments',0,'id'],'dup');
        if(roadRouteSchema.safeParse(mutated).success)continue;
        expect([path.join('.'),roadRouteFastCheck(mutated)]).toEqual([path.join('.'),false]);
      }
    }
  });
});
