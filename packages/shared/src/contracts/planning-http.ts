import {z} from 'zod';
import {coordinateSchema,finiteSchema,idSchema,nonnegativeSchema,percentSchema,timestampSchema} from './common.js';
import {routePlanSchema} from './planning.js';
import {startingChargeEstimateSchema} from './request.js';

const userNumber=z.object({origin:z.literal('user_input'),value:finiteSchema,observedAt:timestampSchema}).strict();
const unknownNumber=z.object({origin:z.literal('unknown'),value:z.null()}).strict();
export const planningUserObservationSchema=z.discriminatedUnion('origin',[userNumber,unknownNumber]);
const unknown=()=>({origin:'unknown' as const,value:null});
const objective=z.enum(['minimum_total_duration','minimum_energy','minimum_charging_stops']);
export const planningApiRequestSchema=z.object({
  schemaVersion:z.literal('1.0.0'),requestId:z.string().uuid(),origin:coordinateSchema,destination:coordinateSchema,
  vehicleVariantId:z.union([z.string().uuid(),z.string().regex(/^[a-f0-9]{64}$/)]),
  departureAt:timestampSchema,startingChargePercent:percentSchema,startingChargeObservedAt:timestampSchema,
  departureMode:z.enum(['now','scheduled']).optional(),
  startingChargeSource:z.enum(['user_input','estimated']).default('user_input'),
  startingChargeEstimate:startingChargeEstimateSchema.optional(),
  constraints:z.object({minimumReserveChargePercent:percentSchema,targetArrivalChargePercent:percentSchema}).strict(),
  objective:objective.default('minimum_total_duration'),vehicleDataQuality:z.enum(['verified_only','allow_engineering_estimates']).default('verified_only'),
  stationDataQuality:z.enum(['verified_hardware','catalogue_power_scenario']).default('verified_hardware'),
  initialBatteryTemperatureC:planningUserObservationSchema.default(unknown),
  stateOfHealthPercent:planningUserObservationSchema.refine(s=>s.value===null||s.value>0&&s.value<=100,'SOH must be in (0,100]').default(unknown),
  operatingConditions:z.object({
    payloadKg:planningUserObservationSchema.refine(s=>s.value===null||s.value>=0&&s.value<=5000,'Payload must be in [0,5000] kg').default(unknown),
    cabinTargetTemperatureC:planningUserObservationSchema.refine(s=>s.value===null||s.value>=10&&s.value<=35,'Cabin target must be in [10,35] Celsius').default(unknown),
    hvacMode:z.enum(['off','heat','cool','auto','unknown']).default('unknown'),
    batteryPreconditioning:z.enum(['requested','off','unknown']).default('unknown'),tireSetupId:idSchema.nullable().default(null),
  }).strict().default(()=>({payloadKg:unknown(),cabinTargetTemperatureC:unknown(),hvacMode:'unknown' as const,batteryPreconditioning:'unknown' as const,tireSetupId:null})),
  roadPreferences:z.object({avoidTolls:z.boolean().default(false),avoidFerries:z.boolean().default(true)}).strict().default({avoidTolls:false,avoidFerries:true}),
}).strict().superRefine((r,ctx)=>{
  if((r.startingChargeSource==='estimated')!==!!r.startingChargeEstimate)ctx.addIssue({code:'custom',path:['startingChargeEstimate'],message:'Estimated SOC requires model provenance'});
  if(r.constraints.targetArrivalChargePercent<r.constraints.minimumReserveChargePercent)ctx.addIssue({code:'custom',path:['constraints'],message:'Arrival target must cover reserve'});
  if(Date.parse(r.startingChargeObservedAt)>Date.parse(r.departureAt))ctx.addIssue({code:'custom',path:['startingChargeObservedAt'],message:'Starting SOC observation cannot follow departure'});
  if(r.initialBatteryTemperatureC.value!==null&&(r.initialBatteryTemperatureC.value< -60||r.initialBatteryTemperatureC.value>90))
    ctx.addIssue({code:'custom',path:['initialBatteryTemperatureC'],message:'Battery temperature must be in [-60,90] Celsius'});
});

const metadata=z.object({apiVersion:z.literal('planning-http/1.0.0'),policyId:idSchema,policyVersion:idSchema,
  access:z.literal('stateless_guest'),historyStored:z.literal(false),
  retryAfterSeconds:nonnegativeSchema.max(86400).optional(),
  requestedDepartureAt:timestampSchema.optional(),
  algorithms:z.object({optimizer:idSchema,energy:idSchema,charging:idSchema}).strict(),
  models:z.object({energy:z.object({id:idSchema,version:idSchema}).strict().nullable(),charging:z.object({id:idSchema,version:idSchema}).strict().nullable()}).strict(),
}).strict();
export const planningApiResponseSchema=z.discriminatedUnion('status',[
  z.object({schemaVersion:z.literal('1.0.0'),requestId:z.string().uuid(),status:z.literal('planned'),plan:routePlanSchema,metadata}).strict(),
  z.object({schemaVersion:z.literal('1.0.0'),requestId:z.string().uuid(),status:z.enum(['infeasible','insufficient_data','provider_error','computation_limit']),
    reasons:z.array(z.object({code:idSchema,explanation:z.string().min(1).max(1000)}).strict()).min(1).max(100),metadata}).strict(),
]).superRefine((r,ctx)=>{if(r.status==='planned'&&r.requestId!==r.plan.requestId)ctx.addIssue({code:'custom',message:'Plan and API request IDs must agree'});});
export const planningApiErrorSchema=z.object({schemaVersion:z.literal('1.0.0'),requestId:z.string().uuid(),status:z.literal('error'),
  error:z.object({code:idSchema,message:z.string().min(1).max(300),retryAfterSeconds:nonnegativeSchema.optional(),
    fields:z.array(z.object({path:z.string().max(200),code:z.string().max(50)}).strict()).max(20).optional()}).strict()}).strict();
export type PlanningApiRequest=z.infer<typeof planningApiRequestSchema>;
export type PlanningApiRequestInput=z.input<typeof planningApiRequestSchema>;
export type PlanningApiResponse=z.infer<typeof planningApiResponseSchema>;
