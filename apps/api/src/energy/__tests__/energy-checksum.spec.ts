import {createHash} from 'node:crypto';
import {energyEvaluationRequestSchema} from '@chargeroad/shared';
import {EnergyConsumptionEngine} from '../energy-engine';
import {canonicalJson} from '../../vehicles/knowledge/knowledge-package';
import {energyFixture} from './fixtures';

// E1 anchor: the published checksum stays SHA-256 over the canonical JSON of the whole normalised input.
const expected=(raw:unknown)=>createHash('sha256').update(canonicalJson(energyEvaluationRequestSchema.parse(raw))).digest('hex');
const run=(raw:unknown)=>new EnergyConsumptionEngine().evaluate(raw,new AbortController().signal);

describe('Energy input checksum',()=>{
  it('is sha256 of the canonical normalised input',async()=>{
    const input=energyFixture();
    expect((await run(input)).inputChecksumSha256).toBe(expected(input));
  });
  it('search mode omits only the checksum; every other field is identical and still validated',async()=>{
    const cases=[energyFixture(),energyFixture(),energyFixture(),energyFixture()];
    cases[1].request.startingChargePercent=5;                      // charge_required
    cases[2].weather=[];                                            // insufficient_data
    cases[3].request.constraints={minimumReserveChargePercent:79.9,targetArrivalChargePercent:79.9}; // reserve pressure
    for(const input of cases){
      const eager=await run(input);
      const search=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal,{inputChecksum:false});
      expect(Object.hasOwn(search,'inputChecksumSha256')).toBe(false);
      const {inputChecksumSha256,...rest}=eager;expect(inputChecksumSha256).toBe(expected(input));
      expect(search).toStrictEqual(rest);
    }
    expect(new Set(await Promise.all(cases.map(async c=>(await run(c)).status))).size).toBeGreaterThan(1);
  });
  it('changes with any input field, including continuation and weather',async()=>{
    const base=energyFixture(),soc=energyFixture(),weather=energyFixture();
    soc.request.startingChargePercent=79;weather.weather[0].temperatureCelsius=(weather.weather[0].temperatureCelsius??0)+1;
    const [a,b,c]=await Promise.all([run(base),run(soc),run(weather)]);
    expect(new Set([a.inputChecksumSha256,b.inputChecksumSha256,c.inputChecksumSha256]).size).toBe(3);
    expect(b.inputChecksumSha256).toBe(expected(soc));expect(c.inputChecksumSha256).toBe(expected(weather));
  });
});
