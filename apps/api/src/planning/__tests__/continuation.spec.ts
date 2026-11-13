import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {energyFixture} from '../../energy/__tests__/fixtures';
import {chargingFixture} from '../../charging/__tests__/fixtures';
import {openThroughout} from '../planning-session';
import {optimizerWorld} from './optimizer.fixtures';
describe('Energy and thermal continuation across charging boundaries',()=>{
  it('keeps the original capacity denominator after a battery temperature change',async()=>{
    const input=energyFixture(),engine=new EnergyConsumptionEngine();input.vehicle.energyModel!.capacityTemperatureCurve=[{temperatureC:0,factor:.8},{temperatureC:30,factor:1}];
    const first=await engine.evaluate(input,new AbortController().signal);
    const continued=await engine.evaluate({...input,capacitySnapshot:first.capacitySnapshot,continuation:{kind:'modelled_leg',departureAt:input.request.departureAt,
      startingChargePercent:60,batteryTemperatureC:{origin:'estimated',value:0,estimatedAt:input.evaluatedAt,validAt:input.request.departureAt,modelVersion:'synthetic'},targetArrivalChargePercent:10}},new AbortController().signal);
    expect(continued.status).toBe('estimated');expect(continued.capacityKwh).toBe(80);expect(continued.capacitySnapshot).toEqual(first.capacitySnapshot);
    const without=await engine.evaluate({...input,request:{...input.request,initialBatteryTemperatureC:{origin:'user_input',value:0,observedAt:input.evaluatedAt}}},new AbortController().signal);
    expect(without.capacityKwh).toBe(64);
  });
  it('rejects cross-profile capacity and continuation before the journey',async()=>{
    const input=energyFixture(),engine=new EnergyConsumptionEngine(),first=await engine.evaluate(input,new AbortController().signal);
    const bad=await engine.evaluate({...input,capacitySnapshot:{...first.capacitySnapshot!,vehicleProfileVersion:'another'}},new AbortController().signal);
    expect(bad.reasons.map(r=>r.code)).toContain('CAPACITY_SNAPSHOT_PROFILE_OR_MODEL_MISMATCH');
    const early=await engine.evaluate({...input,continuation:{kind:'modelled_leg',departureAt:'2026-01-01T00:00:00Z',startingChargePercent:60,
      batteryTemperatureC:{origin:'unknown',value:null},targetArrivalChargePercent:10}},new AbortController().signal);
    expect(early.reasons.map(r=>r.code)).toContain('CONTINUATION_PRECEDES_JOURNEY');
  });
  it('only carries a charging temperature with an explicit source-conditioned model',async()=>{
    const f=chargingFixture(),engine=new ChargingCurveEngine();f.vehicle.chargingModel!.temperatureEvolution={kind:'isothermal_conditioned',version:'synthetic/1',temperatureC:30,
      ambientRangeC:{min:0,max:40},source:f.vehicle.chargingModel!.source};
    const r=await engine.evaluate(f);expect(r.status).toBe('estimated');expect(r.batteryTemperatureAtDepartureC.value).toBe(30);
    f.batteryTemperatureAtStartC.value=25;const wrong=await engine.evaluate(f);
    expect(wrong.status).toBe('insufficient_data');expect(wrong.chargingSeconds).toBeNull();
    expect(wrong.reasons).toContain('CHARGING_THERMAL_MODEL_CONDITIONS_NOT_MET');
  });
  it('checks station opening through the whole charging interval including date exceptions',()=>{
    const s=chargingFixture().station;s.access.openingHours={timezone:'UTC',weekly:[{isoWeekday:1,intervals:[{fromMinuteOfDay:600,toMinuteOfDay:660}]}],exceptions:[]};
    expect(openThroughout(s,'2026-11-09T10:00:00Z','2026-11-09T11:00:00Z')).toBe(true);
    expect(openThroughout(s,'2026-11-09T10:30:00Z','2026-11-09T11:00:01Z')).toBe(false);
    s.access.openingHours.exceptions=[{date:'2026-11-09',intervals:[]}];expect(openThroughout(s,'2026-11-09T10:00:00Z','2026-11-09T10:05:00Z')).toBe(false);
  });
  it('expands the corridor only after the first bounded candidate set fails',async()=>{
    const w=optimizerWorld(),full=structuredClone(w.candidates),empty=structuredClone(full);empty.candidates=[];empty.metadata.search.emptyReason='no_matches_in_known_data';
    w.options.corridorMeters=[2000,5000];w.stations.findAlongRoutes.mockResolvedValueOnce({data:empty,source:w.vehicle.capacity.source}).mockResolvedValue({data:full,source:w.vehicle.capacity.source});
    const r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('planned');expect(w.stations.findAlongRoutes).toHaveBeenCalledTimes(2);
  });
  it('stops preparation requests when the caller cancels even if a provider ignores abort',async()=>{
    const w=optimizerWorld(),abort=new AbortController();w.roads.routes.mockImplementation(()=>new Promise(()=>{}));
    const p=w.service.plan(w.request,w.preparation,w.options,abort.signal);setTimeout(()=>abort.abort(new Error('cancel waiting provider')),5);
    await expect(p).rejects.toThrow('cancel waiting provider');
  });
  it('does not run non-physical equipment summaries through road/charge queries',async()=>{
    const w=optimizerWorld();w.candidates.candidates.forEach(c=>c.station.evses=[]);
    const r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('insufficient_data');expect(w.roads.routes).toHaveBeenCalledTimes(1);
  });
  it('rejects departure beyond the approved horizon before making provider requests',async()=>{
    const w=optimizerWorld();w.request.departureAt=new Date(Date.now()+100*3600000).toISOString();
    const r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('insufficient_data');
    expect(w.vehicles.profile).not.toHaveBeenCalled();expect(w.roads.routes).not.toHaveBeenCalled();expect(w.weather.forecast).not.toHaveBeenCalled();
  });
});
