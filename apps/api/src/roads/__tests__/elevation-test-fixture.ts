import {ValhallaRoadAdapter} from '../valhalla-adapter';
import {normalizeRoadTrip} from '../normalize-road';
import {config,roadRequest} from './fixtures';
// Synthetic 60m, no captured/licence-unreviewed DEM values. 30m sampling remains explicit.
export async function normaliseTestTrip(values:(number|null)[]){
 let shape='',lat=0,lon=0;for(const point of [roadRequest().origin,roadRequest().destination])for(const [axis,value] of [Math.round(point.latitude*1e6),Math.round(point.longitude*1e6)].entries()){
  let delta=value-(axis===0?lat:lon);if(axis===0)lat=value;else lon=value;let encoded=delta<0?~(delta<<1):delta<<1;
  while(encoded>=32){shape+=String.fromCharCode((32|(encoded&31))+63);encoded>>>=5;}shape+=String.fromCharCode(encoded+63);
 }
 const client={post:jest.fn(async(_id:string,_url:string,_body:unknown)=>({retrievedAt:'2026-11-12T10:00:00Z',data:{trip:{units:'kilometers',summary:{length:.06,time:12,has_toll:false,has_ferry:false},
  locations:[{time_zone_name:'Europe/Istanbul'}],legs:[{summary:{length:.06,time:12},shape,elevation_interval:30,elevation:values,
   maneuvers:[{begin_shape_index:0,end_shape_index:1,time:12,type:1,instruction:'Synthetic'}]}]}}}))};
 const trips=await new ValhallaRoadAdapter(config).route(roadRequest(),[roadRequest().origin,roadRequest().destination],client,new AbortController().signal);
 return {route:normalizeRoadTrip(trips![0],roadRequest(),config,new Map()),client};
}
