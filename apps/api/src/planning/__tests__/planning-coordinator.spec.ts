import { Test } from '@nestjs/testing';
import type { PlanningInput } from '@chargeroad/shared';
import { PlanningCoordinator, PlanningContractError } from '../planning-coordinator';
import { PlanningModule } from '../planning.module';
import { PlanningEngine } from '../planning-engine';
import { VehicleEnergyProvider } from '../../providers/vehicle-energy-provider';
import { RoutingProvider } from '../../providers/routing-provider';
import { StationDataProvider } from '../../providers/station-data-provider';
import { WeatherProvider } from '../../providers/weather-provider';
import { fixture, forecast, source, syntheticPlan,stationSet } from './fixtures';

function setup() {
  const data = fixture();
  const vehicles = { resolveId:jest.fn().mockImplementation(async (id:string)=>id),
    profile: jest.fn().mockResolvedValue({ data: data.vehicle, source: source('vehicles') }) };
  const routing = { routes: jest.fn().mockResolvedValue({
    data: { schemaVersion: '1.0.0', routes: [data.road] }, source: source('roads'),
  }) };
  const stations = { findAlongRoutes: jest.fn().mockResolvedValue({ data: stationSet(), source: source('stations') }) };
  const weather = { forecast: jest.fn().mockImplementation(async (queries) =>
    ({ data: queries.map(forecast), source: source('weather') })) };
  const engine = { step: jest.fn().mockImplementation(async (input: PlanningInput) => {
    if (!input.weather.length) return { kind: 'weather_required', queries: [{
      id: 'query-1', segmentId: input.roadCandidates[0].segments[0].id,
      location: data.request.origin, validAt: '2026-11-10T08:00:30+03:00',
    }] };
    return syntheticPlan(input);
  }) };
  const coordinator = new PlanningCoordinator(vehicles,routing,stations,weather,engine);
  return { ...data, vehicles, routing, stations, weather, engine, coordinator };
}

describe('Planning provider boundaries', () => {
  it('does not call an incomplete station search definitive infeasibility',async()=>{
    const f=setup(),set=stationSet();set.metadata.coverage.completeForQuery=false;
    f.stations.findAlongRoutes.mockResolvedValue({data:set,source:source('stations')});
    f.engine.step.mockResolvedValue({kind:'result',result:{status:'infeasible',requestId:f.request.requestId,
      reasons:[{code:'NO_CHARGING_PLAN',explanation:'Synthetic test'}]}});
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({status:'insufficient_data',reasons:[{code:'STATION_COVERAGE_INCOMPLETE'}]});
  });
  it('records station search limitations on an otherwise valid plan',async()=>{
    const f=setup(),set=stationSet();set.metadata.coverage.completeForQuery=false;
    f.stations.findAlongRoutes.mockResolvedValue({data:set,source:source('stations')});
    const result=await f.coordinator.plan(f.request,f.options);
    if(result.status!=='planned')throw new Error('Expected synthetic valid plan');
    expect(result.plan.warnings.some(w=>w.code==='station_coverage_incomplete')).toBe(true);
  });
  it('resolves a saved legacy ID before asking for the canonical energy profile',async()=>{
    const f=setup();const canonical=f.request.vehicleVariantId;f.request.vehicleVariantId='saved-legacy-id';
    f.vehicles.resolveId.mockResolvedValue(canonical);
    expect((await f.coordinator.plan(f.request,f.options)).status).toBe('planned');
    expect(f.vehicles.profile.mock.calls[0][0]).toBe(canonical);
    expect(f.vehicles.profile.mock.calls[0][2]).toBe('verified_only');
  });
  it('rejects an engineering profile when the request requires verified data',async()=>{
    const f=setup();f.vehicle.dataQuality={schemaVersion:'vehicle-quality/1.0.0',policy:'allow_engineering_estimates',
      quality:'engineering_estimate',verificationNote:'Synthetic engineering profile',assumptions:['Synthetic only'],methodId:'test',methodVersion:'1'};
    expect((await f.coordinator.plan(f.request,f.options)).status).toBe('provider_error');
    expect(f.routing.routes).not.toHaveBeenCalled();
  });
  it('keeps the engineering label and assumptions in a plan that explicitly permits estimates',async()=>{
    const f=setup();f.request.policy.vehicleDataQuality='allow_engineering_estimates';
    f.vehicle.dataQuality={schemaVersion:'vehicle-quality/1.0.0',policy:'allow_engineering_estimates',
      quality:'engineering_estimate',verificationNote:'Synthetic engineering profile',assumptions:['Synthetic only'],methodId:'test',methodVersion:'1'};
    const result=await f.coordinator.plan(f.request,f.options);
    expect(result.status).toBe('planned');
    if(result.status==='planned') expect(result.plan.warnings.some(w=>w.code==='engineering_estimate')).toBe(true);
  });
  it('runs through Nest DI using only fake data providers and our internal test engine', async () => {
    const f = setup();
    const module = await Test.createTestingModule({ imports: [PlanningModule.register([
      { provide: VehicleEnergyProvider, useValue: f.vehicles }, { provide: RoutingProvider, useValue: f.routing },
      { provide: StationDataProvider, useValue: f.stations }, { provide: WeatherProvider, useValue: f.weather },
      { provide: PlanningEngine, useValue: f.engine },
    ])] }).compile();
    try {
      const result = await module.get(PlanningCoordinator).plan(f.request,f.options);
      expect(result.status).toBe('planned');
      expect(f.routing.routes.mock.calls[0][0]).not.toHaveProperty('startingChargePercent');
      expect(f.routing.routes.mock.calls[0][0]).not.toHaveProperty('vehicleVariantId');
      expect(f.engine.step).toHaveBeenCalledTimes(2);
      const input = f.engine.step.mock.calls[1][0];
      expect(input.dataSnapshots).toHaveLength(4);
      expect(input.dataSnapshots.every((entry) => /^[a-f0-9]{64}$/.test(entry.checksumSha256))).toBe(true);
      expect(Object.isFrozen(input.roadCandidates[0].segments)).toBe(true);
    } finally { await module.close(); }
  });

  it('returns insufficient data before calling external providers if the energy profile is absent', async () => {
    const f = setup();
    f.vehicles.profile.mockResolvedValue({ data: null, source: source('vehicles') });
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({ status: 'insufficient_data' });
    expect(f.routing.routes).not.toHaveBeenCalled();
    expect(f.engine.step).not.toHaveBeenCalled();
  });

  it('keeps a confirmed missing road separate from a transport error', async () => {
    const f = setup();
    f.routing.routes.mockResolvedValue({ data: null, source: source('roads') });
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({ status: 'infeasible' });
    expect(f.stations.findAlongRoutes).not.toHaveBeenCalled();
    f.routing.routes.mockRejectedValue(new Error('vendor-api-key=private'));
    const failed = await f.coordinator.plan(f.request,f.options);
    expect(failed).toMatchObject({ status: 'provider_error' });
    expect(JSON.stringify(failed)).not.toContain('private');
  });

  it('rejects provider-supplied charging stops instead of delegating EV decisions', async () => {
    const f = setup();
    f.routing.routes.mockResolvedValue({ data: { schemaVersion: '1.0.0', routes: [f.road], chargingStops: [] },
      source: source('roads') });
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({
      status: 'provider_error', reasons: [{ code: 'ROAD_PROVIDER_INVALID_DATA' }],
    });
    expect(f.engine.step).not.toHaveBeenCalled();
  });

  it('rejects a different vehicle variant and malformed provenance', async () => {
    const f = setup();
    f.vehicles.profile.mockResolvedValue({ data: { ...f.vehicle, vehicleVariantId: 'wrong-vehicle',
      consumptionReferences: [] }, source: source('vehicles') });
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({ status: 'provider_error' });
    f.vehicles.profile.mockResolvedValue({ data: f.vehicle, source: { sourceId: 'missing-source-fields' } });
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({ status: 'provider_error' });
    expect(f.routing.routes).not.toHaveBeenCalled();
  });

  it('requires complete weather responses for the exact requested place/time', async () => {
    for (const mode of ['missing','duplicate','wrong-time','wrong-place','wrong-segment']) {
      const f = setup();
      f.weather.forecast.mockImplementation(async (queries) => {
        const weather = forecast(queries[0]);
        if (mode === 'wrong-time') weather.validAt = '2026-11-10T09:00:00+03:00';
        if (mode === 'wrong-place') weather.location = f.request.destination;
        if (mode === 'wrong-segment') weather.segmentId = 'not-requested';
        return { data: mode === 'missing' ? [] : mode === 'duplicate' ? [weather,weather] : [weather],
          source: source('weather') };
      });
      expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({
        status: 'provider_error', reasons: [{ code: 'WEATHER_PROVIDER_INVALID_DATA' }],
      });
    }
  });

  it('refreshes weather when our engine changes passage time', async () => {
    const f = setup();
    let calls = 0;
    f.request.policy.maxIterations = 4;
    f.engine.step.mockImplementation(async (input) => {
      calls++;
      if (calls <= 2) return { kind: 'weather_required', queries: [{
        id: 'query-1', segmentId: 'segment-1', location: f.request.origin,
        validAt: calls === 1 ? '2026-11-10T08:00:30+03:00' : '2026-11-10T08:30:30+03:00',
      }] };
      expect(input.weather[0].validAt).toBe('2026-11-10T08:30:30+03:00');
      return { kind: 'result', result: { status: 'insufficient_data', requestId: input.request.requestId,
        reasons: [{ code: 'TEST_ONLY', explanation: 'No actual charging calculation in this test.' }] } };
    });
    expect((await f.coordinator.plan(f.request,f.options)).status).toBe('insufficient_data');
    expect(f.weather.forecast).toHaveBeenCalledTimes(2);
  });

  it('does not refetch identical weather queries or exceed the iteration budget', async () => {
    const f = setup();
    f.engine.step.mockResolvedValue({ kind: 'weather_required', queries: [{
      id: 'query-1', segmentId: 'segment-1', location: f.request.origin, validAt: '2026-11-10T08:00:30+03:00',
    }] });
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({
      status: 'computation_limit', reasons: [{ code: 'PLANNING_ITERATION_LIMIT' }],
    });
    expect(f.weather.forecast).toHaveBeenCalledTimes(1);
    f.request.policy.maxIterations = 1;
    f.weather.forecast.mockClear();
    await f.coordinator.plan(f.request,f.options);
    expect(f.weather.forecast).not.toHaveBeenCalled();
  });

  it('does not report our engine contract bugs as provider outages', async () => {
    const f = setup();
    f.engine.step.mockResolvedValue({ kind: 'result', result: {
      status: 'insufficient_data', requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reasons: [{ code: 'TEST', explanation: 'Wrong request' }],
    } });
    await expect(f.coordinator.plan(f.request,f.options)).rejects.toBeInstanceOf(PlanningContractError);
  });

  it('rejects internal weather queries for segments that do not exist', async () => {
    const f = setup();
    f.engine.step.mockResolvedValue({ kind: 'weather_required', queries: [{
      id: 'query-1', segmentId: 'unrelated-segment', location: f.request.origin, validAt: f.request.departureAt,
    }] });
    await expect(f.coordinator.plan(f.request,f.options)).rejects.toBeInstanceOf(PlanningContractError);
    expect(f.weather.forecast).not.toHaveBeenCalled();
  });

  it('propagates caller cancellation and does not invoke adapters for an already-cancelled request', async () => {
    const f = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(f.coordinator.plan(f.request,f.options,controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.vehicles.profile).not.toHaveBeenCalled();
  });

  it('times out stalled I/O and aborts the adapter signal', async () => {
    const f = setup();
    f.request.policy.maxComputationMilliseconds = 20;
    let aborted = false;
    f.vehicles.profile.mockImplementation((_id,signal) => new Promise((_resolve,reject) => {
      signal.addEventListener('abort',() => { aborted = true; reject(signal.reason); },{ once: true });
    }));
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({
      status: 'computation_limit', reasons: [{ code: 'PLANNING_DEADLINE_EXCEEDED' }],
    });
    expect(aborted).toBe(true);
  });

  it('validates request and preparation limits before touching providers', async () => {
    const f = setup();
    f.options.stationCorridorMeters = -1;
    await expect(f.coordinator.plan(f.request,f.options)).rejects.toThrow();
    expect(f.vehicles.profile).not.toHaveBeenCalled();
  });

  it('bounds the total weather set across iterations, not just each batch', async () => {
    const f = setup();
    f.options.maxWeatherQueries = 1;
    f.request.policy.maxIterations = 4;
    let step = 0;
    f.engine.step.mockImplementation(async () => ({ kind: 'weather_required', queries: [{
      id: 'query-' + (++step), segmentId: 'segment-1', location: f.request.origin,
      validAt: '2026-11-10T08:00:30+03:00',
    }] }));
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({
      status: 'computation_limit', reasons: [{ code: 'WEATHER_SAMPLE_LIMIT' }],
    });
    expect(f.weather.forecast).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-flight adapter when the caller leaves', async () => {
    const f = setup();
    const caller = new AbortController();
    let adapterSignal: AbortSignal | undefined;
    let markStarted!:()=>void;
    const started=new Promise<void>(resolve=>{markStarted=resolve;});
    f.vehicles.profile.mockImplementation((_id,signal) => new Promise((_resolve,reject) => {
      adapterSignal = signal;
      signal.addEventListener('abort',() => reject(signal.reason),{ once: true });
      markStarted();
    }));
    const pending = f.coordinator.plan(f.request,f.options,caller.signal);
    await started;
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(adapterSignal?.aborted).toBe(true);
    expect(f.routing.routes).not.toHaveBeenCalled();
  });

  it('does not silently turn a failed station source into an empty station catalogue', async () => {
    const f = setup();
    f.stations.findAlongRoutes.mockRejectedValue(new Error('private-provider-error'));
    expect(await f.coordinator.plan(f.request,f.options)).toMatchObject({
      status: 'provider_error', reasons: [{ code: 'STATION_PROVIDER_FAILED' }],
    });
    expect(f.engine.step).not.toHaveBeenCalled();
  });
});
