import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseService} from '../src/database/database.service';
import {DbVehicleEnergyProvider} from '../src/vehicles/knowledge/db-vehicle-energy.provider';
import {ChargingCurveEngine,CHARGING_ALGORITHM_VERSION} from '../src/charging/charging-engine';
import {analyticalChargingCases} from '../src/charging/validation/charging-cases';
async function main(){
  const engine=new ChargingCurveEngine(),checks:Record<string,unknown>[]=[];
  for(const item of analyticalChargingCases()){
    const r=await engine.evaluate(item.input),error=r.chargingSeconds===null?null:r.chargingSeconds-item.expectedSeconds;
    if(r.status!=='estimated'||error===null||Math.abs(error)>.001)throw new Error('Analytical charging mismatch: '+item.id);
    checks.push({id:item.id,status:r.status,expectedSeconds:item.expectedSeconds,actualSeconds:r.chargingSeconds,errorSeconds:error,
      storedKwh:r.energyStoredKwh,inletKwh:r.energyDeliveredAtInletKwh,auxiliaryKwh:r.auxiliaryEnergyKwh,lossKwh:r.conversionLossKwh,inputChecksum:r.inputChecksumSha256});
  }
  const db=new DatabaseService();try{
    const packet=JSON.parse(await readFile(resolve(__dirname,'../../../data/vehicle-knowledge/pilots-v4-istanbul-ankara-observation.json'),'utf8'));
    const provider=new DbVehicleEnergyProvider(db),coverage:Record<string,unknown>[]=[];
    for(const record of packet.records){
      const row=(await db.pool.query('SELECT entity_id FROM catalogue_bindings WHERE source_key=$1 AND external_id=$2',[packet.source.key,record.externalId])).rows[0];
      const p=row?(await provider.profile(row.entity_id,AbortSignal.timeout(5000),'allow_engineering_estimates')).data:null;
      coverage.push({vehicleKey:record.externalId,canonicalId:row?.entity_id??null,gate:!p?'VEHICLE_CHARGING_PROFILE_MISSING':!p.chargingModel?'CHARGING_CALIBRATION_MISSING':!p.dcChargingCurves.length?'DC_CHARGING_CURVE_MISSING':'CHARGING_PROFILE_PRESENT'});
    }
    const report={generatedAt:new Date().toISOString(),algorithmVersion:CHARGING_ALGORITHM_VERSION,analytical:checks,pilotCoverage:coverage,
      fieldAccuracy:{status:'awaiting_field_data',independentSessions:0,durationMaeSeconds:null,durationP95AbsoluteErrorSeconds:null},
      notes:['Synthetic analytical agreement is not vehicle field accuracy.','No Hyundai charging curve, converter limit or efficiency was invented.','Availability, waiting, opening hours and stop optimization belong to the planner.']};
    await writeFile(resolve(__dirname,'../../../docs/validation/task12-charging-validation.json'),JSON.stringify(report,null,2)+'\n');
    const directory=resolve(__dirname,'../../../artifacts/task12-charging');await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'replay-input.json'),JSON.stringify(analyticalChargingCases()[1].input,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await db.onModuleDestroy();}
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Charging validation failed');process.exitCode=1;});
