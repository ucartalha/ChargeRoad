import {distanceMeters} from '../../src/features/navigation/navigation-core';
import type {NavigationRoute} from '../../src/features/navigation/navigation-core';

type Segment=NavigationRoute['segments'][number];
type Lengths={readonly lengths:readonly number[];readonly total:number};
type Entry={segment:Segment;geometry:Segment['geometry'];points:Segment['geometry'];latitude:number[];longitude:number[];
 start:number;end:number;startSoc:number;endSoc:number;seconds:number;value:Lengths};

/** NO-GO experiment. Validation only; never imported by the mobile application. */
export class NavigationGeometryIndex {
 private route:NavigationRoute|null;private segments:NavigationRoute['segments']|null;private entries:Entry[]=[];
 private readonly planId:string;private readonly revision:number;private readonly algorithmVersion:string;
 readonly edgeCount:number;readonly retainedNumericBytes:number;
 constructor(route:NavigationRoute,diagnostics?:{edgeLengthEvaluations:number}){
  this.route=route;this.segments=route.segments;this.planId=route.planId;this.revision=route.revision;this.algorithmVersion=route.algorithmVersion;
  let edges=0,bytes=0;
  this.entries=route.segments.map(segment=>{
   const geometry=segment.geometry,points=geometry.slice(),latitude=points.map(p=>p.latitude),longitude=points.map(p=>p.longitude);
   const lengths=geometry.slice(1).map((p,i)=>{if(diagnostics)diagnostics.edgeLengthEvaluations++;return distanceMeters(geometry[i],p);}),total=lengths.reduce((a,b)=>a+b,0);
   edges+=lengths.length;bytes+=(lengths.length+latitude.length+longitude.length)*8;
   return {segment,geometry,points,latitude,longitude,start:segment.start,end:segment.end,startSoc:segment.startSoc,endSoc:segment.endSoc,seconds:segment.seconds,
    value:Object.freeze({lengths:Object.freeze(lengths),total})};
  });
  this.edgeCount=edges;this.retainedNumericBytes=bytes;
 }
 segment(route:NavigationRoute,segment:Segment,position:number):Lengths|null{
  if(!this.route)return null;
  if(route!==this.route||route.segments!==this.segments||route.planId!==this.planId||route.revision!==this.revision||route.algorithmVersion!==this.algorithmVersion||route.segments.length!==this.entries.length){this.dispose();return null;}
  const e=this.entries[position];
  if(!e||e.segment!==segment||e.geometry!==segment.geometry||e.points.length!==segment.geometry.length||e.start!==segment.start||e.end!==segment.end||
   e.startSoc!==segment.startSoc||e.endSoc!==segment.endSoc||e.seconds!==segment.seconds){this.dispose();return null;}
  for(let i=0;i<e.points.length;i++){const p=segment.geometry[i];if(p!==e.points[i]||!Object.is(p.latitude,e.latitude[i])||!Object.is(p.longitude,e.longitude[i])){this.dispose();return null;}}
  return e.value;
 }
 dispose(){this.entries=[];this.route=null;this.segments=null;}
}
