import { z } from 'zod';
import type { SpeedLimitValue,RoadJsonClient,WayTags } from './provider-ports';
import { RoadAttributeProvider } from './provider-ports';
import { DatabaseService } from '../database/database.service';
import type { RoadConfig } from './road-policy';

export function parseOsmSpeed(tags:WayTags|undefined,forward:boolean|undefined):SpeedLimitValue{
  const unknown:SpeedLimitValue={value:null,kind:'unknown',raw:null,source:tags?.source??null};if(!tags)return unknown;
  const t=tags.tags;
  if(Object.keys(t).some(k=>k.startsWith('maxspeed')&&k.includes('conditional')))
    return {...unknown,kind:'conditional_unresolved',raw:Object.entries(t).filter(([k])=>k.includes('conditional')).map(([k,v])=>k+'='+v).join(';')};
  const direction=forward===undefined?null:forward?'forward':'backward';
  if(direction===null&&Object.keys(t).some(k=>/^maxspeed.*:(forward|backward)$/.test(k)))return unknown;
  const raw=(direction?t['maxspeed:motorcar:'+direction]??t['maxspeed:'+direction]:undefined)??t['maxspeed:motorcar']??t.maxspeed;
  if(raw===undefined)return unknown;
  if(raw.trim()==='none')return {...unknown,kind:'unlimited',raw};
  const match=/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kph)?$/i.exec(raw.trim());
  if(!match)return {...unknown,raw};const value=Number(match[1])*(match[2]?.toLowerCase()==='mph'?1.609344:1);
  if(value<=0||value>300)return {...unknown,raw};return {value,kind:'posted',raw,source:tags.source};
}

export class OsmWayAttributeProvider extends RoadAttributeProvider {
  constructor(private readonly database:DatabaseService,private readonly config:RoadConfig){super();}
  async getWays(ids:readonly string[],client:RoadJsonClient,signal:AbortSignal){
    const keys=[...new Set(ids)];if(keys.some(id=>!/^\d{1,15}$/.test(id)||Number(id)<=0))throw new Error('Invalid OSM way ID');
    const result=new Map<string,WayTags>();if(!keys.length)return result;
    const sourceId='osm-way-tags';
    const read=await this.database.pool.query(`SELECT way_id::text,tags,source_updated_at,retrieved_at FROM osm_way_attributes
      WHERE provider_id=$1 AND way_id=ANY($2::bigint[]) AND expires_at>now()`,[sourceId,keys]);
    const add=(wayId:string,tags:Record<string,string>,retrievedAt:string,publishedAt:string|null)=>result.set(wayId,{wayId,tags,source:{
      sourceId,recordId:wayId,version:publishedAt,url:'https://www.openstreetmap.org/way/'+wayId,
      retrievedAt,publishedAt,license:'ODbL-1.0'}});
    for(const row of read.rows)add(row.way_id,row.tags,row.retrieved_at.toISOString(),row.source_updated_at?.toISOString()??null);
    const missing=keys.filter(id=>!result.has(id));
    if(!this.config.overpassEnabled||!missing.length)return result;
    // Public enrichment is bounded; not a national scrape or a production map backend.
    if(missing.length>200)return result;
    const json=await client.post('overpass-osm',this.config.overpassUrl,
      {data:'[out:json][timeout:10];way(id:'+missing.join(',')+');out tags;'},signal,3600);
    const schema=z.object({elements:z.array(z.object({type:z.literal('way'),id:z.number().int().positive(),tags:z.record(z.string(),z.string()).optional()})),
      remark:z.string().optional(),osm3s:z.object({timestamp_osm_base:z.iso.datetime()}).optional()}).passthrough();
    const parsed=schema.parse(json.data);if(parsed.remark)throw new Error('OSM attribute query incomplete');
    const now=json.retrievedAt,publishedAt=parsed.osm3s?.timestamp_osm_base??null;
    for(const row of parsed.elements){
      if(!missing.includes(String(row.id)))throw new Error('Unexpected OSM way in attribute response');
      // Persist only speed-related tags; no personal request/route history.
      const tags=Object.fromEntries(Object.entries(row.tags??{}).filter(([k])=>k==='maxspeed'||k.startsWith('maxspeed:')));
      add(String(row.id),tags,now,publishedAt);
    }
    // Absent ways are cached as unknown for this bounded snapshot, never as a numeric limit.
    for(const id of missing){const tags=result.get(id)?.tags??{};add(id,tags,now,publishedAt);}
    const entries=missing.map(id=>({id,tags:result.get(id)!.tags}));
    await this.database.pool.query(`INSERT INTO osm_way_attributes(provider_id,way_id,tags,source_updated_at,retrieved_at,expires_at,license)
      SELECT $1,x.id::bigint,x.tags,$3,$4,$4::timestamptz+interval '1 day','ODbL-1.0'
      FROM jsonb_to_recordset($2::jsonb) AS x(id text,tags jsonb)
      ON CONFLICT(provider_id,way_id) DO UPDATE SET tags=EXCLUDED.tags,source_updated_at=EXCLUDED.source_updated_at,
        retrieved_at=EXCLUDED.retrieved_at,expires_at=EXCLUDED.expires_at`,[sourceId,JSON.stringify(entries),publishedAt,now]);
    return result;
  }
}
