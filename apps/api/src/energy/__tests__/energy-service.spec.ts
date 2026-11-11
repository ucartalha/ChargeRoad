import {EnergyAssessmentService} from '../energy.service';
import {EnergyConsumptionEngine} from '../energy-engine';
import {energyFixture} from './fixtures';
import {source} from '../../planning/__tests__/fixtures';
import type {WeatherService} from '../../weather/weather.service';
import type {EnergyEvaluationRequest} from '@chargeroad/shared';

describe('Energy assessment orchestration',()=>{
  function setup(){const e=energyFixture();const vehicles={resolveId:jest.fn(async()=>e.vehicle.vehicleVariantId),profile:jest.fn(async()=>({data:e.vehicle,source:source('db-profile')}))};
    const weather={forRoute:jest.fn(async()=>({status:'weather_ready',forecasts:e.weather,reasons:[]}))};
    const engine={evaluate:jest.fn(async(_input:EnergyEvaluationRequest,_signal:AbortSignal)=>({status:'estimated',reasons:[]}))};
    const service=new EnergyAssessmentService(vehicles,weather as unknown as WeatherService,engine as unknown as EnergyConsumptionEngine);
    return {e,vehicles,weather,engine,service};}
  it('never starts weather I/O for a missing profile or model',async()=>{
    const f=setup();f.vehicles.profile.mockResolvedValue({data:null as any,source:source('db-profile')});
    expect((await f.service.assess(f.e.request,f.e.route,new AbortController().signal)).reasons).toEqual(['VEHICLE_ENERGY_PROFILE_MISSING']);
    expect(f.weather.forRoute).not.toHaveBeenCalled();
    const model=setup();delete model.e.vehicle.energyModel;
    expect((await model.service.assess(model.e.request,model.e.route,new AbortController().signal)).reasons).toEqual(['ENERGY_CALIBRATION_MISSING']);
    expect(model.weather.forRoute).not.toHaveBeenCalled();
  });
  it('uses the canonical DB vehicle ID and only computes after weather is ready',async()=>{
    const f=setup();f.e.request.vehicleVariantId='legacy-saved-selection';
    expect((await f.service.assess(f.e.request,f.e.route,new AbortController().signal)).status).toBe('estimated');
    expect(f.engine.evaluate.mock.calls[0][0].request.vehicleVariantId).toBe(f.e.vehicle.vehicleVariantId);
    const bad=setup();bad.weather.forRoute.mockResolvedValue({status:'insufficient_data',forecasts:[],reasons:['weather_stale']} as any);
    expect((await bad.service.assess(bad.e.request,bad.e.route,new AbortController().signal)).status).toBe('insufficient_data');
    expect(bad.engine.evaluate).not.toHaveBeenCalled();
  });
  it('does not relax estimate restrictions or accept another vehicle profile',async()=>{
    const f=setup();f.e.request.policy.vehicleDataQuality='verified_only';
    expect((await f.service.assess(f.e.request,f.e.route,new AbortController().signal)).reasons).toEqual(['ENGINEERING_ESTIMATE_NOT_ALLOWED']);
    expect(f.weather.forRoute).not.toHaveBeenCalled();
    const wrong=setup();wrong.vehicles.resolveId.mockResolvedValue('other-car');
    await expect(wrong.service.assess(wrong.e.request,wrong.e.route,new AbortController().signal)).rejects.toThrow('identity');
  });
});
