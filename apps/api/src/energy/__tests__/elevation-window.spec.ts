import type {RoadRoute} from '@chargeroad/shared';
import {windowedElevation} from '../elevation-window';
import {ENERGY_POLICY} from '../energy-policy';
import {EnergyConsumptionEngine} from '../energy-engine';
import {energyFixture,terrain} from './fixtures';

// User decision (2026-11-17, ADR-009 note): modelled DEM terrain is averaged over a 300 m distance window before the
// physical integration. A DEM samples the ground, not the road (cuts/fills), so 30 m knots add false climb-descend cycles.
const route=(points:[number,number][],quality:'modelled'|'verified'='modelled',split?:number):RoadRoute=>{
  const f=energyFixture(),base=f.route.segments[0],cut=split??points.at(-1)![0];
  const make=(id:string,start:number,end:number)=>({...structuredClone(base),id,startDistanceMeters:start,endDistanceMeters:end,distanceMeters:end-start,elevationQuality:quality,
    elevationProfile:points.filter(([d])=>d>=start&&d<=end).map(([d,z])=>({distanceFromStartMeters:d-start,elevationMeters:z}))});
  const end=points.at(-1)![0];
  return {...f.route,distanceMeters:end,segments:split?[make('s1',0,cut),make('s2',cut,end)]:[make('s1',0,end)]};
};
const zigzag=(length:number,step=30,amplitude=10):[number,number][]=>Array.from({length:Math.floor(length/step)+1},(_,i)=>[i*step,i%2?amplitude:0]);
const ascent=(values:number[])=>values.slice(1).reduce((n,v,i)=>n+Math.max(0,v-values[i]),0);
const heights=(r:RoadRoute,map:Map<string,RoadRoute['segments'][number]>)=>r.segments.flatMap(s=>(map.get(s.id)??s).elevationProfile!.map(p=>p.elevationMeters));

describe('Energy elevation window (chargeroad-energy 1.4.0)',()=>{
  it('uses a 300 m window',()=>expect(ENERGY_POLICY.elevationWindowMeters).toBe(300));
  it('removes 30 m climb/descend cycles from modelled terrain but keeps the endpoints',()=>{
    const r=route(zigzag(3000)),out=windowedElevation(r,300),z=heights(r,out);
    expect(ascent(z)).toBeLessThan(ascent(zigzag(3000).map(p=>p[1]))*.2);
    expect(z[0]).toBe(0);expect(z.at(-1)).toBe(zigzag(3000).at(-1)![1]);
  });
  it('leaves a constant grade unchanged and stays continuous across segment boundaries',()=>{
    const line=Array.from({length:101},(_,i)=>[i*30,i*30*.05] as [number,number]),r=route(line,'modelled',1500),out=windowedElevation(r,300);
    for(const s of r.segments)for(const [k,p] of out.get(s.id)!.elevationProfile!.entries())
      expect(p.elevationMeters).toBeCloseTo(s.elevationProfile![k].elevationMeters,8);
    expect(out.get('s1')!.elevationProfile!.at(-1)!.elevationMeters).toBeCloseTo(out.get('s2')!.elevationProfile![0].elevationMeters,10);
  });
  it('never changes verified terrain or a disabled window',()=>{
    expect(windowedElevation(route(zigzag(3000),'verified'),300).size).toBe(0);
    expect(windowedElevation(route(zigzag(3000)),0).size).toBe(0);
  });
  it('makes a noisy modelled profile cost about the same as flat road, unlike verified noise',async()=>{
    const energy=async(points:[number,number][],quality:'modelled'|'verified')=>{
      const input=energyFixture();terrain(input,points);const s=input.route.segments[0];s.elevationQuality=quality;
      input.vehicle.energyModel!.regeneration.efficiency=.65;input.vehicle.physics.drivetrainEfficiency=.9;
      const r=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);expect(r.status).not.toBe('insufficient_data');return r;};
    const noise=zigzag(1000).filter(([d])=>d<=1000).concat([[1000,0]]) as [number,number][];
    const flat=(await energy([[0,0],[1000,0]],'modelled')).netBatteryEnergyKwh;
    const modelled=await energy(noise,'modelled'),verified=(await energy(noise,'verified')).netBatteryEnergyKwh;
    expect(verified-flat).toBeGreaterThan(0);
    expect(modelled.netBatteryEnergyKwh-flat).toBeLessThan((verified-flat)*.25);
    expect(modelled.assumptions).toContain('modelled_elevation_distance_window_300m');
  });
});
