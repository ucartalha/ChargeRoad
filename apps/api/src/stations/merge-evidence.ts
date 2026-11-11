import type { SourceReference,StationCatalogueRecord } from '@chargeroad/shared';
import type { StationField,StationSourcePolicy } from './sources/source-policy';

export type StationPayload=Pick<StationCatalogueRecord,'station'|'connectorClaims'|'warnings'|'lifecycle'|'licenseEvidence'|'recordUpdatedAt'> & {fieldEvidence?:Record<string,SourceReference>};
// Inputs are explicitly crosswalked to the same canonical location and ordered by reviewed source priority.
export function mergeStationEvidence(inputs:StationPayload[],policy?:StationSourcePolicy):StationPayload {
  if(!inputs.length)throw new Error('No station evidence to merge');
  const order=(field:StationField)=>[...inputs].sort((a,b)=>{
    const preferences=policy?.fields[field]??[];
    const rank=(p:StationPayload)=>{const index=preferences.indexOf(p.station.source.sourceId);return index<0?preferences.length+inputs.indexOf(p):index;};
    return rank(a)-rank(b);
  });
  const result=structuredClone(order('station')[0]);
  result.warnings=inputs.flatMap(p=>p.warnings);
  result.fieldEvidence={station:result.station.source};
  for(const field of ['publicAccess','membershipRequired','openingHours'] as const){
    const known=order(('access.'+field) as StationField).find(p=>p.station.access[field]!==null);
    if(known){
      Object.assign(result.station.access,{[field]:known.station.access[field]});
      result.fieldEvidence['access.'+field]=known.station.source;
    }
    const values=inputs.map(p=>p.station.access[field]).filter(v=>v!==null).map(v=>JSON.stringify(v));
    if(new Set(values).size>1)result.warnings.push('source_conflict:access.'+field);
  }
  {
    const known=order('lifecycle').find(p=>p.lifecycle!=='unknown');
    if(known){result.lifecycle=known.lifecycle;result.fieldEvidence.lifecycle=known.station.source;}
  }
  // EVSEs and their power pools are one atomic equipment bundle; do not sum units across providers.
  {
    const known=order('equipment').find(p=>p.station.evses.length);
    if(known){result.station.evses=structuredClone(known.station.evses);result.station.sharedPowerPools=structuredClone(known.station.sharedPowerPools);
      result.fieldEvidence.equipment=known.station.source;}
  }
  {
    const known=order('connectorClaims').find(p=>p.connectorClaims.length);
    if(known){result.connectorClaims=structuredClone(known.connectorClaims);result.fieldEvidence.connectorClaims=known.station.source;}
  }
  const licences=inputs.flatMap(p=>p.licenseEvidence??[]);
  if(licences.length)result.licenseEvidence=[...new Map(licences.map(l=>[JSON.stringify(l),l])).values()];
  if(result.station.evses.length)result.warnings=result.warnings.filter(w=>w!=='evse_grouping_unknown');
  result.warnings=[...new Set(result.warnings)];return result;
}
