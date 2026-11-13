import {planningEvaluationSchema} from '@chargeroad/shared';
import {optimizerWorld} from './optimizer.fixtures';
import {DEFAULT_OPTIMIZER_OPTIONS} from '../optimizer-policy';
describe('Application-owned EV stop optimization',()=>{
  it('handles 5003 segment weather queries with default budgets and keeps the full validated route',async()=>{
    const w=optimizerWorld(),route=w.route('origin','destination'),template=route.segments[0],count=5003;
    w.vehicle.capacity.referenceUsableBatteryKwh=80;w.candidates.candidates=[];
    route.segments=Array.from({length:count},(_,i)=>({...structuredClone(template),id:'dense-'+i,
      startDistanceMeters:route.distanceMeters*i/count,endDistanceMeters:route.distanceMeters*(i+1)/count,
      distanceMeters:route.distanceMeters/count,drivingDurationSeconds:route.drivingDurationSeconds/count,
      geometry:[{latitude:w.request.origin.latitude+(w.request.destination.latitude-w.request.origin.latitude)*i/count,longitude:32.8},
        {latitude:w.request.origin.latitude+(w.request.destination.latitude-w.request.origin.latitude)*(i+1)/count,longitude:32.8}],
      elevationProfile:[{distanceFromStartMeters:0,elevationMeters:0},{distanceFromStartMeters:route.distanceMeters/count,elevationMeters:0}]}));
    w.roads.routes.mockResolvedValue({data:{schemaVersion:'1.0.0',routes:[route]},source:route.source});
    const r=await w.service.plan(w.request,w.preparation,structuredClone(DEFAULT_OPTIMIZER_OPTIONS));
    expect(r.result.status).toBe('planned');expect(r.search?.weatherQueries).toBe(count);
    expect(w.weather.forecast).toHaveBeenCalledTimes(1);
    if(r.result.status==='planned')expect(r.result.plan.roadRoute.segments).toHaveLength(count);
  });
  it('exposes specific missing socket and conflicting road-speed reasons instead of a generic data failure',async()=>{
    const w=optimizerWorld();w.candidates.candidates.forEach(c=>c.station.evses=[]);
    const direct=w.route('origin','destination');direct.segments[0].speedLimitKph=20;
    w.roads.routes.mockResolvedValue({data:{schemaVersion:'1.0.0',routes:[direct]},source:direct.source});
    const r=await w.service.plan(w.request,w.preparation,w.options);
    expect(r.result.status).toBe('insufficient_data');
    if(r.result.status!=='planned')expect(r.result.reasons.map(v=>v.code)).toEqual(['PHYSICAL_DC_EVSE_DATA_MISSING','ROAD_TIME_OR_TRACE_EXCEEDS_SPEED_LIMIT']);
  });
  it('chooses two efficient partial charges for time and one >80% charge for fewer stops',async()=>{
    const world=optimizerWorld(),fast=await world.service.plan(world.request,world.preparation,world.options);
    expect(fast.result.status).toBe('planned');if(fast.result.status!=='planned')throw new Error(JSON.stringify(fast));
    expect(fast.result.plan.chargingStops).toHaveLength(2);expect(fast.result.plan.chargingStops.every(s=>s.targetChargePercent<=80)).toBe(true);
    expect(fast.result.plan.estimatedArrivalAt).toBeNull();expect(fast.result.plan.scenario?.arrivalAt).toBeTruthy();
    expect(fast.result.plan.duration.totalSeconds).toBeNull();expect(fast.result.plan.search?.optimality).toBe('not_proven');
    expect(()=>planningEvaluationSchema.parse({input:fast.validationInput,result:fast.result})).not.toThrow();
    world.request.policy.objective='minimum_charging_stops';const fewer=await world.service.plan(world.request,world.preparation,world.options);
    expect(fewer.result.status).toBe('planned');if(fewer.result.status!=='planned')throw new Error(JSON.stringify(fewer));
    expect(fewer.result.plan.chargingStops).toHaveLength(1);expect(fewer.result.plan.chargingStops[0].targetChargePercent).toBeGreaterThan(80);
    expect(fewer.result.plan.scenario!.totalSeconds).toBeGreaterThan(fast.result.plan.scenario!.totalSeconds);
  },30000);
  it('respects user starting SOC and can produce a route with no charge',async()=>{
    const w=optimizerWorld();w.request.startingChargePercent=100;w.request.constraints.targetArrivalChargePercent=0;w.request.constraints.minimumReserveChargePercent=0;
    const r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('planned');
    if(r.result.status==='planned'){expect(r.result.plan.chargingStops).toHaveLength(0);expect(r.result.plan.estimatedArrivalAt).not.toBeNull();}
  });
  it.each(['state','frontier'] as const)('returns a validated incumbent when the %s budget is exhausted',async kind=>{
    const w=optimizerWorld();w.request.startingChargePercent=100;w.request.constraints={minimumReserveChargePercent:0,targetArrivalChargePercent:0};
    if(kind==='state')w.options.maxStates=1;else w.options.maxFrontier=1;
    const r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('planned');
    if(r.result.status==='planned'){expect(r.result.plan.search?.searchComplete).toBe(false);expect(r.result.plan.search?.stoppedReason).toBe(kind==='state'?'state_budget':'frontier_budget');}
  });
  it('does not turn a missing vehicle calibration into invented road/weather requests',async()=>{
    const w=optimizerWorld();delete w.vehicle.energyModel;const r=await w.service.plan(w.request,w.preparation,w.options);
    expect(r.result.status).toBe('insufficient_data');expect(w.roads.routes).not.toHaveBeenCalled();expect(w.weather.forecast).not.toHaveBeenCalled();
  });
  it('minimizes net driving energy rather than elapsed time in energy mode',async()=>{
    const w=optimizerWorld();w.candidates.candidates=[];w.vehicle.capacity.referenceUsableBatteryKwh=8;w.request.startingChargePercent=100;
    w.request.constraints={minimumReserveChargePercent:10,targetArrivalChargePercent:10};w.vehicle.energyModel!.regeneration.efficiency=0;w.preparation.road.alternatives=2;
    const direct=w.route('origin','destination'),eco=structuredClone(direct);eco.id='eco';eco.distanceMeters*=1.25;eco.drivingDurationSeconds*=1.25;eco.segmentationPolicy.maxDistanceMeters=1500;
    eco.segments.forEach(s=>{s.id='eco-'+s.id;s.startDistanceMeters*=1.25;s.endDistanceMeters*=1.25;s.distanceMeters*=1.25;s.drivingDurationSeconds*=1.25;s.elevationProfile!.at(-1)!.distanceFromStartMeters=s.distanceMeters;});
    direct.segments[0].elevationProfile![1].elevationMeters=1000;direct.segments[0].elevationGainMeters=1000;
    direct.segments[1].elevationProfile![0].elevationMeters=1000;direct.segments[1].elevationLossMeters=1000;
    w.roads.routes.mockImplementation(async()=>({data:{schemaVersion:'1.0.0',routes:[direct,eco]},source:direct.source}));
    const fast=await w.service.plan(w.request,w.preparation,w.options);w.request.policy.objective='minimum_energy';const efficient=await w.service.plan(w.request,w.preparation,w.options);
    expect(fast.result.status).toBe('planned');expect(efficient.result.status).toBe('planned');
    if(fast.result.status==='planned'&&efficient.result.status==='planned'){
      expect(fast.result.plan.scenario!.totalSeconds).toBeLessThan(efficient.result.plan.scenario!.totalSeconds);
      expect(efficient.result.plan.search!.drivingNetBatteryKwh).toBeLessThan(fast.result.plan.search!.drivingNetBatteryKwh);
      expect(efficient.result.plan.roadRoute.composition![0].routeId).toBe('eco');
    }
  });
  it('does not invent a post-charge temperature to force another charging stop',async()=>{
    const w=optimizerWorld();delete w.vehicle.chargingModel!.temperatureEvolution;
    w.vehicle.energyModel!.capacityTemperatureCurve=[{temperatureC:0,factor:.8},{temperatureC:30,factor:1}];
    const r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('planned');
    if(r.result.status==='planned'){expect(r.result.plan.chargingStops).toHaveLength(1);expect(r.result.plan.chargingStops[0].effectiveBatteryCapacityKwh).toBe(4);
      expect(r.result.plan.chargingStops[0].batteryTemperatureAtDepartureC.origin).toBe('unknown');}
  });
  it('preserves source attribution and checks scenario weather after charging delays',async()=>{
    const w=optimizerWorld(),r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('planned');if(r.result.status!=='planned')return;
    const p=r.result.plan;expect(p.roadRoute.composition).toHaveLength(3);expect(p.roadRoute.metadata?.traffic).toBe('none');
    const after=p.scenario!.segmentTimes.at(-1)!;
    expect(Date.parse(after.departureAt)).toBeGreaterThan(Date.parse(w.request.departureAt)+90*1000);
    const tampered=structuredClone(r);if(tampered.result.status!=='planned')return;tampered.result.plan.scenario!.stopTimes[0].departureAt=w.request.departureAt;
    expect(()=>planningEvaluationSchema.parse({input:r.validationInput,result:tampered.result})).toThrow();
  });
  it('accounts for connection battery discharge separately from inlet losses',async()=>{
    const w=optimizerWorld();w.options.connectionSeconds=10;w.vehicle.chargingModel!.connectionModel!.batteryKw=.36;
    const r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('planned');
    if(r.result.status==='planned')for(const stop of r.result.plan.chargingStops){expect(stop.connectionBatteryEnergyKwh).toBeCloseTo(.001,10);
      expect(stop.chargeStartPercent!).toBeLessThan(stop.arrivalChargePercent);expect(stop.energyStoredKwh).toBeCloseTo((stop.targetChargePercent-stop.chargeStartPercent!)*4/100,8);}
  });
  it.each(['no_curve','no_evse','unknown_weather','closed','bad_hardware','cold','access','shared_pool'] as const)('fails closed with no reliable charging plan: %s',async kind=>{
    const w=optimizerWorld();switch(kind){
      case 'no_curve':w.vehicle.dcChargingCurves=[];break;
      case 'no_evse':w.candidates.candidates.forEach(c=>c.station.evses=[]);break;
      case 'unknown_weather':w.weather.forecast.mockImplementation(async(q)=>({data:q.map(v=>({...forecastForMissing(v),temperatureCelsius:null})),source:w.vehicle.capacity.source}));break;
      case 'closed':w.candidates.candidates.forEach(c=>c.lifecycle='temporarily_closed');break;
      case 'bad_hardware':w.candidates.candidates.forEach(c=>c.station.evses[0].connectors[0].maxCurrentA=null);break;
      case 'cold':w.request.initialBatteryTemperatureC.value=-10;break;
      case 'access':w.candidates.candidates.forEach(c=>c.station.access.publicAccess=false);break;
      case 'shared_pool':w.candidates.candidates.forEach(c=>{c.station.sharedPowerPools=[{id:'shared',ratedTotalPowerKw:200,availablePowerKw:{origin:'unknown',value:null}}];c.station.evses[0].sharedPowerPoolId='shared';});break;
    }
    const r=await w.service.plan(w.request,w.preparation,w.options);expect(r.result.status).toBe('insufficient_data');
  });
  it('does not label a road provider error or candidate truncation as global infeasibility',async()=>{
    const w=optimizerWorld();w.roads.routes.mockRejectedValue(new Error('provider offline'));
    expect((await w.service.plan(w.request,w.preparation,w.options)).result.status).toBe('provider_error');
    const other=optimizerWorld();other.options.maxStations=0;
    expect((await other.service.plan(other.request,other.preparation,other.options)).result.status).toBe('insufficient_data');
  });
  it('keeps caller cancellation separate from a solver budget failure',async()=>{
    const w=optimizerWorld(),abort=new AbortController();abort.abort(new Error('user cancelled'));
    await expect(w.service.plan(w.request,w.preparation,w.options,abort.signal)).rejects.toThrow('user cancelled');
  });
});

function forecastForMissing(q:import('@chargeroad/shared').WeatherQuery){return {queryId:q.id,segmentId:q.segmentId,location:q.location,validAt:q.validAt,
  forecastIssuedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),windSpeedKph:0,windFromDegrees:null,precipitationProbabilityPercent:0,
  precipitationMmPerHour:0,snowDepthCm:0,airPressureHpa:null,source:{sourceId:'test',recordId:null,version:null,url:null,retrievedAt:new Date().toISOString(),publishedAt:null,license:'TEST-ONLY'}};}
