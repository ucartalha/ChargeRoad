const fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('typescript'),Module=require('module');
const root=path.resolve(__dirname,'../../..'),folder=path.join(root,'docs/validation/mobile-navigation-cpu-2026-11-16');
const filename=path.join(root,'apps/mobile/src/features/navigation/navigation-core.ts');
const original=fs.readFileSync(path.join(folder,'original-navigation-core.ts.txt'),'utf8');
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
function compile(source,name=filename){const m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(path.dirname(name));m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:name}).outputText,name);return m.exports;}
function indexedSource(source){
 const replacements=[
  ['previous?:{distance:number;timestamp:number}){','previous?:{distance:number;timestamp:number},index?:import(\'./navigation-geometry-index\').NavigationGeometryIndex){'],
  [' for(const segment of route.segments){',' let segmentIndex=-1;for(const segment of route.segments){segmentIndex++;'],
  ['  const lengths=segment.geometry.slice(1).map((p,i)=>distanceMeters(segment.geometry[i],p)),total=lengths.reduce((a,b)=>a+b,0);let offset=0;',
   '  const cached=index?.segment(route,segment,segmentIndex);const lengths=cached?.lengths??segment.geometry.slice(1).map((p,i)=>distanceMeters(segment.geometry[i],p)),total=cached?.total??lengths.reduce((a,b)=>a+b,0);let offset=0;'],
  ['previous?:{distance:number;timestamp:number}):NavigationProgress|null{','previous?:{distance:number;timestamp:number},index?:import(\'./navigation-geometry-index\').NavigationGeometryIndex):NavigationProgress|null{'],
  ['locateOnRoute(route,fix,previous);','locateOnRoute(route,fix,previous,index);']
 ];
 for(const [from,to]of replacements){if(source.split(from).length!==2)throw Error('SOURCE_SEAM_CHANGED');source=source.replace(from,to);}return source;
}
function load(){require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
 return {before:compile(original),after:compile(indexedSource(original)),Index:require('./validation/navigation-geometry-index.ts').NavigationGeometryIndex};}
const now=1794819600000;
function fixture(edges,layout='polyline',shape='regular'){
 const points=Array.from({length:edges+1},(_,i)=>{
  let latitude=40+i*.0001,longitude=29+Math.sin(i*.01)*.00002;
  if(shape==='loopback'){latitude=40+(i<edges/2?i:edges-i)*.0001;longitude=29+(i<edges/2?0:.0001);}
  if(shape==='hotspot'){latitude=40+Math.sin(i*.1)*.001;longitude=29+Math.cos(i*.1)*.001;}
  if(shape==='parallel'){latitude=40+(Math.floor(i/100)%2?100-i%100:i%100)*.0001;longitude=29+Math.floor(i/100)*.00003;}
  if(shape==='antimeridian')longitude=i<edges/2?179.999:-179.999;
  return {latitude,longitude};
 });
 const segments=layout==='polyline'?[{start:0,end:edges*10,geometry:points,startSoc:80,endSoc:30,seconds:edges}]:Array.from({length:edges},(_,i)=>({start:i*10,end:(i+1)*10,geometry:points.slice(i,i+2),startSoc:80-i/edges*50,endSoc:80-(i+1)/edges*50+(i%7===0?.0001:0),seconds:1}));
 const route={planId:'synthetic-plan',revision:1,algorithmVersion:'synthetic/1',distanceMeters:edges*10,reserve:10,arrivalTarget:20,attributions:[],segments,
  maneuvers:[{instruction:'Synthetic turn',startDistanceMeters:edges*5,endDistanceMeters:edges*5+10}],stops:[{id:'synthetic-stop',distance:edges*5,arrivalSoc:50,targetSoc:80}]};
 const fixes=Array.from({length:32},(_,i)=>({...points[Math.min(edges,Math.floor(i*edges/40))],timestamp:now+i*2000,accuracy:10,speed:20}));
 return {route,fixes,anchor:{distance:0,percent:80,observedAt:now,stopId:null}};
}
function sequence(core,w,index,diagnostic=false){let previous,results=[],count=0;
 for(const fix of w.fixes){const p=core.navigationProgress(w.route,fix,fix.timestamp,w.anchor,previous,index);if(diagnostic)results.push(p);if(p)previous={distance:p.distance,timestamp:fix.timestamp};count++;}
 return diagnostic?results:{count,last:previous?.distance??0};}
module.exports={root,folder,filename,original,hash,compile,indexedSource,load,fixture,sequence,now};
