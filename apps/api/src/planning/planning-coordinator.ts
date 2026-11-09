import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  chargingStationSchema, planningEvaluationSchema, planningInputSchema, roadRoutingRequestSchema,
  roadRoutingResultSchema, routePlanRequestSchema, sourceReferenceSchema,
  vehicleEnergyProfileSchema, weatherForecastSchema,
} from '@chargeroad/shared';
import type {
  PlanningInput, PlanningResult, RoadRoutingRequest, RoutePlanRequest, WeatherForecast, WeatherQuery,
} from '@chargeroad/shared';
import { RoutingProvider } from '../providers/routing-provider';
import { StationDataProvider } from '../providers/station-data-provider';
import { VehicleEnergyProvider } from '../providers/vehicle-energy-provider';
import { WeatherProvider } from '../providers/weather-provider';
import type { ProviderResponse } from '../providers/provider-response';
import { engineStepSchema, PlanningEngine } from './planning-engine';

const routingOptionsSchema = roadRoutingRequestSchema.omit({ schemaVersion: true, origin: true, destination: true, departureAt: true });
export const preparationOptionsSchema = z.object({
  road: routingOptionsSchema,
  stationCorridorMeters: z.number().positive().max(100000),
  maxWeatherQueries: z.number().int().positive().max(10000),
}).strict();
export type PreparationOptions = z.infer<typeof preparationOptionsSchema>;

export class PlanningContractError extends Error {}
class PlanningDeadline extends Error {}
class ProviderBoundaryError extends Error {
  constructor(readonly role: string, readonly code: 'FAILED' | 'INVALID_DATA') { super(role + ':' + code); }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return operation();
    }).then(resolve,reject).finally(() => signal.removeEventListener('abort',cancel));
  });
}

@Injectable()
export class PlanningCoordinator {
  constructor(
    private readonly vehicles: VehicleEnergyProvider,
    private readonly routing: RoutingProvider,
    private readonly stations: StationDataProvider,
    private readonly weather: WeatherProvider,
    private readonly engine: PlanningEngine,
  ) {}

  async plan(rawRequest: RoutePlanRequest, rawOptions: PreparationOptions, callerSignal?: AbortSignal): Promise<PlanningResult> {
    const request = routePlanRequestSchema.parse(rawRequest);
    const options = preparationOptionsSchema.parse(rawOptions);
    const controller = new AbortController();
    const signal = controller.signal;
    const deadlineAt = performance.now() + request.policy.maxComputationMilliseconds;
    const checkBudget = () => {
      if (!signal.aborted && performance.now() >= deadlineAt) controller.abort(new PlanningDeadline());
      if (signal.aborted) throw signal.reason;
    };
    const cancel = () => controller.abort(new DOMException('Planning cancelled','AbortError'));
    if (callerSignal?.aborted) cancel();
    else callerSignal?.addEventListener('abort',cancel,{ once: true });
    const timer = setTimeout(() => controller.abort(new PlanningDeadline()),
      Math.min(request.policy.maxComputationMilliseconds, 2147483647));
    const failure = (status: 'provider_error' | 'insufficient_data' | 'infeasible' | 'computation_limit', code: string): PlanningResult =>
      ({ status, requestId: request.requestId, reasons: [{ code, explanation: code }] });
    const snapshots: PlanningInput['dataSnapshots'] = [];
    const read = async <T>(role: string, schema: z.ZodType<T>, operation: () => Promise<ProviderResponse<T>>): Promise<T> => {
      checkBudget();
      let raw: ProviderResponse<T>;
      try { raw = await abortable(operation,signal); }
      catch (error) {
        if (signal.aborted) throw signal.reason;
        throw new ProviderBoundaryError(role,'FAILED');
      }
      const parsed = z.object({ data: schema, source: sourceReferenceSchema }).strict().safeParse(raw);
      checkBudget();
      if (!parsed.success) throw new ProviderBoundaryError(role,'INVALID_DATA');
      const data = parsed.data.data;
      snapshots.push({ sourceId: parsed.data.source.sourceId, version: parsed.data.source.version,
        capturedAt: parsed.data.source.retrievedAt,
        checksumSha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') });
      return freeze(data);
    };

    try {
      const vehicle = await read('VEHICLE',vehicleEnergyProfileSchema.nullable(),
        () => this.vehicles.profile(request.vehicleVariantId,signal));
      if (!vehicle) return failure('insufficient_data','VEHICLE_ENERGY_PROFILE_MISSING');
      if (vehicle.vehicleVariantId !== request.vehicleVariantId) throw new ProviderBoundaryError('VEHICLE','INVALID_DATA');
      const roadRequest: RoadRoutingRequest = roadRoutingRequestSchema.parse({ ...options.road,
        schemaVersion: request.schemaVersion, origin: request.origin, destination: request.destination, departureAt: request.departureAt });
      const roads = await read('ROAD',roadRoutingResultSchema.nullable(), () => this.routing.routes(freeze(roadRequest),signal));
      if (!roads) return failure('infeasible','ROAD_ROUTE_NOT_FOUND');
      const stations = await read('STATION',z.array(chargingStationSchema),
        () => this.stations.findAlongRoutes(roads.routes,options.stationCorridorMeters,signal));
      const forecasts = new Map<string, WeatherForecast>();
      const segments = new Set(roads.routes.flatMap((road) => road.segments.map((segment) => segment.id)));
      const sameQuery = (query: WeatherQuery, forecast: WeatherForecast) => query.segmentId === forecast.segmentId &&
        Date.parse(query.validAt) === Date.parse(forecast.validAt) &&
        query.location.latitude === forecast.location.latitude && query.location.longitude === forecast.location.longitude;

      for (let iteration = 0; iteration < request.policy.maxIterations; iteration++) {
        checkBudget();
        const input = freeze(planningInputSchema.parse({ request, vehicle, roadCandidates: roads.routes,
          stations, weather: [...forecasts.values()], dataSnapshots: [...snapshots] }));
        const rawStep = await abortable(() => this.engine.step(input,signal),signal);
        checkBudget();
        const parsed = engineStepSchema.safeParse(rawStep);
        if (!parsed.success) throw new PlanningContractError('Invalid application engine response');
        const step = parsed.data;
        if (step.kind === 'result') {
          const evaluated = planningEvaluationSchema.safeParse({ input, result: step.result });
          if (!evaluated.success) throw new PlanningContractError('Application plan does not match its input snapshots');
          return evaluated.data.result;
        }
        if (step.queries.length > options.maxWeatherQueries ||
            new Set(step.queries.map((query) => query.id)).size !== step.queries.length ||
            step.queries.some((query) => !segments.has(query.segmentId)))
          throw new PlanningContractError('Invalid application weather query set');
        if (iteration + 1 >= request.policy.maxIterations) return failure('computation_limit','PLANNING_ITERATION_LIMIT');
        const needed = step.queries.filter((query) => {
          const existing = forecasts.get(query.id);
          return !existing || !sameQuery(query,existing);
        });
        if (!needed.length) continue;
        if (forecasts.size + needed.filter((query) => !forecasts.has(query.id)).length > options.maxWeatherQueries)
          return failure('computation_limit','WEATHER_SAMPLE_LIMIT');
        const result = await read('WEATHER',z.array(weatherForecastSchema),
          () => this.weather.forecast(freeze(needed),signal));
        const expected = new Map(needed.map((query) => [query.id,query]));
        if (new Set(result.map((forecast) => forecast.queryId)).size !== result.length ||
            result.length !== needed.length || result.some((forecast) => {
              const query = expected.get(forecast.queryId);
              return !query || !sameQuery(query,forecast);
            })) throw new ProviderBoundaryError('WEATHER','INVALID_DATA');
        for (const forecast of result) forecasts.set(forecast.queryId,forecast);
      }
      return failure('computation_limit','PLANNING_ITERATION_LIMIT');
    } catch (error) {
      if (error instanceof PlanningDeadline) return failure('computation_limit','PLANNING_DEADLINE_EXCEEDED');
      if (error instanceof ProviderBoundaryError) return failure('provider_error',error.role + '_PROVIDER_' + error.code);
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort',cancel);
      if (!signal.aborted) controller.abort(new DOMException('Planning finished','AbortError'));
    }
  }
}
