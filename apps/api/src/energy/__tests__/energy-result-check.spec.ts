import {energyEvaluationResultSchema} from '@chargeroad/shared';
import {EnergyConsumptionEngine} from '../energy-engine';
import {energyResultFastCheck} from '../energy-result-check';
import {energyFixture,modelFixture} from './fixtures';

// Copy-free energy result check (2026-11-20): finish() re-validated each result with a full Zod parse (1.45 GB of 6.5 GB Zod
// allocations in 5 long plans). The fast check accepts only what the schema accepts, including the energy balance rules;
// anything else goes through the same Zod parse, which throws the same error.
async function results(){
  const engine=new EnergyConsumptionEngine(),out:unknown[]=[];
  const base=energyFixture();out.push(await engine.evaluate(base,new AbortController().signal));
  const modelled={...energyFixture()};modelled.vehicle.energyModel=modelFixture();out.push(await engine.evaluate(modelled,new AbortController().signal));
  const low={...energyFixture()};low.request.startingChargePercent=3;out.push(await engine.evaluate(low,new AbortController().signal));
  return out.map(r=>JSON.parse(JSON.stringify(r)));
}
const set=(value:unknown,path:(string|number)[],next:unknown)=>{const copy=structuredClone(value) as Record<string|number,unknown>;let at=copy;
  for(const key of path.slice(0,-1))at=at[key] as Record<string|number,unknown>;if(next===undefined)delete at[path.at(-1)!];else at[path.at(-1)!]=next;return copy;};
describe('Energy result fast check',()=>{
  it('accepts real engine results that the schema accepts',async()=>{
    for(const r of await results()){expect(energyEvaluationResultSchema.safeParse(r).success).toBe(true);expect(energyResultFastCheck(r)).toBe(true);}
  });
  it('never accepts what the schema rejects (shape, ranges and energy balance)',async()=>{
    const bad:[(string|number)[],unknown][]=[[['status'],'ok'],[['requestId'],'not-a-uuid'],[['inputChecksumSha256'],'abc'],[['capacityKwh'],0],
      [['netBatteryEnergyKwh'],Number.NaN],[['netBatteryEnergyKwh'],123456],[['finalChargePercent'],101],[['completedDistanceMeters'],-1],
      [['partialSegmentId'],''],[['reasons'],[{code:'x',segmentId:null,extra:1}]],[['warnings'],[1]],[['extra'],1],[['routeId'],undefined],
      [['segments',0,'startChargePercent'],120],[['segments',0,'minimumChargePercent'],99.9],[['segments',0,'netBatteryEnergyKwh'],-50],
      [['segments',0,'arrivalAt'],null],[['segments',0,'batteryTemperatureAtEndC'],{origin:'measured',value:1}],[['segments',0,'weatherQueryIds'],['']],
      [['segments',0,'extra'],true],[['audit',0,'regeneratedKwh'],-1],[['audit',0,'roadLoadDrawKwh'],1e6],[['audit',0,'integrationSteps'],1.5],
      [['audit',0,'mode'],'magic'],[['audit',0,'segmentId'],'other'],[['audit'],[]],[['segments',1,'startChargePercent'],1]];
    for(const r of await results())for(const [path,value] of bad){
      const target=path.slice(0,-1).reduce((o:any,k)=>o?.[k],r);if(target===undefined)continue;
      const mutated=set(r,path,value);if(energyEvaluationResultSchema.safeParse(mutated).success)continue;
      expect([path.join('.'),energyResultFastCheck(mutated)]).toEqual([path.join('.'),false]);
    }
  });
});
