import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {consumptionBlockers,chargingBlockers,identityIssues,sheetRows,workbookEvidenceSchema} from './workbook-evidence';
type EvidenceRow=import('./workbook-evidence').EvidenceRow;
const data=JSON.parse(readFileSync(resolve(__dirname,'../../../../data/validation/independent-13ev-benchmarks.json'),'utf8'));
describe('Independent workbook evidence gates',()=>{
  const models=new Map<string,EvidenceRow>(data.models.map((r:EvidenceRow)=>[String(r.Vehicle_ID),r]));
  it.each(data.consumption as EvidenceRow[])('keeps incomplete external consumption $Measurement_ID out of calibration',row=>{
    const blockers=consumptionBlockers(row,models.get(String(row.Vehicle_ID)));
    expect(blockers).toContain('REPLAYABLE_DRIVE_TRACE_MISSING');expect(blockers).toContain('REUSE_PERMISSION_UNVERIFIED');
    if(row.Speed_Definition==='cycle_max_130')expect(blockers).toContain('NOT_A_MEASURED_CONSTANT_SPEED_REFERENCE');
    if(row.Energy_Boundary==='ac_grid')expect(blockers).toContain('CONDITION_MATCHED_GRID_TO_BATTERY_CONVERSION_MISSING');
  });
  it.each(data.chargingSessions as EvidenceRow[])('does not construct a vehicle curve from session $Session_ID',row=>{
    expect(chargingBlockers(row,models.get(String(row.Vehicle_ID)))).toContain('FULL_VEHICLE_ACCEPTANCE_CURVE_MISSING');
  });
  it('detects contradictory identity fields without silently changing the supplied evidence',()=>{
    const issues=data.models.flatMap((r:EvidenceRow)=>identityIssues(r));expect(issues).toContain('DRIVETRAIN_ID_CONFLICT');
    for(const row of data.models as EvidenceRow[])if(identityIssues(row).length)expect(String(row.Vehicle_ID)).toMatch(/rwd|awd|fwd/);
  });
  it('maps sparse worksheet columns by coordinates and never treats cached formulas as measurement',()=>{
    const packet=workbookEvidenceSchema.parse({schemaVersion:'workbook-evidence/1.0.0',purpose:'test',books:[{name:'test',sha256:'a'.repeat(64),
      sheets:[{name:'test',rows:[{row:1,cells:{A1:{value:'id',formula:null},B1:{value:'gap',formula:null},C1:{value:'value',formula:null}}},
        {row:2,cells:{A2:{value:'x',formula:null},C2:{value:42,formula:'40+2'}}}]}]}]});
    expect(sheetRows(packet.books[0],'test')).toEqual([{_row:2,id:'x',gap:null,value:null}]);
  });
});
