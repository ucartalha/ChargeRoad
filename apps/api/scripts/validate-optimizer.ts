import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {optimizerWorld} from '../src/planning/__tests__/optimizer.fixtures';
import {analyticalStopReference} from '../src/planning/validation/optimizer-reference';
import {replayOptimizer} from '../src/planning/planning-replay';
import {DatabaseService} from '../src/database/database.service';
import {DbVehicleEnergyProvider} from '../src/vehicles/knowledge/db-vehicle-energy.provider';
import {OPTIMIZER_VERSION} from '../src/planning/optimizer-policy';
async function main(){
  const checks:Record<string,unknown>[]=[];const directory=resolve(__dirname,'../../../artifacts/task13-planning');await mkdir(directory,{recursive:true});
  for(const mode of ['minimum_total_duration','minimum_charging_stops','minimum_energy'] as const){
    const world=optimizerWorld(false);world.request.policy.objective=mode;
    const result=await world.service.plan(world.request,world.preparation,world.options),reference=analyticalStopReference(mode);
    if(result.result.status!=='planned'||!reference.answer)throw new Error('Synthetic planner failed: '+mode);
    const plan=result.result.plan,error=Math.abs(plan.scenario!.totalSeconds-reference.answer.seconds);
    if(error>.01||Math.abs(plan.search!.drivingNetBatteryKwh-reference.answer.netKwh)>1e-8||plan.chargingStops.length!==reference.answer.stops.length)
      throw new Error('Independent exhaustive mismatch: '+mode);
    const replay=await replayOptimizer(result.replay,world.preparation.road,new AbortController().signal);
    if(replay.result.status!=='planned'||JSON.stringify(replay.result.plan.scenario)!==JSON.stringify(plan.scenario))throw new Error('Offline replay mismatch');
    checks.push({mode,scenarioSeconds:plan.scenario!.totalSeconds,referenceSeconds:reference.answer.seconds,errorSeconds:error,
      stops:plan.chargingStops.map(s=>({stationId:s.stationId,arrivalSoc:s.arrivalChargePercent,targetSoc:s.targetChargePercent})),
      drivingNetKwh:plan.search!.drivingNetBatteryKwh,actualEta:plan.estimatedArrivalAt,replay:'matched',search:plan.search});
    if(mode==='minimum_total_duration')await writeFile(resolve(directory,'replay.json'),JSON.stringify({packet:result.replay,roadOptions:world.preparation.road},null,2)+'\n');
  }
  const database=new DatabaseService();try{
    const packet=JSON.parse(await readFile(resolve(__dirname,'../../../data/vehicle-knowledge/pilots-v4-istanbul-ankara-observation.json'),'utf8'));
    const provider=new DbVehicleEnergyProvider(database),pilots:Record<string,unknown>[]=[];
    for(const record of packet.records){const row=(await database.pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1 AND external_id=$2',[packet.source.key,record.externalId])).rows[0];
      const profile=row?(await provider.profile(row.entity_id,AbortSignal.timeout(5000),'allow_engineering_estimates')).data:null;
      pilots.push({vehicleKey:record.externalId,canonicalId:row?.entity_id??null,gate:!profile?'VEHICLE_ENERGY_PROFILE_MISSING':!profile.energyModel?'ENERGY_CALIBRATION_MISSING':
        !profile.chargingModel||!profile.dcChargingCurves.length?'VEHICLE_CHARGING_PROFILE_MISSING':'PROFILE_PRESENT_REQUIRES_COMPLETE_HARDWARE_AND_ROUTE_VALIDATION'});
    }
    const report={generatedAt:new Date().toISOString(),optimizerVersion:OPTIMIZER_VERSION,scope:'Synthetic scaled analytical graph, exact reference comparison and local DB profile gates; no public provider calls or field accuracy claim',
      checks,pilots,realWorldAcceptance:'awaiting_vehicle_calibration_physical_evse_and_independent_field_data',notes:['No global optimality claim.','Unknown queue keeps actual ETA null.','No user reserve/arrival SOC defaults were inserted.']};
    await writeFile(resolve(__dirname,'../../../docs/validation/task13-optimizer-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{await database.onModuleDestroy();}
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Optimizer validation failed');process.exitCode=1;});
