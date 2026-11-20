import {ChargingCurveEngine} from '../charging-engine';
import {chargingFixture} from './fixtures';

// Same output, less work (2026-11-20): the planning search calls the charging engine 600–900 times per plan and never reads
// inputChecksumSha256, yet each call hashed the whole request (vehicle profile and curves included): ~0.34 s per plan
// (CPU profile, 5 long routes). Search callers now skip it, like the energy engine (SearchEnergyEvaluationResult).
describe('Charging engine search calls without the input checksum',()=>{
  it('returns the same result except the unpublished checksum',async()=>{
    const engine=new ChargingCurveEngine();
    for(const target of [60,80,95]){const request={...chargingFixture(),targetSocPercent:target};
      const full=await engine.evaluate(structuredClone(request)),search=await engine.evaluate(structuredClone(request),undefined,{inputChecksum:false});
      expect(full.inputChecksumSha256).toMatch(/^[a-f0-9]{64}$/);expect('inputChecksumSha256' in search).toBe(false);
      const {inputChecksumSha256:_c,...rest}=full;expect(search).toEqual(rest);}
  });
  it('a trusted search request (parts validated at their source) gives the same result without the composite re-parse',async()=>{
    const engine=new ChargingCurveEngine();
    for(const target of [60,80,95]){const request={...chargingFixture(),targetSocPercent:target};
      const parsed=await engine.evaluate(structuredClone(request),undefined,{inputChecksum:false}),
        trusted=await engine.evaluate(structuredClone(request),undefined,{inputChecksum:false,trustedRequest:true});
      expect(trusted).toEqual(parsed);}
  });
  it('keeps the checksum for public callers',async()=>{
    expect((await new ChargingCurveEngine().evaluate(chargingFixture())).inputChecksumSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
