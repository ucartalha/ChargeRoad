// Navigation mode step 1 (2026-11-19): pure view helpers for the full-screen navigation UI. No React Native here.
const {test}=require('node:test'),assert=require('node:assert/strict');
const v=require('../src/features/navigation/navigation-view.ts');
const {compactNavigationRoute}=require('../src/features/navigation/navigation-core.ts');
const route=()=>({planId:'p',revision:1,algorithmVersion:'t',distanceMeters:2000,reserve:10,arrivalTarget:20,attributions:[],
 segments:[{start:0,end:1000,geometry:[{latitude:40,longitude:29},{latitude:40.009,longitude:29}],startSoc:60,endSoc:40,seconds:60},
  {start:1000,end:2000,geometry:[{latitude:40.009,longitude:29},{latitude:40.009,longitude:29.0117}],startSoc:80,endSoc:60,seconds:60}],
 maneuvers:[{instruction:'Sağa dönün',type:10,startDistanceMeters:1000,endDistanceMeters:1000},{instruction:'Varış',type:4,startDistanceMeters:1990,endDistanceMeters:2000}],
 stops:[{id:'stop-1',distance:1000,arrivalSoc:40,targetSoc:80}]});

test('Valhalla maneuver types map to arrows; unknown types fall back to straight',()=>{
 assert.equal(v.maneuverIcon(10),'arrow-right-top');assert.equal(v.maneuverIcon(15),'arrow-left-top');
 assert.equal(v.maneuverIcon(9),'arrow-top-right');assert.equal(v.maneuverIcon(20),'arrow-top-right');assert.equal(v.maneuverIcon(21),'arrow-top-left');
 assert.equal(v.maneuverIcon(26),'rotate-left');assert.equal(v.maneuverIcon(4),'flag-checkered');assert.equal(v.maneuverIcon(13),'arrow-u-left-top');
 assert.equal(v.maneuverIcon(25),'call-merge');assert.equal(v.maneuverIcon(28),'ferry');
 for(const t of [undefined,null,99,-1,8])assert.equal(v.maneuverIcon(t),'arrow-up');
});
test('Turkish distance and duration formatting',()=>{
 assert.equal(v.formatDistance(4),'0 m');assert.equal(v.formatDistance(47),'50 m');assert.equal(v.formatDistance(853),'850 m');
 assert.equal(v.formatDistance(980),'1,0 km');assert.equal(v.formatDistance(1234),'1,2 km');assert.equal(v.formatDistance(23456),'23 km');
 assert.equal(v.formatDuration(20),'1 dk');assert.equal(v.formatDuration(25*60),'25 dk');assert.equal(v.formatDuration(85*60),'1 sa 25 dk');assert.equal(v.formatDuration(120*60),'2 sa');
 assert.equal(v.formatClock(new Date(2026,10,19,9,5).getTime()),'09:05');
});
test('next maneuver and a close follow-up maneuver',()=>{
 const r=route();let m=v.upcomingManeuvers(r,500);assert.equal(m.next?.instruction,'Sağa dönün');assert.equal(m.next?.distance,500);assert.equal(m.then,null);
 r.maneuvers[1].startDistanceMeters=1200;m=v.upcomingManeuvers(r,900);assert.equal(m.then?.type,4);
 m=v.upcomingManeuvers(r,1995);assert.equal(m.next,null);
});
test('route splits at the projected distance; the vehicle sits on the line and faces travel direction',()=>{
 const r=route(),s=v.splitRoute(r,500);
 assert.ok(Math.abs(s.point.latitude-40.0045)<1e-6);assert.equal(s.point.longitude,29);
 assert.deepEqual(s.traveled.at(-1),s.point);assert.deepEqual(s.remaining[0],s.point);assert.deepEqual(s.remaining.at(-1),{latitude:40.009,longitude:29.0117});
 assert.ok(s.bearing<5||s.bearing>355,'north on the first segment: '+s.bearing);
 const east=v.splitRoute(r,1500);assert.ok(Math.abs(east.bearing-90)<5,'east on the second segment: '+east.bearing);
 assert.deepEqual(v.splitRoute(r,-10).traveled,[r.segments[0].geometry[0]]);assert.deepEqual(v.splitRoute(r,5000).remaining,[r.segments[1].geometry.at(-1)]);
});
test('camera zooms out with speed and keeps a driving pitch',()=>{
 const p={latitude:40,longitude:29},slow=v.followCamera(p,90,3),fast=v.followCamera(p,90,33);
 assert.ok(slow.zoom>fast.zoom);assert.equal(slow.heading,90);assert.ok(slow.pitch>=45);assert.equal(v.followCamera(p,90,null).zoom,slow.zoom);
});
test('next charge / arrival estimate never credits a planned charge',()=>{
 const r=route(),p={distance:500,soc:50};let e=v.socOutlook(r,p,'none');
 assert.equal(e.kind,'stop');assert.equal(e.distance,500);assert.ok(Math.abs(e.soc-40)<.01);assert.equal(e.targetSoc,80);
 e=v.socOutlook(r,{distance:1500,soc:70},'stop-1');assert.equal(e.kind,'arrival');assert.ok(Math.abs(e.soc-60)<.01);
 assert.equal(v.socOutlook(r,{distance:1500,soc:-3},'stop-1').soc,0);
});
test('compact navigation route keeps the Valhalla maneuver type',()=>{
 const plan={planId:'p',revision:1,algorithmVersion:'a',minimumReserveChargePercent:10,targetArrivalChargePercent:20,chargingStops:[],
  roadRoute:{distanceMeters:1000,segments:[{startDistanceMeters:0,endDistanceMeters:1000,geometry:[{latitude:1,longitude:1},{latitude:2,longitude:2}],drivingDurationSeconds:10}],
   metadata:{attributions:[],maneuvers:[{instruction:'Sola dönün',type:15,startDistanceMeters:10,endDistanceMeters:20},{instruction:' ',type:8,startDistanceMeters:30,endDistanceMeters:40}]}},
  energySegments:[{startChargePercent:50,endChargePercent:40}]};
 assert.deepEqual(compactNavigationRoute(plan).maneuvers,[{instruction:'Sola dönün',type:15,startDistanceMeters:10,endDistanceMeters:20}]);
});
test('remaining trip time adds unconfirmed charging stops ahead to the driving time',()=>{
 const r=route();r.stops[0].seconds=1200;
 assert.equal(v.remainingTripSeconds(r,{distance:500,remainingDrivingSeconds:90},null),1290);
 assert.equal(v.remainingTripSeconds(r,{distance:1500,remainingDrivingSeconds:30},null),30);
 assert.equal(v.remainingTripSeconds(r,{distance:500,remainingDrivingSeconds:90},'stop-1'),90);
 delete r.stops[0].seconds;assert.equal(v.remainingTripSeconds(r,{distance:500,remainingDrivingSeconds:90},null),90);
});
test('compact navigation route carries each stop duration (charge + connection + preconditioning + known wait)',()=>{
 const plan={planId:'p',revision:1,algorithmVersion:'a',minimumReserveChargePercent:10,targetArrivalChargePercent:20,
  chargingStops:[{id:'s',routeDistanceMeters:500,arrivalChargePercent:30,targetChargePercent:80,chargingDurationSeconds:1000,connectionDurationSeconds:120,blockingPreconditioningSeconds:30,waiting:{seconds:null}}],
  roadRoute:{distanceMeters:1000,segments:[{startDistanceMeters:0,endDistanceMeters:1000,geometry:[{latitude:1,longitude:1},{latitude:2,longitude:2}],drivingDurationSeconds:10}],metadata:{attributions:[],maneuvers:[]}},
  energySegments:[{startChargePercent:50,endChargePercent:40}]};
 assert.equal(compactNavigationRoute(plan).stops[0].seconds,1150);
});
