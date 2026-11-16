import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';
import {replayOptimizer} from '../../planning/planning-replay';
import {normalized} from '../../planning/validation/frontier-performance-harness';
describe('Weather mode reconstructed from snapshot, not current server flags',()=>{
 it.each(['legacy','atlas','atlas_adaptive'])('round trips %s including refinement, SOC, charging stops and warnings',async mode=>{
  const previous=process.env.WEATHER_EXECUTION_MODE;process.env.WEATHER_EXECUTION_MODE=mode;
  try{
   const w=optimizerWorld(false),original=await w.service.plan(w.request,w.preparation,w.options);
   expect(original.result.status).toBe('planned');
   process.env.WEATHER_EXECUTION_MODE=mode==='atlas_adaptive'?'legacy':'atlas_adaptive';
   const replayed=await replayOptimizer(original.replay,w.preparation.road,new AbortController().signal);
   expect(normalized(replayed.result)).toEqual(normalized(original.result));
  }finally{if(previous===undefined)delete process.env.WEATHER_EXECUTION_MODE;else process.env.WEATHER_EXECUTION_MODE=previous;}
 });
});
