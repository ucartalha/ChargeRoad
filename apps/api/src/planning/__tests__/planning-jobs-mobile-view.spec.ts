import {planningApiResponseSchema,planningMobileResponseSchema,toMobilePlanningResponse} from '@chargeroad/shared';
import {PlanningJobsController} from '../http/planning-jobs.controller';

// planning-mobile-view/1.0.0 (2026-11-19): GET /v1/planning-jobs/:id/result?view=mobile returns the mobile projection;
// without view (old clients) or with an unknown value the full response is unchanged.
const id='11111111-1111-4111-8111-111111111111';
const failed={schemaVersion:'1.0.0',requestId:id,status:'computation_limit',reasons:[{code:'NO_SEARCH_BUDGET',explanation:'x'}],
  metadata:{apiVersion:'planning-http/1.0.0',policyId:'p',policyVersion:'1',access:'stateless_guest',historyStored:false,
    algorithms:{optimizer:'o',energy:'e',charging:'c'},models:{energy:null,charging:null}}} as const;
async function get(query:Record<string,unknown>,response:unknown=failed){
  const store={result:jest.fn(async()=>response),owner:()=>'owner'};let body:Buffer|undefined;
  const res={writableEnded:false,once(){},removeListener(){},setHeader(){},vary(){},type(){},send(b:Buffer){body=b;}};
  await new PlanningJobsController(store as never).result(id,{headers:{},query} as never,res as never);
  return JSON.parse(body!.toString('utf8'));
}
describe('Planning job result mobile view',()=>{
  it('keeps the full response by default and for unknown view values',async()=>{
    for(const query of [{},{view:'full'},{view:'tiny'},{view:['mobile','full']}]){const out=await get(query);
      expect(out).toEqual(failed);expect(planningApiResponseSchema.safeParse(out).success).toBe(true);}
  });
  it('returns the mobile projection for view=mobile',async()=>{
    const out=await get({view:'mobile'});expect(out).toEqual(toMobilePlanningResponse(failed as never));
    expect(planningMobileResponseSchema.safeParse(out).success).toBe(true);
  });
});
