// Reproducible extract from a pinned, licensed snapshot, not a request-time data provider.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { knowledgePackageSchema } from '@chargeroad/shared';

const upstreamSchema=z.object({meta:z.object({updated_at:z.string()}),data:z.array(z.object({
  id:z.string(),brand:z.string(),model:z.string(),release_year:z.number(),usable_battery_size:z.number().positive(),
  energy_consumption:z.object({average_consumption:z.number().positive()}),
  dc_charger:z.object({max_power:z.number(),charging_curve:z.array(z.object({percentage:z.number(),power:z.number()})),is_default_charging_curve:z.boolean()}),
}).passthrough())});
export const PILOT_SOURCE_COMMIT='32d7dc59e7b8b7391572ca1e132a1517be9a3b5e';
export async function buildPilotPackage(input:string,output:string) {
  const bytes=await readFile(input);
  const raw=z.object({data:z.array(z.unknown())}).passthrough().parse(JSON.parse(bytes.toString('utf8')));
  const candidate=raw.data.find((r:any)=>r.id==='4dd44dba-266f-4307-9604-fa6b594c48a2');
  const selected=upstreamSchema.parse({...raw,data:[candidate]}).data[0];
  const checksum=createHash('sha256').update(bytes).digest('hex');
  const manifest=z.object({sha256:z.string(),commit:z.literal(PILOT_SOURCE_COMMIT),retrievedAt:z.iso.datetime()})
    .passthrough().parse(JSON.parse(await readFile(resolve(__dirname,'../../../../../data/vehicle-knowledge/kilowatt-manifest.json'),'utf8')));
  if (manifest.sha256!==checksum) throw new Error('Pinned Kilowatt snapshot checksum mismatch');
  const url=`https://raw.githubusercontent.com/KilowattApp/open-ev-data/${PILOT_SOURCE_COMMIT}/data/ev-data.json`;
  const source={sourceId:'kilowatt-open-ev-data',recordId:selected.id,version:PILOT_SOURCE_COMMIT,url,
    retrievedAt:manifest.retrievedAt,publishedAt:null,license:'MIT-with-Attribution-Requirement'};
  const reported=(note:string)=>({quality:'source_reported',source,verificationNote:note,derivation:null});
  const quarantined=(note:string)=>({...reported(note),quality:'quarantined'});
  const config=(model:string,year:number,pack:number,wheel:number,power:number)=>({
    make:'Hyundai',makeSlug:'hyundai',model,modelSlug:model==='Ioniq 6'?'ioniq_6':'ioniq_5',modelYear:year,
    trim:'Pilot RWD',trimSlug:'pilot_rwd',variant:`${pack} kWh / ${wheel} inch`,variantSlug:`rwd_${pack}_${wheel}`,
    vehicleType:'car',markets:[],marketedBatteryKwh:pack,usableBatteryKwh:null,grossBatteryKwh:null,
    drivetrain:'rwd',wheelInches:wheel,motorPowerKw:power,maxAcChargeKw:null,maxDcChargeKw:null,connectorTypes:[]});
  const data=knowledgePackageSchema.parse({schemaVersion:'vehicle-knowledge/1.0.0',
    source:{key:'chargeroad-pilot-configurations',name:'ChargeRoad pilot configurations and source review',
      homepageUrl:'https://github.com/ucartalha/ChargeRoad',license:'LicenseRef-ChargeRoad-Pilot-Internal',permission:'own_data',
      permissionReference:'Anonymous vehicle configurations supplied by the project owner; external candidate facts retain the Kilowatt attribution license.'},
    version:'2026-11-10.1',generatedAt:manifest.retrievedAt,retrievedAt:manifest.retrievedAt,coverage:'supplemental',records:[
      {externalId:'ioniq6-2023-53-rwd-18',matchedLegacyId:null,matchBasis:'Owner-declared exact configuration. Coarse OpenEV record deliberately not merged without wheel/market proof.',
        configuration:config('Ioniq 6',2023,53,18,111),facts:[
          {id:'kilowatt-usable-claim',field:'usableBatteryKwh',value:selected.usable_battery_size,
            evidence:reported('Source reports 50 kWh; exact wheel/market and capacity validation remain open. Not selected into the public usable-capacity field.')},
          {id:'kilowatt-consumption-claim',field:'consumptionClaim',value:selected.energy_consumption,
            evidence:quarantined('Average consumption has no declared speed, conditions, test cycle or AC/DC energy boundary. Not a battery-DC speed reference.')},
          {id:'kilowatt-curve-claim',field:'chargingCurveClaim',value:selected.dc_charger,
            evidence:quarantined('Curve lacks session provenance, temperature and power boundary; 50 kW limit is not independently validated. Not a vehicle acceptance curve.')}
        ],consumption:[],charging:[],profiles:[],missing:['verified_model_year_market_wheel_match','usable_capacity_validation',
          'licensed_conditioned_speed_consumption','conditioned_dc_curve','charging_path_limits']},
      {externalId:'ioniq5-2025-63-rwd-19',matchedLegacyId:null,matchBasis:'Owner-selected pilot configuration; no matching 63 kWh entry in pinned OpenEV/Kilowatt snapshots.',
        configuration:config('Ioniq 5',2025,63,19,125),facts:[],consumption:[],charging:[],profiles:[],
        missing:['verified_model_year_market_match','usable_capacity','licensed_conditioned_speed_consumption','conditioned_dc_curve','charging_path_limits']}
    ]});
  await mkdir(resolve(output,'..'),{recursive:true});
  await writeFile(output,JSON.stringify(data,null,2)+'\n');
  return {output,sourceSha256:checksum,sourceCommit:PILOT_SOURCE_COMMIT};
}
if (require.main===module) buildPilotPackage(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r)))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
