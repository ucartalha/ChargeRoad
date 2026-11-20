import {PgRoadClient} from '../road-client';
import {BoundedMemoryCache} from '../bounded-memory-cache';
import type {RoadJsonResponse} from '../provider-ports';
import {config} from './fixtures';

// Memory layer in front of road_response_cache (2026-11-20): a repeated identical request is answered from process memory
// without any PostgreSQL round trip; without a memory layer the client behaves as before.
function fakeDatabase(){const sql:string[]=[];const stored=new Map<unknown,{payload:unknown;expires:number}>();
  return {sql,database:{pool:{query:async(text:string,params:unknown[])=>{sql.push(text.trim().split(/\s+/)[0]);
    if(text.startsWith('SELECT payload')){const row=stored.get(params[0]);return row&&row.expires>Date.now()?{rows:[{payload:row.payload,expires_ms:row.expires}],rowCount:1}:{rows:[],rowCount:0};}
    if(text.includes('INSERT INTO road_response_cache'))return {rows:[{generation:'1'}],rowCount:1};
    if(text.includes('INSERT INTO road_provider_budget'))return {rows:[{used:1}],rowCount:1};
    if(text.startsWith('UPDATE road_response_cache SET payload')){stored.set(params[0],{payload:JSON.parse(params[3] as string),expires:Date.now()+(params[4] as number)*1000});return {rows:[{}],rowCount:1};}
    return {rows:[],rowCount:0};}}} as never};}
const secret='synthetic-road-secret-at-least-32-characters',signal=new AbortController().signal;
describe('Road client memory layer',()=>{
  it('answers a repeated identical request from memory with no PostgreSQL query',async()=>{
    const {sql,database}=fakeDatabase(),transport=jest.fn(async()=>({trip:'fixture'}));
    const memory=new BoundedMemoryCache<RoadJsonResponse>({maxBytes:1e6,maxEntries:10,coldWindowMs:60000,minHitsPerWindow:1});
    const client=new PgRoadClient(database,config,secret,transport,memory);
    const first=await client.post('fake','https://example.invalid/route',{a:1},signal);const queries=sql.length;
    const second=await client.post('fake','https://example.invalid/route',{a:1},signal);
    expect(second).toEqual(first);expect(sql.length).toBe(queries);expect(transport).toHaveBeenCalledTimes(1);
    expect(memory.stats()).toMatchObject({hits:1,entries:1});
    // A different body is a different key.
    await client.post('fake','https://example.invalid/route',{a:2},signal);expect(transport).toHaveBeenCalledTimes(2);
  });
  it('keeps the previous behaviour without a memory layer (every request reads PostgreSQL)',async()=>{
    const {sql,database}=fakeDatabase(),transport=jest.fn(async()=>({trip:'fixture'})),client=new PgRoadClient(database,config,secret,transport);
    await client.post('fake','https://example.invalid/route',{a:1},signal);const queries=sql.length;
    await client.post('fake','https://example.invalid/route',{a:1},signal);
    expect(sql.length).toBe(queries+1);expect(sql.at(-1)).toBe('SELECT');expect(transport).toHaveBeenCalledTimes(1);
  });
});
