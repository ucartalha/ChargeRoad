import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {energyEvaluationRequestSchema} from '@chargeroad/shared';
import {DatabaseService} from '../src/database/database.service';
import {DbVehicleEnergyProvider} from '../src/vehicles/knowledge/db-vehicle-energy.provider';
import {EnergyConsumptionEngine} from '../src/energy/energy-engine';
import {ENERGY_ALGORITHM_VERSION} from '../src/energy/energy-policy';
import {analyticalEnergyCases} from '../src/energy/validation/energy-cases';
import {tripAccuracy} from '../src/planning/validation/metrics';
import {reviewJourneyObservation} from '../src/energy/observation-review';

const fieldRecord=z.object({id:z.string().min(1),vehicleKey:z.enum(['ioniq6-2023-53-rwd-18','ioniq5-2025-63-rwd-19']),
  split:z.enum(['calibration','holdout']),collectionPermission:z.literal('explicit_validation_permission'),
  input:energyEvaluationRequestSchema,
  measured:z.object({arrivalSocPercent:z.number().min(0).max(100),consumedKwh:z.number().finite(),chargingSeconds:z.literal(0)}).strict(),
  evidence:z.object({kind:z.enum(['user_report','documented_field_measurement']),method:z.string().min(1),referenceId:z.string().min(1)}).strict()}).strict();
async function main(){
  const engine=new EnergyConsumptionEngine(),signal=AbortSignal.timeout(30000);
  const checks:{id:string;status:string;expectedNetKwh:number;actualNetKwh:number;errorKwh:number;inputChecksum:string}[]=[];
  for(const item of analyticalEnergyCases()){
    const result=await engine.evaluate(item.input,signal),error=result.netBatteryEnergyKwh-item.expectedNetKwh;
    if(result.status!==item.expectedStatus||Math.abs(error)>1e-8)throw new Error('Analytical energy mismatch: '+item.id);
    checks.push({id:item.id,status:result.status,expectedNetKwh:item.expectedNetKwh,actualNetKwh:result.netBatteryEnergyKwh,errorKwh:error,inputChecksum:result.inputChecksumSha256});
  }
  const database=new DatabaseService();
  try{
    const pilots=JSON.parse(await readFile(resolve(__dirname,'../../../data/vehicle-knowledge/pilots-v4-istanbul-ankara-observation.json'),'utf8'));
    const provider=new DbVehicleEnergyProvider(database),coverage=[] as {vehicleKey:string;canonicalId:string|null;gate:string;userObservations:number}[];
    for(const record of pilots.records){
      const row=(await database.pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1 AND external_id=$2',[pilots.source.key,record.externalId])).rows[0];
      const p=row?(await provider.profile(row.entity_id,signal,'allow_engineering_estimates')).data:null;
      coverage.push({vehicleKey:record.externalId,canonicalId:row?.entity_id??null,
        gate:!p?'VEHICLE_ENERGY_PROFILE_MISSING':!p.energyModel?'ENERGY_CALIBRATION_MISSING':'CALIBRATED_PROFILE_PRESENT',userObservations:record.observations?.length??0});
    }
    const inputPath=process.argv[2];let records:z.infer<typeof fieldRecord>[]=[];
    if(inputPath){const bytes=await readFile(resolve(inputPath));if(bytes.length>8*1024*1024)throw new Error('Energy field dataset exceeds size budget');records=z.array(fieldRecord).max(100).parse(JSON.parse(bytes.toString('utf8')));}
    const errors:unknown[]=[],unassessable:{id:string;status:string;reasons:{code:string;segmentId:string|null}[]}[]=[];
    if(new Set(records.map(r=>r.id)).size!==records.length)throw new Error('Duplicate field record across splits');
    for(const record of records){
      if(record.split==='holdout'&&record.input.vehicle.energyModel?.calibrationRecordIds?.includes(record.id))
        throw new Error('A calibration record cannot also be an independent holdout');
      const identity=coverage.find(p=>p.vehicleKey===record.vehicleKey);
      if(!identity?.canonicalId||identity.canonicalId!==record.input.vehicle.vehicleVariantId)throw new Error('Field record does not match canonical pilot variant');
      const predicted=await engine.evaluate(record.input,signal);
      if(!['estimated','charge_required'].includes(predicted.status)||predicted.partialSegmentId||Math.abs(predicted.completedDistanceMeters-record.input.route.distanceMeters)>.001){
        unassessable.push({id:record.id,status:predicted.status,reasons:predicted.reasons});continue;
      }
      errors.push({id:record.id,vehicleKey:record.vehicleKey,split:record.split,collectionPermission:record.collectionPermission,
        distanceKm:record.input.route.distanceMeters/1000,speed:{kind:'modelled_trip_average',kph:record.input.route.distanceMeters/record.input.route.drivingDurationSeconds*3.6},
        ambientTemperatureC:null,hvac:record.input.request.operatingConditions.hvacMode==='off'?'off':'unknown',measuredEnergyBoundary:'battery_dc',evidence:record.evidence,
        measured:record.measured,predicted:{arrivalSocPercent:predicted.finalChargePercent!,consumedKwh:predicted.netBatteryEnergyKwh,chargingSeconds:0,
          modelVersion:predicted.algorithmVersion+'/'+predicted.modelId+'/'+predicted.modelVersion}});
    }
    const ownerJourneyReviews=pilots.records.flatMap((r:{observations?:unknown[]})=>(r.observations??[]).map(reviewJourneyObservation).filter(Boolean));
    const report={generatedAt:new Date().toISOString(),algorithmVersion:ENERGY_ALGORITHM_VERSION,analytical:checks,pilotCoverage:coverage,ownerJourneyReviews,
      fieldAccuracy:tripAccuracy(errors),unassessable,notes:['Analytical cases are synthetic, not field accuracy.','Owner consumption intervals lack trip snapshots and are not holdout observations.','No production vehicle calibration was invented or published.']};
    await writeFile(resolve(__dirname,'../../../docs/validation/task11-energy-validation.json'),JSON.stringify(report,null,2)+'\n');
    const directory=resolve(__dirname,'../../../artifacts/task11-energy');await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'replay-input.json'),JSON.stringify(analyticalEnergyCases()[0].input,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await database.onModuleDestroy();}
}
void main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'Energy validation failed');process.exitCode=1;});
