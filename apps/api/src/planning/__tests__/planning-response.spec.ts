import {gunzipSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import type {PlanningApiResponse} from '@chargeroad/shared';
import {encodePlanningResponse} from '../http/planning-response';
import {PLANNING_HTTP_POLICY as policy} from '../http/planning-http-policy';
import {withPlanningMetrics} from '../../observability/planning-metrics';
import type {PlanningMetricSnapshot} from '../../observability/planning-metrics';
const response=(size:number)=>({schemaVersion:'1.0.0',status:'planned',data:'source-preserving-plan-data/'.repeat(Math.ceil(size/27)).slice(0,size)}) as unknown as PlanningApiResponse;
describe('Bounded lossless planning transport',()=>{
  it('measures the same gzip bytes and preserves errors with instrumentation enabled',async()=>{
    const input={...response(200000),requestId:'44444444-4444-4444-8444-444444444444'},signal=new AbortController().signal;
    const before=await encodePlanningResponse(input,'gzip',signal);let snapshot!:PlanningMetricSnapshot;
    const after=await withPlanningMetrics(input.requestId,()=>encodePlanningResponse(input,'gzip',signal),{enabled:true,sink:s=>snapshot=s});
    expect(after.encoding).toBe(before.encoding);expect(after.body.equals(before.body)).toBe(true);
    expect(snapshot.stages.json_serialize!.count).toBe(1);expect(snapshot.stages.gzip!.count).toBe(1);
    expect(snapshot.counters.response_decoded_bytes).toBe(Buffer.byteLength(JSON.stringify(input)));expect(snapshot.counters.response_wire_bytes).toBe(after.body.length);
    await expect(withPlanningMetrics(input.requestId,()=>encodePlanningResponse({...response(3*1024*1024),requestId:input.requestId},'gzip;q=0',signal),{enabled:true,sink:()=>{}})).rejects.toMatchObject({status:406});
  });
  it('delivers an 11 MB detailed plan without truncating or dropping its fields',async()=>{
    const input=response(11*1024*1024),encoded=await encodePlanningResponse(input,'gzip, deflate',new AbortController().signal);
    expect(encoded.encoding).toBe('gzip');expect(encoded.body.length).toBeLessThan(policy.maxWireResponseBytes);
    expect(JSON.parse(gunzipSync(encoded.body).toString())).toEqual(input);
  });
  it('retains small identity responses and refuses oversized identity responses or q=0 gzip',async()=>{
    const signal=new AbortController().signal,small=response(100);
    expect((await encodePlanningResponse(small,undefined,signal)).encoding).toBeNull();
    for(const accept of [undefined,'identity','gzip;q=0','gzip;q=0, *;q=1'])await expect(encodePlanningResponse(response(3*1024*1024),accept,signal)).rejects.toMatchObject({status:406});
  });
  it('still rejects poorly compressible data exceeding the 2 MiB wire budget',async()=>{
    const input={data:randomBytes(3*1024*1024).toString('base64')} as unknown as PlanningApiResponse;
    await expect(encodePlanningResponse(input,'gzip',new AbortController().signal)).rejects.toMatchObject({status:503});
  });
  it('still bounds decoded response memory and respects caller cancellation',async()=>{
    await expect(encodePlanningResponse(response(18*1024*1024),'gzip',new AbortController().signal)).rejects.toMatchObject({status:503});
    const controller=new AbortController();controller.abort(new Error('cancelled'));
    await expect(encodePlanningResponse(response(100),'gzip',controller.signal)).rejects.toThrow('cancelled');
  });
});
