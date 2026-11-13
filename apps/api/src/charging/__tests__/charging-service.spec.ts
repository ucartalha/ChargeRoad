import {ChargingAssessmentService} from '../charging.service';
import {ChargingCurveEngine} from '../charging-engine';
import {VehicleEnergyProvider} from '../../providers/vehicle-energy-provider';
import {chargingFixture} from './fixtures';
describe('DB-first charging assessment',()=>{
  function setup(){const f=chargingFixture(),{vehicle,...r}=f;
    const provider={resolveId:jest.fn().mockResolvedValue(vehicle.vehicleVariantId),profile:jest.fn().mockResolvedValue({data:vehicle,source:vehicle.capacity.source})};
    const engine=new ChargingCurveEngine(),service=new ChargingAssessmentService(provider as unknown as VehicleEnergyProvider,engine);
    return {provider,engine,service,request:{...r,vehicleVariantId:vehicle.vehicleVariantId}};}
  it('uses canonical stored profiles without requesting an external provider',async()=>{
    const {provider,service,request}=setup(),fetch=jest.spyOn(global,'fetch');
    try{const r=await service.assess(request,new AbortController().signal);expect(r.status).toBe('estimated');
      expect(provider.profile).toHaveBeenCalledWith('synthetic-vehicle',expect.anything(),'allow_engineering_estimates');expect(fetch).not.toHaveBeenCalled();}
    finally{fetch.mockRestore();}
  });
  it('reports a missing published profile without running an engine',async()=>{
    const {provider,engine,service,request}=setup();provider.profile.mockResolvedValue({data:null});const calculate=jest.spyOn(engine,'evaluate');
    expect((await service.assess(request,new AbortController().signal)).reasons).toContain('VEHICLE_CHARGING_PROFILE_MISSING');expect(calculate).not.toHaveBeenCalled();
  });
  it('does not mix another canonical vehicle with a capacity snapshot',async()=>{
    const {provider,service,request}=setup();provider.resolveId.mockResolvedValue('another-vehicle');
    await expect(service.assess(request,new AbortController().signal)).rejects.toThrow('identity mismatch');
  });
  it('preserves caller cancellation',async()=>{
    const {service,request}=setup(),abort=new AbortController();abort.abort(new Error('cancelled'));
    await expect(service.assess(request,abort.signal)).rejects.toThrow('cancelled');
  });
});
