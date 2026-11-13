import type { Coordinate,RoadRoutingRequest,SourceReference } from '@chargeroad/shared';
export interface RoadJsonResponse {data:unknown;retrievedAt:string;}
export interface RoadJsonClient {
  get?(providerId:string,url:string,signal:AbortSignal,cacheSeconds?:number):Promise<RoadJsonResponse>;
  post(providerId:string,url:string,body:unknown,signal:AbortSignal,cacheSeconds?:number):Promise<RoadJsonResponse>;
}
export interface RoadEdgeInput {begin:number;end:number;sourceEdgeId:string;osmWayId:string|null;forward?:boolean;
  roadClass:'motorway'|'primary'|'secondary'|'local'|'ferry'|'unknown';speedLimit:number|null;}
export interface RoadLegInput {geometry:Coordinate[];attributeHandle:string;distanceMeters:number;seconds:number;
  elevationsByGeometry?:(number|null)[];
  maneuvers:{begin:number;end:number;seconds:number;instruction:string;type:number}[];
  elevation:{intervalMeters:number;values:(number|null)[]}|null;edges:RoadEdgeInput[];}
export interface RoadTripInput {legs:RoadLegInput[];hasToll:boolean|null;hasFerry:boolean|null;retrievedAt:string;warnings:string[];
  sourceVersion?:string;
  traffic:'none'|'historical'|'live'|'unknown';sourceUrl:string;license:string;
  attributions:{text:string;url:string;license:string}[];}
export interface RoadShapeAdapter {
  readonly id:string;
  readonly capabilities:{alternatives:boolean;via:boolean;traffic:'none'|'live'|'historical';freeMapReuse:boolean};
  route(request:RoadRoutingRequest,locations:Coordinate[],client:RoadJsonClient,signal:AbortSignal):Promise<RoadTripInput[]|null>;
  attributes(leg:RoadLegInput,client:RoadJsonClient,signal:AbortSignal):Promise<RoadEdgeInput[]>;
}
export interface WayTags {wayId:string;tags:Record<string,string>;source:SourceReference;}
export abstract class RoadAttributeProvider {
  abstract getWays(ids:readonly string[],client:RoadJsonClient,signal:AbortSignal):Promise<Map<string,WayTags>>;
}
export interface SpeedLimitValue {
  value:number|null;kind:'posted'|'unlimited'|'conditional_unresolved'|'unknown'|'provider_derived';raw:string|null;source:SourceReference|null;
}
