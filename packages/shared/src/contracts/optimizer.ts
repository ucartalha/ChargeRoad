import {z} from 'zod';
import {idSchema,nonnegativeSchema,positiveSchema,timestampSchema} from './common.js';
export const optimizerOptionsSchema=z.object({
  id:idSchema,version:idSchema,maxStates:z.number().int().positive().max(100000),maxTransitions:z.number().int().positive().max(500000),
  maxFrontier:z.number().int().positive().max(100000),
  maxStations:z.number().int().nonnegative().max(100),maxStops:z.number().int().nonnegative().max(20),
  maxRoadQueries:z.number().int().positive().max(1000),maxWeatherQueries:z.number().int().positive().max(30000),
  socStepPercent:positiveSchema.max(20),connectionSeconds:nonnegativeSchema,
  corridorMeters:z.array(positiveSchema.max(100000)).min(1).max(5),
  queueScenarioSeconds:z.literal(0),
}).strict().refine(r=>r.corridorMeters.every((v,i)=>i===0||v>r.corridorMeters[i-1]),'Corridors must widen strictly');
export const planScenarioSchema=z.object({
  kind:z.literal('conditional_timeline'),queueAssumptionSeconds:z.literal(0),
  departureAt:timestampSchema,arrivalAt:timestampSchema,totalSeconds:positiveSchema,
  segmentTimes:z.array(z.object({segmentId:idSchema,departureAt:timestampSchema,arrivalAt:timestampSchema}).strict()),
  stopTimes:z.array(z.object({stopId:idSchema,arrivalAt:timestampSchema,departureAt:timestampSchema}).strict()),
  conditions:z.array(z.string().min(1)),
}).strict();
export const optimizerSearchSchema=z.object({policyId:idSchema,policyVersion:idSchema,
  objective:z.enum(['minimum_total_duration','minimum_energy','minimum_charging_stops']),
  scope:z.literal('bounded_corridor_no_repeated_stations_sampled_soc'),optimality:z.literal('not_proven'),
  searchComplete:z.boolean(),stoppedReason:z.enum(['frontier_exhausted','state_budget','frontier_budget','transition_budget','deadline','data_budget']),
  expandedStates:z.number().int().nonnegative(),evaluatedTransitions:z.number().int().nonnegative(),
  roadQueries:z.number().int().nonnegative(),weatherQueries:z.number().int().nonnegative(),elapsedMilliseconds:nonnegativeSchema,
  skippedData:z.array(idSchema),socStepPercent:positiveSchema.max(20),
  drivingNetBatteryKwh:z.number().finite(),scenarioDurationSeconds:positiveSchema,
}).strict();
export type OptimizerOptions=z.infer<typeof optimizerOptionsSchema>;
export type OptimizerSearch=z.infer<typeof optimizerSearchSchema>;
