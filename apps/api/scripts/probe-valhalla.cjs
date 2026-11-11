const https=require('node:https');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const directory=path.resolve(__dirname,'../../../artifacts/task9-valhalla');
async function call(action,payload,name){
  const bytes=Buffer.from(JSON.stringify(payload));
  const start=performance.now();
  const response=await new Promise((resolve,reject)=>{
    const req=https.request('https://valhalla1.openstreetmap.de/'+action,{method:'POST',signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json','Content-Length':bytes.length,'User-Agent':'ChargeRoad-local-pilot/0.1','X-Client-Id':'chargeroad-local-development'}},res=>{
      const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>8*1024*1024)res.destroy(new Error('Size budget'));else chunks.push(b);});
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks)}));
    });req.on('error',reject);req.end(bytes);
  });
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,name+'.json'),response.bytes);
  await fs.writeFile(path.join(directory,name+'.manifest.json'),JSON.stringify({endpoint:action,httpStatus:response.status,
    retrievedAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(response.bytes).digest('hex'),elapsedMs:performance.now()-start},null,2));
  if(response.status!==200)throw Error('Provider HTTP '+response.status);
  return JSON.parse(response.bytes);
}
(async()=>{
  const route=await call('route',{locations:[{lat:39.9208,lon:32.8541},{lat:39.9334,lon:32.8597}],costing:'auto',
    costing_options:{auto:{speed_types:['freeflow','constrained']}},alternates:0,units:'kilometers',language:'tr-TR',
    date_time:{type:1,value:'2026-11-11T16:00'},elevation_interval:30},'ankara-route');
  await new Promise(r=>setTimeout(r,1200));
  const leg=route.trip.legs[0];
  const trace=await call('trace_attributes',{encoded_polyline:leg.shape,shape_match:'edge_walk',costing:'auto',units:'kilometers',
    filters:{action:'include',attributes:['shape','osm_changeset','edge.id','edge.way_id','edge.begin_shape_index','edge.end_shape_index',
      'edge.length','edge.speed','edge.speed_limit','edge.road_class','edge.use','edge.begin_heading','node.elapsed_time','shape_attributes.time','shape_attributes.length']}},'ankara-trace');
  console.log(JSON.stringify({summary:route.trip.summary,legKeys:Object.keys(leg),elevationCount:leg.elevation?.length,
    firstElevation:leg.elevation?.slice(0,3),routeLocations:route.trip.locations,
    traceKeys:Object.keys(trace),edges:trace.edges?.length,firstEdges:trace.edges?.slice(0,2),shapeAttributes:trace.shape_attributes},null,2));
})().catch(e=>{console.error(e.code??e.message);process.exitCode=1;});
