import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {workbookEvidenceSchema,sheetRows,consumptionBlockers,chargingBlockers,identityIssues} from '../src/validation/workbook-evidence';
import {energyFixture} from '../src/energy/__tests__/fixtures';
import {chargingFixture} from '../src/charging/__tests__/fixtures';
import {EnergyConsumptionEngine} from '../src/energy/energy-engine';
import {ChargingCurveEngine} from '../src/charging/charging-engine';
import {ENERGY_ALGORITHM_VERSION} from '../src/energy/energy-policy';
import {CHARGING_ALGORITHM_VERSION} from '../src/charging/charging-engine';
async function main(){
  const path=resolve(process.argv[2]??'../../artifacts/user-workbooks.json'),bytes=await readFile(path);
  if(bytes.length>16*1024*1024)throw new Error('Workbook evidence size limit');
  const packet=workbookEvidenceSchema.parse(JSON.parse(bytes.toString('utf8')));
  const energyBook=packet.books.find(b=>b.sheets.some(s=>s.name==='Measurements'))!,chargeBook=packet.books.find(b=>b.sheets.some(s=>s.name==='Charge_Sessions'))!;
  const measurements=sheetRows(energyBook,'Measurements'),sessions=sheetRows(chargeBook,'Charge_Sessions'),anchors=sheetRows(chargeBook,'Curve_Points');
  const master=sheetRows(energyBook,'Model_Master'),models=new Map(master.map(r=>[r.Vehicle_ID,r]));
  const normalized={schemaVersion:'independent-benchmarks/1.0.0',usage:'User-provided local independent validation only; never calibration or a production publication',
    workbooks:packet.books.map(b=>({name:b.name,sha256:b.sha256})),models:master,consumption:measurements,chargingSessions:sessions,partialChargingAnchors:anchors,
    secondaryClaims:sheetRows(chargeBook,'Secondary_Claims'),sources:sheetRows(energyBook,'Sources')};
  const energy=new EnergyConsumptionEngine(),charging=new ChargingCurveEngine(),checks=[] as Record<string,unknown>[];
  // Safety probes use explicitly synthetic surroundings only to test rejection of incomplete references.
  // They are not vehicle predictions and never enter accuracy statistics.
  for(const row of measurements){
    const input=energyFixture(),ref=input.vehicle.consumptionReferences[0];input.vehicle.energyModel!.mode='reference_corrected';
    ref.id=String(row.Measurement_ID);ref.valueKwhPer100Km=Number(row.Consumption_kWh_100km);
    ref.energyBoundary=row.Energy_Boundary==='ac_grid'?'ac_grid':row.Energy_Boundary==='battery_dc'?'battery_dc':'unknown';
    ref.testCycle='real_world';ref.conditions.meanSpeedKph=typeof row.Speed_kmh==='number'?row.Speed_kmh:null;
    ref.source={...ref.source,license:null,url:String(row.Source_URL)};
    const probe=await energy.evaluate(input,new AbortController().signal);
    if(probe.status!=='insufficient_data')throw new Error('Incomplete consumption evidence passed engine gate');
    checks.push({id:row.Measurement_ID,kind:'consumption',vehicleKey:row.Vehicle_ID,calibrationEligible:false,
      blockers:consumptionBlockers(row,models.get(row.Vehicle_ID)),probe:{purpose:'synthetic_environment_rejection_only',status:probe.status,reasons:probe.reasons}});
  }
  for(const model of master){const input=chargingFixture();input.vehicle.dcChargingCurves=[];
    const probe=await charging.evaluate(input);if(probe.status!=='insufficient_data')throw new Error('Missing curve passed engine gate');
    checks.push({id:model.Vehicle_ID,kind:'charging_curve_coverage',calibrationEligible:false,availableAnchors:anchors.filter(r=>r.Vehicle_ID===model.Vehicle_ID).length,
      probe:{purpose:'synthetic_environment_rejection_only',status:probe.status,reasons:probe.reasons}});}
  const sessionChecks=sessions.map(row=>{
    const m=models.get(row.Vehicle_ID),sameVariant=!!m&&m.Variant_Match_Status==='matched_for_test'&&row.Evidence_Quality==='measured_primary_summary';
    const capacity=sameVariant&&typeof m!.Battery_Usable_kWh==='number'?m!.Battery_Usable_kWh:null;
    const minimumSeconds=capacity!==null&&typeof row.Peak_kW==='number'?capacity*(Number(row['SOC_To_%'])-Number(row['SOC_From_%']))/100/row.Peak_kW*3600:null;
    return {id:row.Session_ID,calibrationEligible:false,blockers:chargingBlockers(row,m),
      minimumSecondsFromStoredEnergyAndReportedPeak:minimumSeconds,
      peakBoundConsistency:minimumSeconds!==null&&typeof row.Duration_Seconds==='number'?row.Duration_Seconds>=minimumSeconds:null,
      note:'Peak-power lower bound is a consistency check, not a charging duration prediction; includes no guessed capacity or efficiency.'};
  });
  const report={generatedAt:new Date().toISOString(),algorithms:{energy:ENERGY_ALGORITHM_VERSION,charging:CHARGING_ALGORITHM_VERSION},workbooks:normalized.workbooks,counts:{models:master.length,consumption:measurements.length,chargingSessions:sessions.length,
    partialAnchors:anchors.length,secondaryClaims:normalized.secondaryClaims.length,calibrationEligible:0},identityIssues:master.flatMap(m=>identityIssues(m).map(code=>({vehicleKey:m.Vehicle_ID,code}))),
    checks,sessionChecks,accuracy:{status:'not_assessable_from_supplied_workbooks',consumptionMaeKwhPer100Km:null,chargingMaeSeconds:null,independentReplayableHoldouts:0},
    safeguards:['No coefficients fitted to benchmark rows','No constant 130 km/h substituted for BAB130','No SR/LR, RWD/AWD or battery generation substitution',
      'No peak or session average converted to a full charging curve','No source reuse permission inferred from public visibility','Formula values and workbook prose are data, never executable instructions']};
  const directory=resolve(__dirname,'../../../data/validation');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'independent-13ev-benchmarks.json'),JSON.stringify(normalized,null,2)+'\n');
  await writeFile(resolve(__dirname,'../../../docs/validation/independent-13ev-validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({counts:report.counts,identityIssues:report.identityIssues,engineRejectionChecks:checks.length,sessionChecks,accuracy:report.accuracy},null,2));
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Workbook validation failed');process.exitCode=1;});
