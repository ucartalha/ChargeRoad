import {selectAccessibleCandidates,STATION_ACCESS_POLICY} from '../catalogue-station-scenario';

// Station access (station-access/1.0.0): a station next to the motorway can still cost a long U-turn when it sits in the
// other direction's service area. Each progress bin keeps a candidate whose measured access detour (approach 1 km before
// -> station -> 1 km after, in travel direction) is within 3 km and 3 min; only when none is, the smallest detour is kept.
const route={id:'r',distanceMeters:100000,segments:[{id:'s',startDistanceMeters:0,distanceMeters:100000}]} as never;
const candidate=(id:string,progress:number,kw:number,offRoute=20)=>({station:{id,evses:[{connectors:[{powerType:'dc',maxPowerKw:kw}]}]},
  routeMatches:[{routeId:'r',segmentId:'s',distanceMeters:offRoute,segmentProgress:progress}]}) as never;
const ids=(list:{station:{id:string}}[])=>list.map(c=>c.station.id);

describe('Access-aware catalogue candidate selection',()=>{
  it('uses a 3 km / 3 min limit',()=>{
    expect(STATION_ACCESS_POLICY).toMatchObject({maxDetourMeters:3000,maxDetourSeconds:180});
  });
  it('drops a powerful but wrong-direction station when an acceptable one shares its bin',async()=>{
    const detour:Record<string,{additionalMeters:number;additionalSeconds:number}>={far:{additionalMeters:36000,additionalSeconds:1500},near:{additionalMeters:900,additionalSeconds:60}};
    const {chosen,access}=await selectAccessibleCandidates([candidate('far',.12,480),candidate('near',.14,180)],[route],2,async c=>detour[c.station.id]);
    expect(ids(chosen)[0]).toBe('near');expect(access.near).toEqual(detour.near);expect(access.far).toEqual(detour.far);
  });
  it('rejects a station that is short in distance but slow (time limit)',async()=>{
    const detour:Record<string,{additionalMeters:number;additionalSeconds:number}>={slow:{additionalMeters:2500,additionalSeconds:400},ok:{additionalMeters:2800,additionalSeconds:150}};
    const {chosen}=await selectAccessibleCandidates([candidate('slow',.3,400),candidate('ok',.31,150)],[route],2,async c=>detour[c.station.id]);
    expect(ids(chosen)[0]).toBe('ok');
  });
  it('keeps the smallest detour when no station in a bin is acceptable, so a plan stays possible',async()=>{
    const detour:Record<string,{additionalMeters:number;additionalSeconds:number}|null>={a:{additionalMeters:9000,additionalSeconds:500},b:{additionalMeters:5000,additionalSeconds:300},c:null};
    const {chosen}=await selectAccessibleCandidates([candidate('a',.51,400),candidate('b',.52,180),candidate('c',.53,400)],[route],2,async x=>detour[x.station.id]);
    expect(ids(chosen)).toContain('b');expect(ids(chosen).indexOf('b')).toBeLessThan(ids(chosen).indexOf('a')===-1?99:ids(chosen).indexOf('a'));
  });
  // station-access/1.1.0 (2026-11-19, İzmir reference route): a 90 km access detour kept as its bin's fallback was used by the
  // seed and left a plan 70 min slower than one through on-route stations. Over the fallback ceiling a station only fills
  // free slots, after every acceptable, near-acceptable and unmeasured candidate.
  it('does not keep a bin fallback over the detour ceiling while other candidates fill the limit',async()=>{
    const huge={additionalMeters:90600,additionalSeconds:3900},ok={additionalMeters:200,additionalSeconds:20};
    const list=[candidate('huge',.55,400),candidate('a',.05,100),candidate('b',.15,100),candidate('c',.25,100)];
    const {chosen}=await selectAccessibleCandidates(list,[route],3,async c=>c.station.id==='huge'?huge:ok);
    expect(ids(chosen)).not.toContain('huge');expect(chosen.length).toBe(3);
    const wide=await selectAccessibleCandidates(list,[route],4,async c=>c.station.id==='huge'?huge:ok);
    expect(ids(wide.chosen).at(-1)).toBe('huge');
  });
  it('among acceptable stations keeps the existing ranking (closer to the route, then power)',async()=>{
    const ok={additionalMeters:500,additionalSeconds:40};
    const {chosen}=await selectAccessibleCandidates([candidate('slowkw',.7,120),candidate('fastkw',.71,400)],[route],2,async()=>ok);
    expect(ids(chosen)[0]).toBe('fastkw');
  });
  it('measures only perBin candidates when one of them is acceptable, and never returns more than the limit',async()=>{
    const many=Array.from({length:10},(_,i)=>candidate('c'+i,.05+i*.001,100+i));let calls=0;
    const {chosen}=await selectAccessibleCandidates(many,[route],4,async()=>{calls++;return {additionalMeters:100,additionalSeconds:10};});
    expect(calls).toBe(STATION_ACCESS_POLICY.perBin);expect(chosen.length).toBeLessThanOrEqual(4);
  });
  it('looks deeper (up to extendedPerBin) only when the first perBin candidates of a bin are all unacceptable',async()=>{
    const list=Array.from({length:8},(_,i)=>candidate('d'+i,.2+i*.001,400-i));let calls=0;
    const bad={additionalMeters:20000,additionalSeconds:1200},good={additionalMeters:200,additionalSeconds:30};
    const {chosen}=await selectAccessibleCandidates(list,[route],2,async c=>{calls++;return c.station.id==='d4'?good:bad;});
    expect(ids(chosen)[0]).toBe('d4');
    expect(calls).toBe(STATION_ACCESS_POLICY.perBin+(4-STATION_ACCESS_POLICY.perBin+1));
    let deep=0;await selectAccessibleCandidates(list,[route],2,async()=>{deep++;return bad;});
    expect(deep).toBe(STATION_ACCESS_POLICY.extendedPerBin);
  });
  it('runs measurements with bounded concurrency',async()=>{
    const list=Array.from({length:16},(_,i)=>candidate('p'+i,(i+.5)/16,200));let active=0,peak=0;
    await selectAccessibleCandidates(list,[route],16,async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return {additionalMeters:0,additionalSeconds:0};});
    expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(STATION_ACCESS_POLICY.concurrency);
  });
  it('returns nothing for a zero limit without measuring',async()=>{
    let calls=0;const {chosen}=await selectAccessibleCandidates([candidate('x',.5,100)],[route],0,async()=>{calls++;return null;});
    expect(chosen).toEqual([]);expect(calls).toBe(0);
  });
});
