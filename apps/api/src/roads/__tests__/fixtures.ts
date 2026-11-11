import type { RoadConfig } from '../road-policy';
import { ROAD_SEGMENTATION } from '../road-policy';
import type { RoadRoutingRequest } from '@chargeroad/shared';
import type { RoadTripInput,WayTags } from '../provider-ports';
export const config:RoadConfig={enabled:true,providerId:'fixture-road',baseUrl:'https://example.invalid',overpassUrl:'https://example.invalid/osm',
  usePublicDemo:false,overpassEnabled:false,clientId:'synthetic-test',dailyRequestLimit:100,minIntervalMs:1100,
  maxActions:12,maxAlternatives:3,maxPoints:20000,maxSegments:10000,timeoutMs:25000,cacheSeconds:3600};
export function roadRequest():RoadRoutingRequest{return {schemaVersion:'1.0.0',origin:{latitude:39.9,longitude:32.8},
  destination:{latitude:39.91,longitude:32.8},departureAt:'2026-11-11T13:00:00Z',alternatives:1,
  avoidTolls:false,avoidFerries:false,originTimeZone:'Europe/Istanbul',segmentationPolicy:{...ROAD_SEGMENTATION}};}
export function trip():RoadTripInput{const request=roadRequest();return {hasToll:false,hasFerry:false,retrievedAt:request.departureAt,
  traffic:'none',sourceUrl:'https://example.invalid/route',license:'TEST-ONLY',attributions:[{text:'Synthetic fixture',url:'https://example.invalid',license:'TEST-ONLY'}],warnings:[],
  legs:[{geometry:[request.origin,request.destination],attributeHandle:'fixture-only',distanceMeters:1000,seconds:120,
    maneuvers:[{begin:0,end:1,seconds:120,instruction:'Synthetic road',type:1}],
    elevation:{intervalMeters:500,values:[10,30,10]},edges:[{begin:0,end:1,sourceEdgeId:'test-edge',osmWayId:'123',forward:true,roadClass:'primary',speedLimit:null}]}]};}
export function tags(values:Record<string,string>):WayTags{return {wayId:'123',tags:values,source:{sourceId:'synthetic-osm',recordId:'123',version:null,
  url:'https://example.invalid/123',retrievedAt:'2026-11-11T13:00:00Z',publishedAt:null,license:'TEST-ONLY'}};}
