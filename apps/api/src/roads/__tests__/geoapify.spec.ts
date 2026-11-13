import {GeoapifyRoadAdapter} from '../geoapify-adapter';
import {normalizeRoadTrip} from '../normalize-road';
import {roadTransport} from '../road-client';
import {config,roadRequest} from './fixtures';
const geoConfig={...config,providerId:'geoapify',baseUrl:'https://api.geoapify.com',usePublicDemo:false};
const data=()=>({type:'FeatureCollection',features:[{geometry:{type:'MultiLineString',coordinates:[[[32.8,39.9],[32.8,39.905],[32.8,39.91]]]},properties:{
 legs:[{distance:1000,time:90,elevation:[100,150,120],steps:[{from_index:0,to_index:1,time:45,speed_limit:50,road_class:'primary',instruction:{text:'Devam et',type:'StartAt'}},
 {from_index:1,to_index:2,time:45,speed_limit:30,road_class:'residential',instruction:{text:'Varış',type:'DestinationReached'}}]}]}}]});
describe('Geoapify road adapter',()=>{
 it('translates geometry, embedded speed limits and nonuniform elevation without trace requests or keys in URLs',async()=>{
  const client={get:jest.fn(async(_id:string,_url:string)=>({data:data(),retrievedAt:new Date().toISOString()})),post:jest.fn()},adapter=new GeoapifyRoadAdapter(geoConfig),request=roadRequest();
  const trips=await adapter.route(request,[request.origin,request.destination],client,new AbortController().signal),trip=trips![0];
  expect(client.post).not.toHaveBeenCalled();const url=new URL(client.get.mock.calls[0][1]);expect(url.searchParams.has('apiKey')).toBe(false);expect(url.searchParams.has('departureAt')).toBe(false);
  expect(url.searchParams.get('details')).toContain('route_details');expect(trip.legs[0].geometry[0]).toEqual({latitude:39.9,longitude:32.8});
  const route=normalizeRoadTrip(trip,request,geoConfig,new Map());expect(route.segments.every(s=>s.elevationProfile!==null)).toBe(true);
  expect(route.metadata?.speedLimitKnownMeters).toBeCloseTo(1000);expect(route.metadata?.traffic).toBe('none');expect(trip.hasFerry).toBe(false);
 });
 it('rejects malformed elevation arrays and does not turn real toll/ferry flags into avoid guarantees',async()=>{
  const response=data(),adapter=new GeoapifyRoadAdapter(geoConfig),request=roadRequest();response.features[0].properties.legs[0].elevation=[10];
  const client={post:jest.fn(),get:jest.fn(async()=>({data:response,retrievedAt:new Date().toISOString()}))};
  await expect(adapter.route(request,[request.origin,request.destination],client,new AbortController().signal)).rejects.toThrow('elevation');
  const toll={...data().features[0].properties,toll:true,ferry:true};response.features[0].properties=toll;
  expect((await adapter.route(request,[request.origin,request.destination],client,new AbortController().signal))![0]).toMatchObject({hasToll:true,hasFerry:true});
 });
 it('injects credentials only into the official GET endpoint and never follows redirects',async()=>{
  const before=process.env.GEOAPIFY_API_KEY;process.env.GEOAPIFY_API_KEY='test-key-must-stay-private';
  const fetcher=jest.spyOn(global,'fetch').mockResolvedValue(new Response('{}',{status:200}));
  try{await roadTransport(geoConfig)('https://api.geoapify.com/v1/routing?mode=drive',null,new AbortController().signal,'GET');
   expect(new URL(fetcher.mock.calls[0][0] as string).searchParams.get('apiKey')).toBe('test-key-must-stay-private');expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
   await expect(roadTransport(geoConfig)('https://example.invalid/v1/routing',null,new AbortController().signal,'GET')).rejects.toThrow('not allowed');expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{fetcher.mockRestore();if(before===undefined)delete process.env.GEOAPIFY_API_KEY;else process.env.GEOAPIFY_API_KEY=before;}
 });
});
