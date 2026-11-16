const {test}=require('node:test'),assert=require('node:assert/strict'),{isDeepStrictEqual}=require('node:util');
const h=require('../scripts/navigation-performance-fixtures.cjs'),{before,after,Index}=h.load();
const equal=(a,b)=>assert.ok(isDeepStrictEqual(a,b),'NAVIGATION_OUTCOME_MISMATCH (raw data suppressed)');
for(const size of [200,1000,5000,15000])for(const layout of ['polyline','segments'])for(const shape of ['regular','hotspot','loopback','parallel','antimeridian'])
 test(`offline index preserves original source: ${size}/${layout}/${shape}`,()=>{
  const w=h.fixture(size,layout,shape),copy=structuredClone(w),index=new Index(w.route);
  equal(h.sequence(after,w,index,true),h.sequence(before,w,undefined,true));equal(w,copy);index.dispose();
 });
test('index owns cached data, keeps input mutable and disposes without stale results',()=>{
 const w=h.fixture(200),index=new Index(w.route),entry=index.segment(w.route,w.route.segments[0],0);
 assert.ok(Object.isFrozen(entry));assert.ok(Object.isFrozen(entry.lengths));assert.equal(Object.isFrozen(w.route),false);assert.equal(Object.isFrozen(w.route.segments[0].geometry),false);
 index.dispose();assert.equal(index.segment(w.route,w.route.segments[0],0),null);equal(h.sequence(after,w,index,true),h.sequence(before,w,undefined,true));index.dispose();
});
for(const change of ['revision','plan','algorithm','newGeometry','coordinate','segment','segmentOrder','newRoute'])test(`invalidates stale index: ${change}`,()=>{
 let w=h.fixture(200,'segments');const index=new Index(w.route);
 if(change==='revision')w.route.revision++;
 if(change==='plan')w.route.planId+='-new';
 if(change==='algorithm')w.route.algorithmVersion+='-new';
 if(change==='newGeometry')w.route.segments[0].geometry=structuredClone(w.route.segments[0].geometry);
 if(change==='coordinate')w.route.segments[0].geometry[0].longitude+=.00001;
 if(change==='segment')w.route.segments[0]={...w.route.segments[0]};
 if(change==='segmentOrder')[w.route.segments[0],w.route.segments[1]]=[w.route.segments[1],w.route.segments[0]];
 if(change==='newRoute')w={...w,route:structuredClone(w.route)};
 assert.equal(index.segment(w.route,w.route.segments[0],0),null);equal(h.sequence(after,w,index,true),h.sequence(before,w,undefined,true));
});
for(const kind of ['zero-edge','single-point','empty','zero-segment','misaligned','regen'])test(`keeps original boundary behavior: ${kind}`,()=>{
 const w=h.fixture(200,'segments'),s=w.route.segments[0];
 if(kind==='zero-edge')s.geometry[1]=structuredClone(s.geometry[0]);
 if(kind==='single-point')s.geometry.pop();if(kind==='empty')s.geometry=[];
 if(kind==='zero-segment')s.end=s.start;if(kind==='misaligned')s.start=8;if(kind==='regen')s.endSoc=s.startSoc+2;
 const index=new Index(w.route);equal(h.sequence(after,w,index,true),h.sequence(before,w,undefined,true));index.dispose();
});
test('invalid GPS exits without consulting geometry/index, including a protected route getter',()=>{
 const w=h.fixture(200),badRoute={get segments(){throw Error('GEOMETRY_MUST_NOT_BE_READ');}},index={segment(){throw Error('INDEX_MUST_NOT_BE_READ');}};
 for(const patch of [{latitude:NaN},{latitude:Infinity},{longitude:Infinity},{accuracy:null},{accuracy:51},{accuracy:-1},{timestamp:h.now-15001},{timestamp:h.now+2001}]){
  const fix={...w.fixes[0],...patch};assert.equal(after.navigationProgress(badRoute,fix,h.now,w.anchor,undefined,index),null);
 }
 for(const patch of [{timestamp:h.now-15000},{timestamp:h.now+2000},{accuracy:50},{accuracy:0}])equal(after.validFix({...w.fixes[0],...patch},h.now),before.validFix({...w.fixes[0],...patch},h.now));
});
test('same timestamp, huge jump, reverse fixes and off-route classes retain exact continuity',()=>{
 const w=h.fixture(1000,'segments','loopback');w.fixes=[w.fixes[0],{...w.fixes[10],timestamp:w.fixes[0].timestamp},
  {...w.fixes[31],longitude:30},w.fixes[3],w.fixes[2],{...w.fixes[4],accuracy:50}];
 const index=new Index(w.route);equal(h.sequence(after,w,index,true),h.sequence(before,w,undefined,true));index.dispose();
});
test('stop/arrival/maneuver boundaries, manual anchors and replan provenance match before source',()=>{
 const w=h.fixture(200,'segments'),index=new Index(w.route),request={requestId:'synthetic',destination:{latitude:41,longitude:30},constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20}};
 for(const distance of [0,908,919.999999,920,920.000001,988,1000,1000.00001,1959.999999,1960,1960.000001,2000]){
  const fix={...w.fixes[0],latitude:40+distance/10*.0001,longitude:29},anchor={...w.anchor,distance:1000,percent:75,stopId:'synthetic-stop'};
  const a=before.navigationProgress(w.route,fix,fix.timestamp,anchor),b=after.navigationProgress(w.route,fix,fix.timestamp,anchor,undefined,index);equal(a,b);
  if(a)for(const observed of [undefined,45])equal(before.replanFromNavigation(request,w.route,fix,a,'synthetic',h.now,observed),after.replanFromNavigation(request,w.route,fix,b,'synthetic',h.now,observed));
 }index.dispose();
});
test('restore creates a fresh snapshot; an old route index cannot be reused',()=>{
 const {decodeTrip}=require('../src/features/navigation/trip-storage.ts'),{planningApiRequestSchema}=require('@chargeroad/shared');
 const w=h.fixture(200,'segments'),index=new Index(w.route),id='11111111-1111-4111-8111-111111111111';
 const request=planningApiRequestSchema.parse({schemaVersion:'1.0.0',requestId:id,origin:{latitude:40,longitude:29},destination:{latitude:41,longitude:30},vehicleVariantId:id,
  departureAt:new Date(h.now+60000).toISOString(),startingChargePercent:80,startingChargeObservedAt:new Date(h.now).toISOString(),constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20}});
 const saved=decodeTrip(JSON.stringify({version:1,id,updatedAt:h.now,status:'active',request,route:w.route,anchor:w.anchor,progress:null,events:[]}),h.now);
 assert.ok(saved);assert.equal(saved.status,'paused');assert.equal(saved.progress,null);assert.equal(index.segment(saved.route,saved.route.segments[0],0),null);
});
