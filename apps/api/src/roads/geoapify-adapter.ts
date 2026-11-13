import {z} from 'zod';
import type {Coordinate,RoadRoutingRequest} from '@chargeroad/shared';
import type {RoadConfig} from './road-policy';
import type {RoadJsonClient,RoadLegInput,RoadShapeAdapter,RoadTripInput} from './provider-ports';
import {RoadProviderError} from './road-client';

const stepSchema=z.object({from_index:z.number().int().nonnegative(),to_index:z.number().int().nonnegative(),
  time:z.number().finite().nonnegative(),speed_limit:z.number().finite().nonnegative().nullish(),
  road_class:z.string().optional(),toll:z.boolean().optional(),ferry:z.boolean().optional(),
  instruction:z.object({text:z.string().max(4000),type:z.string().optional()}).optional()});
const featureSchema=z.object({geometry:z.object({type:z.literal('MultiLineString'),
  coordinates:z.array(z.array(z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)])).min(2).max(20000)).min(1).max(10)}),
  properties:z.object({toll:z.boolean().optional(),ferry:z.boolean().optional(),
    legs:z.array(z.object({distance:z.number().positive(),time:z.number().positive(),steps:z.array(stepSchema).min(1).max(20000),
      elevation:z.array(z.number().finite().nullable()).max(20000).optional()})).min(1).max(10)})});
const responseSchema=z.object({type:z.literal('FeatureCollection'),features:z.array(featureSchema).max(3)});

/** Provider-only adapter. EV stop selection and SOC remain ChargeRoad algorithms. */
export class GeoapifyRoadAdapter implements RoadShapeAdapter {
  readonly id='geoapify';
  readonly capabilities={alternatives:false,via:true,traffic:'none' as const,freeMapReuse:true};
  constructor(private readonly config:RoadConfig){}
  async route(request:RoadRoutingRequest,locations:Coordinate[],client:RoadJsonClient,signal:AbortSignal):Promise<RoadTripInput[]|null>{
    if(!client.get)throw new RoadProviderError('Geoapify transport not configured');
    if(new URL(this.config.baseUrl).origin!=='https://api.geoapify.com')throw new RoadProviderError('Invalid Geoapify endpoint');
    if(request.alternatives>1)throw new RoadProviderError('Geoapify pilot supports one road alternative',422);
    const params=new URLSearchParams({waypoints:locations.map(p=>`${p.latitude},${p.longitude}`).join('|'),mode:'drive',
      units:'metric',lang:'tr',format:'geojson',details:'instruction_details,route_details,elevation',traffic:'free_flow',intermediate_waypoint_mode:'stopover'});
    const avoid=[...(request.avoidTolls?['tolls:1']:[]),...(request.avoidFerries?['ferries:1']:[])];if(avoid.length)params.set('avoid',avoid.join('|'));
    // No API key or minute-specific departure in cache identity: free-flow does not use departure time.
    const response=await client.get(this.id,'https://api.geoapify.com/v1/routing?'+params,signal),parsed=responseSchema.safeParse(response.data);
    if(!parsed.success)throw new RoadProviderError('Invalid Geoapify route response');
    if(!parsed.data.features.length)return null;
    return parsed.data.features.map(feature=>{
      const p=feature.properties;if(p.legs.length!==feature.geometry.coordinates.length||p.legs.length!==locations.length-1)
        throw new RoadProviderError('Geoapify route legs do not match requested waypoints');
      let points=0;
      const legs:RoadLegInput[]=p.legs.map((leg,index)=>{
        const geometry=feature.geometry.coordinates[index].map(([longitude,latitude])=>({latitude,longitude}));points+=geometry.length;
        if(points>this.config.maxPoints||leg.steps.some(s=>s.from_index>s.to_index||s.to_index>=geometry.length))throw new RoadProviderError('Geoapify geometry budget or indices invalid');
        if(leg.elevation&&leg.elevation.length!==geometry.length)throw new RoadProviderError('Geoapify elevation geometry mismatch');
        return {geometry,attributeHandle:'geoapify:embedded',distanceMeters:leg.distance,seconds:leg.time,elevation:null,
          elevationsByGeometry:leg.elevation,maneuvers:leg.steps.map(s=>({begin:s.from_index,end:s.to_index,seconds:s.time,instruction:s.instruction?.text??'',type:0})),
          edges:leg.steps.filter(s=>s.to_index>s.from_index).map((s,i)=>({begin:s.from_index,end:s.to_index,sourceEdgeId:`geoapify:${index}:${i}`,osmWayId:null,
            speedLimit:s.speed_limit&&s.speed_limit<=300?s.speed_limit:null,
            roadClass:s.ferry?'ferry':s.road_class==='motorway'?'motorway':['trunk','primary'].includes(s.road_class??'')?'primary':
              s.road_class==='secondary'?'secondary':['tertiary','unclassified','residential','service_other'].includes(s.road_class??'')?'local':'unknown'}))};
      });
      // Geoapify documents these as presence flags: omitted means no such part. A true flag
      // is never overridden by an avoid preference (which the provider treats as best effort).
      const steps=p.legs.flatMap(l=>l.steps);
      return {legs,hasToll:p.toll===true||steps.some(s=>s.toll===true),hasFerry:p.ferry===true||steps.some(s=>s.ferry===true),
        retrievedAt:response.retrievedAt,traffic:'none',warnings:['geoapify_free_flow_no_live_traffic'],
        sourceUrl:'https://apidocs.geoapify.com/docs/routing/',license:'Geoapify terms; OpenStreetMap ODbL attribution',
        attributions:[{text:'Powered by Geoapify',url:'https://www.geoapify.com/',license:'Geoapify terms'},
          {text:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright',license:'ODbL-1.0'}]};
    });
  }
  async attributes(leg:RoadLegInput){return leg.edges;}
}
