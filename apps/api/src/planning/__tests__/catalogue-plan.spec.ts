import {planningEvaluationSchema} from '@chargeroad/shared';
import {optimizerWorld} from './optimizer.fixtures';
describe('Catalogue data remains separate from physical EVSE evidence',()=>{
  it('produces an explicitly conditional plan from source connector claims only after opt-in',async()=>{
    const w=optimizerWorld();for(const c of w.candidates.candidates){c.connectorClaims=[{sourceConnectorId:c.station.id+':ccs',standard:'ccs2',powerType:'dc',maxPowerKw:100,rawType:'CCS2',quantity:2,granularity:'equipment_summary'}];c.station.evses=[];}
    const strict=await w.service.plan(w.request,w.preparation,w.options);expect(strict.result.status).toBe('insufficient_data');
    w.request.policy.stationDataQuality='catalogue_power_scenario';const result=await w.service.plan(w.request,w.preparation,w.options);
    expect(result.result.status).toBe('planned');if(result.result.status!=='planned')throw new Error(JSON.stringify(result.result));
    expect(result.result.plan.chargingStops.every(s=>s.hardwareBasis==='catalogue_power_scenario')).toBe(true);
    expect(result.result.plan.assumptions.some(a=>a.code==='catalogue_power_scenario_not_verified_hardware')).toBe(true);
    expect(w.candidates.candidates.every(c=>c.station.evses.length===0)).toBe(true);
    const tampered=structuredClone(result.result);tampered.plan.assumptions=tampered.plan.assumptions.filter(a=>a.code!=='catalogue_power_scenario_not_verified_hardware');
    expect(()=>planningEvaluationSchema.parse({input:result.validationInput,result:tampered})).toThrow('scenario');
  });
  it('does not add a charging stop to a feasible direct journey when the scenario policy is enabled',async()=>{
    const w=optimizerWorld();w.request.policy.stationDataQuality='catalogue_power_scenario';w.vehicle.capacity.referenceUsableBatteryKwh=80;
    const result=await w.service.plan(w.request,w.preparation,w.options);expect(result.result.status).toBe('planned');
    if(result.result.status==='planned')expect(result.result.plan.chargingStops).toHaveLength(0);
  });
});
