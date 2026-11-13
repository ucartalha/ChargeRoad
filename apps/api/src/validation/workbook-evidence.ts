import {z} from 'zod';
const value=z.union([z.string(),z.number().finite(),z.null()]);
export const workbookEvidenceSchema=z.object({schemaVersion:z.literal('workbook-evidence/1.0.0'),purpose:z.string(),books:z.array(z.object({
  name:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),sheets:z.array(z.object({name:z.string(),rows:z.array(z.object({row:z.number().int(),
    cells:z.record(z.string(),z.object({value,formula:z.string().nullable()}))}))}))}))});
export type WorkbookEvidence=z.infer<typeof workbookEvidenceSchema>;
export type EvidenceRow=Record<string,string|number|null>;
export function sheetRows(book:WorkbookEvidence['books'][number],name:string):EvidenceRow[]{
  const sheet=book.sheets.find(s=>s.name===name);if(!sheet?.rows.length)throw new Error('Missing worksheet: '+name);
  const columns=new Map(Object.entries(sheet.rows[0].cells).map(([cell,data])=>[cell.replace(/\d+$/,''),String(data.value)]));
  return sheet.rows.slice(1).map(row=>{
    const out:EvidenceRow={_row:row.row};
    for(const [column,header] of columns){const cell=row.cells[column+row.row];
      // Cached formula output is not independent measurement evidence.
      out[header]=cell?.formula?null:cell?.value??null;
    }return out;
  });
}
export function consumptionBlockers(row:EvidenceRow,master?:EvidenceRow){
  const reasons=['REPLAYABLE_DRIVE_TRACE_MISSING','VEHICLE_CALIBRATION_NOT_SUPPLIED','REUSE_PERMISSION_UNVERIFIED'];
  if(!master)reasons.push('EXACT_VARIANT_MASTER_MISSING');
  else if(master.Variant_Match_Status!=='matched_for_test')reasons.push('EXACT_VARIANT_UNRESOLVED');
  if(master)reasons.push(...identityIssues(master));
  if(row.Speed_Definition!=='constant_speed_measured')reasons.push('NOT_A_MEASURED_CONSTANT_SPEED_REFERENCE');
  if(row.Energy_Boundary==='ac_grid')reasons.push('CONDITION_MATCHED_GRID_TO_BATTERY_CONVERSION_MISSING');
  else if(row.Energy_Boundary!=='battery_dc')reasons.push('BATTERY_ENERGY_BOUNDARY_UNKNOWN');
  if(row.Ambient_C===null)reasons.push('AMBIENT_TEMPERATURE_UNKNOWN');
  reasons.push('WIND_GRADE_PAYLOAD_HVAC_REFERENCE_CONDITIONS_INCOMPLETE');
  return reasons;
}
export function chargingBlockers(row:EvidenceRow,master?:EvidenceRow){
  const reasons=['FULL_VEHICLE_ACCEPTANCE_CURVE_MISSING','EVSE_VOLTAGE_CURRENT_PATH_LIMITS_MISSING','CHARGING_LOSS_MODEL_MISSING','REUSE_PERMISSION_UNVERIFIED'];
  if(!master)reasons.push('EXACT_VARIANT_MASTER_MISSING');
  else {if(master.Variant_Match_Status!=='matched_for_test')reasons.push('EXACT_VARIANT_UNRESOLVED');reasons.push(...identityIssues(master));}
  if(row.Battery_Temp_C===null)reasons.push('BATTERY_TEMPERATURE_UNKNOWN');
  if(row.Energy_Boundary!=='vehicle_inlet'&&row.Energy_Boundary!=='pack_terminal'&&row.Energy_Boundary!=='battery_stored')reasons.push('CHARGING_ENERGY_BOUNDARY_UNKNOWN');
  if(typeof row.Duration_Seconds!=='number')reasons.push('EXACT_DURATION_UNAVAILABLE');
  if(row.Evidence_Quality==='measured_primary_related_trim'||row.Evidence_Quality==='measured_secondary_related_variant')reasons.push('RELATED_VARIANT_NOT_INTERCHANGEABLE');
  return reasons;
}
export function identityIssues(master:EvidenceRow){
  const declared=String(master.Drivetrain).toLowerCase(),tags=String(master.Vehicle_ID).match(/(?:^|-)(rwd|fwd|awd)(?:-|$)/);
  return tags&&declared!==tags[1]?['DRIVETRAIN_ID_CONFLICT']:[];
}
