import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export const stationFieldSchema=z.enum(['station','access.publicAccess','access.membershipRequired','access.openingHours','lifecycle','equipment','connectorClaims']);
export type StationField=z.infer<typeof stationFieldSchema>;
export const sourcePolicySchema=z.object({
  version:z.string().min(1),
  providers:z.record(z.string(),z.object({enabled:z.boolean(),priority:z.number().int().nonnegative(),
    costRank:z.number().int().nonnegative(),quarantineReview:z.object({version:z.string().min(1),
      exclusions:z.array(z.object({externalId:z.string().min(1),reason:z.string().min(1)}).strict())}).strict().optional()}).strict()),
  fields:z.partialRecord(stationFieldSchema,z.array(z.string().min(1)).refine(a=>new Set(a).size===a.length,'Duplicate provider preference')),
}).strict();
export type StationSourcePolicy=z.infer<typeof sourcePolicySchema>;
export const DEFAULT_SOURCE_POLICY:StationSourcePolicy={version:'station-sources/1.0.0',
  providers:{'epdk-stations':{enabled:true,priority:10,costRank:0},'open-charge-map':{enabled:true,priority:20,costRank:0}},fields:{}};

export function loadStationSourcePolicy():StationSourcePolicy {
  const file=process.env.STATION_SOURCE_POLICY_FILE;
  return sourcePolicySchema.parse(JSON.parse(readFileSync(file||resolve(__dirname,'../../../../../data/station-sources/policy.json'),'utf8')));
}
// Field preferences are explicit. Otherwise prefer reviewed priority, then estimated cost.
// costRank is an operator-configured relative budget, never a claimed provider price.
export function sourceOrder(policy:StationSourcePolicy,a:string,b:string,field?:StationField,fallbackA=1000,fallbackB=1000){
  const preferences=field?policy.fields[field]??[]:[];
  const ai=preferences.indexOf(a),bi=preferences.indexOf(b);
  if(ai>=0||bi>=0){const d=(ai<0?Infinity:ai)-(bi<0?Infinity:bi);if(d)return d;}
  return (policy.providers[a]?.priority??fallbackA)-(policy.providers[b]?.priority??fallbackB)
    ||(policy.providers[a]?.costRank??1000)-(policy.providers[b]?.costRank??1000)||a.localeCompare(b);
}
