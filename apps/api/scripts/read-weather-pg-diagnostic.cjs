const fs=require('fs'),path=require('path'),{Pool}=require('pg');require('dotenv').config({path:path.resolve(__dirname,'../../../.env'),quiet:true});
const out=path.resolve(__dirname,'../../../docs/validation/cr-lat-002-2026-11-16'),file=path.join(out,'pg-readonly.json');
const stats=v=>{const a=[...v].sort((a,b)=>a-b);return {n:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],p99:a[Math.ceil(a.length*.99)-1]};};
const sql=`SELECT c.document,c.expires_at>now() AS fresh,c.retry_at>now() AS retry,s.blocked_kind
 FROM weather_forecast_cache c LEFT JOIN weather_provider_state s USING(provider_id) WHERE c.request_key=$1`;
async function main(){const r={generatedAt:new Date().toISOString(),status:'NOT_RUN',explicitTestUrl:!!process.env.TEST_DATABASE_URL,readOnly:true,newProviderCalls:0};
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL||process.env.DATABASE_URL,max:1,connectionTimeoutMillis:2500});let client;
 try{const start=performance.now();client=await pool.connect();r.connectionAcquireMs=performance.now()-start;await client.query('BEGIN READ ONLY');await client.query('SELECT 1');
  const values=[];for(let i=0;i<9;i++){const t=performance.now(),row=await client.query(sql,['cr-lat-002-synthetic-miss-only']);if(row.rows.length)throw Error('SYNTHETIC_SELECTOR_COLLISION');values.push(performance.now()-t);}
  r.missQueryRoundtripMs=stats(values);const explain=(await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,['cr-lat-002-synthetic-miss-only'])).rows[0]['QUERY PLAN'][0];
  const sanitize=n=>({node:n['Node Type'],index:n['Index Name']??null,rows:n['Actual Rows'],totalMs:n['Actual Total Time'],sharedHits:n['Shared Hit Blocks'],sharedReads:n['Shared Read Blocks'],children:(n.Plans??[]).map(sanitize)});
  r.plan=sanitize(explain.Plan);r.executionMs=explain['Execution Time'];r.planningMs=explain['Planning Time'];
  r.aggregate=(await client.query(`SELECT count(*)::int AS rows,count(*) FILTER(WHERE document IS NOT NULL)::int AS representations,
   count(*) FILTER(WHERE expires_at>now())::int AS fresh,count(*) FILTER(WHERE token IS NOT NULL AND lease_until>now())::int AS active_leases FROM weather_forecast_cache`)).rows[0];
  await client.query('ROLLBACK');r.status='PASS';
 }catch{r.status='NOT_RUN';r.reason='Read-only weather diagnosis unavailable; raw error/config suppressed';if(client)await client.query('ROLLBACK').catch(()=>{});}
 finally{client?.release();await pool.end();}
 r.limits=['No new schema/table/migration/seed/truncate/drop/cache write.','Missing-key SELECT only; not fresh document decode, claim/lease/wait/pacing or loaded pool proof.','Acquire includes first connection handshake; no contention measurement.','No cold-cache claim, n9 p95/p99 sample maximum.'];
 fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:r.status,explicitTestUrl:r.explicitTestUrl}));}
main().catch(()=>{console.error('READONLY_WEATHER_DIAGNOSTIC_FAILED');process.exitCode=1;});
