import {createReferenceSelector} from '../reference-selector';
import {energyFixture} from './fixtures';
import {EnergyConsumptionEngine} from '../energy-engine';
describe('General consumption reference resolution',()=>{
  function setup(){const f=energyFixture(),model=f.vehicle.energyModel!,a=f.vehicle.consumptionReferences[0];model.mode='reference_corrected';
    a.conditions.meanSpeedKph=30;a.valueKwhPer100Km=10;
    f.vehicle.consumptionReferences=[a,{...structuredClone(a),id:'60',valueKwhPer100Km:20,conditions:{...a.conditions,meanSpeedKph:60}},
      {...structuredClone(a),id:'90',valueKwhPer100Km:40,conditions:{...a.conditions,meanSpeedKph:90}}];return f;}
  it('never interpolates between independent tests merely because conditions match',()=>{
    const f=setup();f.vehicle.consumptionReferences=f.vehicle.consumptionReferences.filter(r=>r.id!=='60');
    f.vehicle.consumptionReferences[1].source.sourceId='different-test-publisher';
    expect(()=>createReferenceSelector(f.vehicle,f.vehicle.energyModel!)(60,20,30)).toThrow('CONDITION_MATCHED_SPEED_REFERENCE_MISSING');
  });
  it('respects an explicit comparable series and never extrapolates',()=>{
    const f=setup();f.vehicle.consumptionReferences.forEach((r,i)=>{r.source.recordId='point-'+i;r.comparabilityGroupId='same-test-run';});
    const select=createReferenceSelector(f.vehicle,f.vehicle.energyModel!);expect(select(45,20,30).rate).toBe(15);
    expect(()=>select(100,20,30)).toThrow();expect(select(60,20,30).ids).toEqual(['60']);
  });
  it('does not equate independent observations with no test-series identity',()=>{
    const f=setup();f.vehicle.consumptionReferences=f.vehicle.consumptionReferences.filter(r=>r.id!=='60');
    f.vehicle.consumptionReferences.forEach(r=>r.source.recordId=null);
    expect(()=>createReferenceSelector(f.vehicle,f.vehicle.energyModel!)(60,20,30)).toThrow();
  });
  it('uses the speed trace rather than assigning a nonlinear curve at the leg mean speed',async()=>{
    const f=setup(),s=f.route.segments[0];
    // Integral is 1000 m: 20 s at 30, 20 s linear 30→90, 20 s at 90.
    s.speedProfile=[{elapsedSeconds:0,speedKph:30},{elapsedSeconds:20,speedKph:30},{elapsedSeconds:40,speedKph:90},{elapsedSeconds:60,speedKph:90}];
    const result=await new EnergyConsumptionEngine().evaluate(f,new AbortController().signal);
    expect(result.status).toBe('estimated');expect(result.netBatteryEnergyKwh).toBeGreaterThan(.28); // mean-speed lookup incorrectly returned .20 kWh
    expect(result.segments[0].consumptionReferenceIds).toEqual(['60','90','ref']);
    expect(result.audit[0].referenceIds).toEqual(result.segments[0].consumptionReferenceIds);
  });
  it('never extends a matched mean-speed reference beyond the actual trace coverage',async()=>{
    const f=setup(),s=f.route.segments[0];f.vehicle.consumptionReferences=f.vehicle.consumptionReferences.filter(r=>r.id==='60');
    s.speedProfile=[{elapsedSeconds:0,speedKph:30},{elapsedSeconds:60,speedKph:90}];
    const result=await new EnergyConsumptionEngine().evaluate(f,new AbortController().signal);
    expect(result.status).toBe('insufficient_data');expect(result.reasons.map(r=>r.code)).toContain('CONDITION_MATCHED_SPEED_REFERENCE_MISSING');
  });
});
