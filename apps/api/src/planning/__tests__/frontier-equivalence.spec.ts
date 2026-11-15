import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {frontierCases,frontierObjectives,frontierScenario} from '../validation/frontier-scenarios';
const before=JSON.parse(readFileSync(resolve(__dirname,'../../../../../docs/validation/frontier-queue-before.json'),'utf8'));

describe('Heap frontier vs captured stable sort baseline',()=>{
 beforeAll(()=>{jest.useFakeTimers({now:new Date('2026-11-13T09:00:00Z'),doNotFake:['performance','setTimeout','clearTimeout','setInterval','clearInterval','setImmediate','clearImmediate','nextTick','queueMicrotask','hrtime']});});
 afterAll(()=>jest.useRealTimers());
 it.each(frontierObjectives.flatMap(objective=>frontierCases.map(kind=>[objective,kind] as const)))('preserves complete outcome, drive/charge order and budget metadata: %s / %s',async(objective,kind)=>{
  const fetch=jest.spyOn(global,'fetch').mockRejectedValue(new Error('Network prohibited'));
  try{const actual=await frontierScenario(objective,kind),expected=before.validation.find((v:{id:string})=>v.id===actual.id);
   expect(expected).toBeDefined();expect(actual).toEqual(expected);expect(fetch).not.toHaveBeenCalled();
  }finally{fetch.mockRestore();}
 });
});
