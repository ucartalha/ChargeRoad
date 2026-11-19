import { measureRoadTrip,normalizeRoadTrip } from '../normalize-road';
import { config,roadRequest,tags,trip } from './fixtures';
import type { RoadTripInput } from '../provider-ports';

// Station access only needs a route's totals; the measure path must report what the normalized route reports.
function multiInterval(speedLimit:number|null,maxspeed?:string):RoadTripInput{
  const t=trip(),leg=t.legs[0],o=roadRequest().origin;
  leg.geometry=Array.from({length:9},(_,i)=>({latitude:o.latitude+i*0.004,longitude:o.longitude+(i%3)*0.003}));
  leg.distanceMeters=4100;leg.seconds=180;
  leg.maneuvers=[{begin:0,end:3,seconds:40,instruction:'a',type:1},{begin:3,end:8,seconds:139,instruction:'b',type:1}];
  leg.elevation={intervalMeters:30,values:Array.from({length:Math.ceil(4100/30)+1},(_,i)=>100+Math.sin(i/4)*8)};
  leg.edges=[{begin:0,end:4,sourceEdgeId:'e1',osmWayId:maxspeed?'123':null,forward:true,roadClass:'primary',speedLimit},
    {begin:4,end:8,sourceEdgeId:'e2',osmWayId:null,forward:true,roadClass:'motorway',speedLimit:255}];
  return t;
}
describe('measureRoadTrip',()=>{
  it.each([
    ['fixture',()=>trip(),new Map()],
    ['OSM limit slows a fast maneuver',()=>multiInterval(null,'50'),new Map([['123',tags({maxspeed:'50'})]])],
    ['provider limit and unlimited edge',()=>multiInterval(40),new Map()],
    ['no limits',()=>multiInterval(null),new Map()],
  ])('matches normalizeRoadTrip totals: %s',(_,make,wayTags)=>{
    const route=normalizeRoadTrip(make(),roadRequest(),config,wayTags as never),totals=measureRoadTrip(make(),wayTags as never);
    expect(totals.distanceMeters).toBe(route.distanceMeters);
    expect(Math.abs(totals.drivingDurationSeconds-route.drivingDurationSeconds)).toBeLessThan(1e-6);
  });
  it('rejects the same malformed trips as normalization',()=>{
    const bad=trip();bad.legs[0].maneuvers=[];
    expect(()=>normalizeRoadTrip(bad,roadRequest(),config,new Map())).toThrow('Road maneuver durations missing');
    expect(()=>measureRoadTrip(bad,new Map())).toThrow('Road maneuver durations missing');
  });
});
