import {z} from 'zod';
import {routePlanRequestSchema,vehicleEnergyProfileSchema,optimizerOptionsSchema,stationCandidateSetSchema,coordinateSchema} from '@chargeroad/shared';
import type {RoadRoutingRequest,WeatherQuery} from '@chargeroad/shared';
import {ChargeStopOptimizer} from './charge-stop-optimizer';
import {PlanningSession} from './planning-session';
import type {SessionReplay} from './planning-session';
import type {PlanningContext} from './optimizer-types';
import type {PreparationOptions} from './planning-coordinator';
import {RoutingProvider} from '../providers/routing-provider';
import {WeatherProvider} from '../providers/weather-provider';
import {EnergyConsumptionEngine} from '../energy/energy-engine';
import {ChargingCurveEngine,CHARGING_ALGORITHM_VERSION} from '../charging/charging-engine';
import {ENERGY_ALGORITHM_VERSION} from '../energy/energy-policy';
import {OPTIMIZER_VERSION} from './optimizer-policy';
import {checksum} from './plan-compiler';

export async function replayOptimizer(raw:unknown,road:PreparationOptions['road'],signal:AbortSignal){
  const packet=z.object({versions:z.object({optimizer:z.literal(OPTIMIZER_VERSION),energy:z.literal(ENERGY_ALGORITHM_VERSION),charging:z.literal(CHARGING_ALGORITHM_VERSION)}),
    context:z.object({request:routePlanRequestSchema,vehicle:vehicleEnergyProfileSchema,evaluatedAt:z.iso.datetime({offset:true}),options:optimizerOptionsSchema,
      candidates:stationCandidateSetSchema,nodes:z.array(z.object({id:z.string(),location:coordinateSchema,stationId:z.string().nullable()}))}),providers:z.unknown()}).parse(raw);
  const context:PlanningContext=packet.context,recording=packet.providers as SessionReplay;
  if(!Array.isArray(recording?.roads)||!Array.isArray(recording?.weather))throw new Error('Invalid replay provider packet');
  const routing={routes:async(request:RoadRoutingRequest)=>{
    const from=context.nodes.find(n=>JSON.stringify(n.location)===JSON.stringify(request.origin))?.id,to=context.nodes.find(n=>JSON.stringify(n.location)===JSON.stringify(request.destination))?.id;
    const row=recording.roads.find(r=>r.from===from&&r.to===to&&r.at===request.departureAt);if(!row)throw new Error('ROAD_SNAPSHOT_MISSING');return structuredClone(row.response);
  }} as RoutingProvider;
  const weather={forecast:async(queries:WeatherQuery[])=>{
    const row=recording.weather.find(w=>checksum(w.queries)===checksum(queries));if(!row)throw new Error('WEATHER_SNAPSHOT_MISSING');return structuredClone(row.response);
  }} as WeatherProvider;
  const base=recording.roads.find(r=>r.from==='origin'&&r.to==='destination'&&r.at===context.request.departureAt)?.response.data?.routes??[];
  const session=new PlanningSession(context,routing,weather,new EnergyConsumptionEngine(),new ChargingCurveEngine(),road,performance.now()+60000,base);
  session.counters.roadQueries=base.length?1:0;
  return new ChargeStopOptimizer(()=>0).solve(context,session,signal);
}
