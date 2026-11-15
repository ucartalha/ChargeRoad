/** Frozen historical queue acceptance. New product behavior is tested separately, never against rewritten goldens. */
import {readFileSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
import type * as scenarios from './frontier-scenarios';
let loaded:typeof scenarios|undefined;
export function historicalFrontierScenario(...args:Parameters<typeof scenarios.frontierScenario>){
 if(!loaded){
  const packet=JSON.parse(readFileSync(resolve(__dirname,'legacy-frontier-v1-sources.json'),'utf8')) as {sources:Record<string,{source:string;sha256:string}>};
  const weather=JSON.parse(readFileSync(resolve(__dirname,'legacy-weather-v1-sources.json'),'utf8')) as typeof packet;
  packet.sources={...packet.sources,...weather.sources};
  const root=resolve(__dirname,'../..'),modules=new Map<string,{exports:any}>();
  const load=(id:string):any=>{
   const cached=modules.get(id);if(cached)return cached.exports;
   const entry=packet.sources[id];if(!entry||createHash('sha256').update(entry.source).digest('hex')!==entry.sha256)throw Error('Legacy source integrity');
   const filename=resolve(root,id),local=createRequire(filename),module={exports:{}};modules.set(id,module);
   const js=ts.transpileModule(entry.source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
   new Function('exports','require','module','__filename','__dirname',js)(module.exports,(name:string)=>{
    const candidate=name.startsWith('.')?relative(root,resolve(dirname(filename),name+'.ts')).replace(/\\/g,'/'):'';
    return Object.hasOwn(packet.sources,candidate)?load(candidate):local(name);
   },module,filename,dirname(filename));return module.exports;
  };
  loaded=load('planning/validation/frontier-scenarios.ts');
 }
 return loaded!.frontierScenario(...args);
}
