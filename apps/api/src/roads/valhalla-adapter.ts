import type { Coordinate,RoadRoutingRequest } from '@chargeroad/shared';
import type { RoadConfig } from './road-policy';
import type { RoadJsonClient,RoadShapeAdapter } from './provider-ports';
import { RoadProviderError } from './road-client';
import { z } from 'zod';
import { decodePolyline6 } from './geometry';
import {roadSourceVersion} from './road-source-policy';
import type { RoadEdgeInput,RoadLegInput,RoadTripInput } from './provider-ports';

const summary=z.object({length:z.number().nonnegative(),time:z.number().nonnegative(),has_toll:z.boolean().optional(),has_ferry:z.boolean().optional()}).passthrough();
const tripSchema=z.object({units:z.literal('kilometers'),summary,locations:z.array(z.object({time_zone_name:z.string().optional()}).passthrough()).optional(),
  legs:z.array(z.object({summary,shape:z.string(),elevation_interval:z.number().positive().optional(),
    elevation:z.array(z.number().finite().nullable()).optional(),maneuvers:z.array(z.object({type:z.number().int(),instruction:z.string().optional(),
      time:z.number().nonnegative(),begin_shape_index:z.number().int().nonnegative(),end_shape_index:z.number().int().nonnegative()}).passthrough())}).passthrough()).min(1)}).passthrough();

export function localDeparture(departureAt:string,timeZone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date(departureAt));
  const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export class ValhallaRoadAdapter implements RoadShapeAdapter {
  readonly id:string;
  readonly capabilities={alternatives:true,via:true,traffic:'none' as const,freeMapReuse:true};
  constructor(private readonly config:RoadConfig){this.id=config.providerId;}
  async route(request:RoadRoutingRequest,locations:Coordinate[],client:RoadJsonClient,signal:AbortSignal):Promise<RoadTripInput[]|null>{
    const response=await client.post(this.id,this.config.baseUrl+'/route',{
      locations:locations.map(p=>({lat:p.latitude,lon:p.longitude,type:'break'})),costing:'auto',units:'kilometers',language:'tr-TR',
      alternates:locations.length===2?request.alternatives-1:0,elevation_interval:30,
      date_time:{type:1,value:localDeparture(request.departureAt,request.originTimeZone??'Europe/Istanbul')},
      costing_options:{auto:{speed_types:['freeflow','constrained'],use_tolls:request.avoidTolls?0:0.5,use_ferry:request.avoidFerries?0:0.5}},
    },signal);
    if(response.data&&typeof response.data==='object'&&'error_code'in response.data){
      if(Number(response.data.error_code)===442)return null;throw new RoadProviderError('Valhalla returned a routing error');
    }
    const root=z.object({trip:tripSchema,alternates:z.array(z.object({trip:tripSchema})).optional()}).passthrough().parse(response.data);
    return [root.trip,...(root.alternates??[]).map(a=>a.trip)].slice(0,request.alternatives).map(trip=>{
      const zone=trip.locations?.[0]?.time_zone_name;
      if(zone&&zone!==(request.originTimeZone??'Europe/Istanbul'))throw new RoadProviderError('Origin timezone does not match request; provide originTimeZone',422);
      const elevationWarnings=new Set<string>();
      const legs=trip.legs.map(leg=>{
        const values=leg.elevation?.map(value=>{
          // Valhalla 3.9.1 graphconstants.h kNoElevationData and skadi sample.cc NO_DATA_VALUE.
          // Exact provider sentinels, never a geographic lower bound for other providers.
          if(value===-500||value===-32768){elevationWarnings.add('valhalla_elevation_no_data');return null;}return value;
        });
        if(!values||!leg.elevation_interval)elevationWarnings.add('valhalla_elevation_unavailable');
        if(values&&leg.elevation_interval&&values.length!==Math.ceil(leg.summary.length*1000/leg.elevation_interval)+1)elevationWarnings.add('elevation_sampling_count_mismatch');
        return {geometry:decodePolyline6(leg.shape,this.config.maxPoints),attributeHandle:leg.shape,distanceMeters:leg.summary.length*1000,seconds:leg.summary.time,
          maneuvers:leg.maneuvers.map(m=>({begin:m.begin_shape_index,end:m.end_shape_index,seconds:m.time,instruction:m.instruction??'',type:m.type})),
          elevation:values&&leg.elevation_interval?{values,intervalMeters:leg.elevation_interval}:null,edges:[]};
      });
      return {hasToll:trip.summary.has_toll??null,hasFerry:trip.summary.has_ferry??null,retrievedAt:response.retrievedAt,sourceVersion:roadSourceVersion(this.config),
        traffic:'none',sourceUrl:this.config.baseUrl,license:'ODbL-1.0',attributions:[
          {text:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright',license:'ODbL-1.0'},
          {text:'Routing by Valhalla',url:'https://valhalla.github.io/valhalla/',license:'MIT'},
          {text:'Improve the map',url:'https://www.openstreetmap.org/fixthemap',license:'ODbL-1.0'},
          ...(this.config.usePublicDemo?[{text:'FOSSGIS development routing service',url:'https://routing.openstreetmap.de/about.html',license:'Service fair use'}]:[])],
        warnings:[...(zone?[]:['origin_timezone_not_confirmed_by_provider']),...elevationWarnings,
          ...(!this.config.graphVersion||this.config.graphVersion==='unknown'?['graph_version_unknown']:[]),
          ...(!this.config.demVersion||this.config.demVersion==='unknown'?['dem_version_unknown']:[])],legs} satisfies RoadTripInput;
    });
  }
  async attributes(leg:RoadLegInput,client:RoadJsonClient,signal:AbortSignal){
    const response=await client.post(this.id,this.config.baseUrl+'/trace_attributes',{encoded_polyline:leg.attributeHandle,shape_match:'edge_walk',costing:'auto',units:'kilometers',
      costing_options:{auto:{speed_types:['freeflow','constrained']}},filters:{action:'include',attributes:[
        'shape','osm_changeset','edge.id','edge.way_id','edge.forward','edge.begin_shape_index','edge.end_shape_index',
        'edge.length','edge.speed_limit','edge.road_class','edge.use','edge.begin_heading']},
    },signal);
    const trace=z.object({shape:z.string(),edges:z.array(z.object({id:z.number().int().positive(),way_id:z.number().int().positive().optional(),
      begin_shape_index:z.number().int().nonnegative(),end_shape_index:z.number().int().nonnegative(),forward:z.boolean().optional(),
      road_class:z.string().optional(),use:z.string().optional(),speed_limit:z.number().nonnegative().optional()}).passthrough())}).passthrough().parse(response.data);
    const geometry=decodePolyline6(trace.shape,this.config.maxPoints);
    if(geometry.length!==leg.geometry.length||geometry.some((p,i)=>Math.abs(p.latitude-leg.geometry[i].latitude)>1e-6||Math.abs(p.longitude-leg.geometry[i].longitude)>1e-6))
      throw new RoadProviderError('Attribute geometry does not exactly match road route');
    return trace.edges.map((edge,index)=>{
      if(edge.begin_shape_index>=edge.end_shape_index||edge.end_shape_index>=geometry.length||
        (index>0&&edge.begin_shape_index!==trace.edges[index-1].end_shape_index))throw new RoadProviderError('Discontinuous road edge attributes');
      const roadClass:RoadEdgeInput['roadClass']=edge.use==='ferry'?'ferry':edge.road_class==='motorway'?'motorway':
        ['trunk','primary'].includes(edge.road_class??'')?'primary':edge.road_class==='secondary'?'secondary':
        ['tertiary','residential','service_other','unclassified'].includes(edge.road_class??'')?'local':'unknown';
      return {begin:edge.begin_shape_index,end:edge.end_shape_index,sourceEdgeId:this.id+':'+edge.id,
        osmWayId:edge.way_id?String(edge.way_id):null,forward:edge.forward,roadClass,speedLimit:edge.speed_limit??null};
    });
  }
}
