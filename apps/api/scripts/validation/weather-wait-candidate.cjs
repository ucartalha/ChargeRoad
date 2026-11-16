/** Offline candidate ONLY. Never imported by application code. Guarded source seams. */
const fs=require('fs'),path=require('path'),Module=require('module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../../src/weather/weather-cache.ts');
function candidateSource(){
 let source=fs.readFileSync(filename,'utf8');
 const replace=(from,to)=>{if(source.split(from).length!==2)throw Error('WEATHER_WAIT_SEAM_CHANGED');source=source.replace(from,to);};
 replace('for(let attempt=0;attempt<210;attempt++){','let recheckClaimAt=0;\n    for(let attempt=0;attempt<210;attempt++){');
 replace('const lease=await this.claim(key,provider,budget);',`// Keep native 100ms fresh/backoff reads, but avoid reacquiring the global lock
      // while its last authoritative pacing/lease observation still applies.
      if(performance.now()<recheckClaimAt){await delay(100,undefined,{signal});continue;}
      const lease=await this.claim(key,provider,budget);
      if(lease&&'waitMs' in lease){recheckClaimAt=performance.now()+lease.waitMs;
        await delay(lease.reason==='fresh'?0:100,undefined,{signal});continue;}`);
 replace('Promise<{token:string;generation:string}|null>','Promise<{token:string;generation:string}|{waitMs:number;reason:string}|null>');
 replace('next_allowed_at>now() AS paced FROM',"next_allowed_at>now() AS paced,GREATEST(0,EXTRACT(EPOCH FROM (next_allowed_at-now()))*1000) AS pace_wait_ms FROM");
 replace('AS leased FROM weather_forecast_cache','AS leased,GREATEST(0,EXTRACT(EPOCH FROM (lease_until-now()))*1000) AS lease_wait_ms FROM weather_forecast_cache');
 replace("if(existing?.fresh||existing?.leased){await client.query('ROLLBACK');return null;}",`if(existing?.fresh||existing?.leased){await client.query('ROLLBACK');
        return {reason:existing.fresh?'fresh':'active_lease_wait',waitMs:existing.fresh?0:Math.min(250,Math.max(0,Number(existing.lease_wait_ms)||0))};}`);
 replace("if(state.paced||active>=WEATHER_POLICY.maxConcurrency){await client.query('ROLLBACK');return null;}",`if(state.paced||active>=WEATHER_POLICY.maxConcurrency){await client.query('ROLLBACK');
        return {reason:state.paced?'pacing_wait':'concurrency_wait',waitMs:state.paced?Math.min(500,Math.max(0,Number(state.pace_wait_ms)||0)):0};}`);
 return source;
}
function candidateClass(){
 const module={exports:{}},req=Module.createRequire(filename);
 const js=ts.transpileModule(candidateSource(),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','module','require',js)(module.exports,module,req);
 return module.exports.WeatherCacheStore;
}
module.exports={candidateSource,candidateClass};
