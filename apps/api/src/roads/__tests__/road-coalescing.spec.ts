import {normalizeRoadTrip} from '../normalize-road';
import {config,roadRequest,trip} from './fixtures';
import {simplifyDisplayGeometry} from '../geometry';
describe('Bounded road segmentation at shape vertices',()=>{
  it('retimes local over-limit maneuver allocations and propagates the increased ETA without changing road geometry',()=>{
    const source=trip(),leg=source.legs[0];leg.geometry=[{latitude:39.9,longitude:32.8},{latitude:39.905,longitude:32.8},{latitude:39.91,longitude:32.8}];
    leg.maneuvers=[{begin:0,end:2,seconds:120,instruction:'Synthetic mixed-speed maneuver',type:1}];
    leg.edges=[{begin:0,end:1,sourceEdgeId:'slow-edge',osmWayId:null,roadClass:'local',speedLimit:20},
      {begin:1,end:2,sourceEdgeId:'fast-edge',osmWayId:null,roadClass:'local',speedLimit:60}];
    const result=normalizeRoadTrip(source,roadRequest(),config,new Map());
    expect(result.distanceMeters).toBe(1000);expect(result.drivingDurationSeconds).toBeCloseTo(150,5);
    expect(result.segments.every(s=>s.expectedSpeedKph<=s.speedLimitKph!+.0001)).toBe(true);
    expect(result.metadata?.warnings).toContain('road_duration_adjusted_to_speed_limits');expect(leg.seconds).toBe(120);
  });
  it('coalesces compatible dense vertices while retaining exact distance, time, terrain and source edges',()=>{
    const source=trip(),leg=source.legs[0],count=12000;
    leg.geometry=Array.from({length:count+1},(_,i)=>({latitude:39.9+i/count*.01,longitude:32.8}));
    leg.distanceMeters=1000;leg.seconds=120;leg.maneuvers=[{begin:0,end:count,seconds:120,instruction:'Dense synthetic road',type:1}];leg.edges=[];
    const route=normalizeRoadTrip(source,roadRequest(),{...config,maxSegments:100},new Map());
    expect(route.segments.length).toBeLessThan(20);expect(route.distanceMeters).toBe(1000);expect(route.drivingDurationSeconds).toBeCloseTo(120,8);
    expect(route.segments.reduce((n,s)=>n+(s.elevationGainMeters??0),0)).toBeCloseTo(20,6);
    expect(route.segments.reduce((n,s)=>n+(s.elevationLossMeters??0),0)).toBeCloseTo(20,6);
    expect(new Set(route.segments.flatMap(s=>s.sourceEdgeIds)).size).toBe(count);
  });
  it('does not bridge a marked charging-access boundary',()=>{
    const source=trip(),second=structuredClone(source.legs[0]);second.geometry=second.geometry.map(p=>({...p,latitude:p.latitude+.01}));source.legs.push(second);
    const route=normalizeRoadTrip(source,roadRequest(),config,new Map());expect(route.segments.some(s=>s.endsAtChargingAccess)).toBe(true);expect(route.segments.some(s=>s.startsAtChargingAccess)).toBe(true);
  });
  it('simplifies collinear display vertices without replacing a bend with a straight connection',()=>{
    const points=[{latitude:40,longitude:30},{latitude:40,longitude:30.001},{latitude:40,longitude:30.002},{latitude:40.002,longitude:30.002}];
    const simple=simplifyDisplayGeometry(points,1);expect(simple).toEqual([points[0],points[2],points[3]]);
  });
});
