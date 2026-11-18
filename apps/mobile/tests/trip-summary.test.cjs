const {test}=require('node:test');const assert=require('node:assert/strict');
const {formatDuration,socSkyline,tripFacts,tripSeconds}=require('../src/features/planning/trip-summary.ts');
// Minimal synthetic plan: 400 km, start 100 %, one stop at 200 km (30 % -> 80 %), arrival 20 %.
const plan=(stops=[{routeDistanceMeters:200000,arrivalChargePercent:30,targetChargePercent:80}])=>({
  roadRoute:{distanceMeters:400000},energySegments:[{startChargePercent:100}],estimatedArrivalChargePercent:20,
  chargingStops:stops,duration:{totalSeconds:null,drivingSeconds:14400,chargingSeconds:1200,connectionSeconds:120},scenario:{totalSeconds:15720}});
test('durations read naturally in Turkish',()=>{
  assert.equal(formatDuration(45*60),'45 dk');assert.equal(formatDuration(120*60),'2 sa');assert.equal(formatDuration(262*60),'4 sa 22 dk');
});
test('the skyline drains, jumps at the stop and ends at the arrival level',()=>{
  const bars=socSkyline(plan(),8);
  assert.equal(bars.length,8);assert.equal(bars.filter(b=>b.stop).length,1);
  assert.ok(bars[0].soc>bars[2].soc,'drains before the stop');
  const stop=bars.findIndex(b=>b.stop);assert.equal(stop,4);assert.equal(bars[stop].soc,80,'stop bar shows the post-charge level');
  assert.ok(bars[stop].soc>bars[stop-1].soc,'jumps up at the stop');
  assert.ok(bars.at(-1).soc<=bars.at(-2).soc&&bars.at(-1).soc-20<=10,'ends draining towards the arrival level');
  assert.ok(bars.every(b=>b.soc>=0&&b.soc<=100));
});
test('a trip without stops is a single slope and facts say so',()=>{
  const p=plan([]),bars=socSkyline(p,5);assert.ok(bars.every((b,i)=>i===0||b.soc<=bars[i-1].soc));
  const facts=tripFacts(p);assert.equal(facts.stops,'Şarjsız varış');assert.equal(facts.arrival,'%20');
  assert.equal(tripSeconds(p),15720);assert.equal(facts.duration,'4 sa 22 dk');
});
