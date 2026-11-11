import { createHash } from 'node:crypto';
import { z } from 'zod';
import { stationImportPackageSchema,stationCatalogueRecordSchema } from '@chargeroad/shared';
import type { StationCatalogueRecord } from '@chargeroad/shared';

const text=z.string().min(1).max(500);
const number=z.union([z.number().finite(),z.string().regex(/^-?\d+(?:[.,]\d+)?$/).transform(v=>Number(v.replace(',','.')))]);
const rowSchema=z.object({
  sarjIstasyonuNo:text,sarjIstasyonuAdi:text,sarjAgiIsletmecisiLisansNo:text,
  enlem:number,boylam:number,hizmetSekli:z.string(),
  soketler:z.array(z.object({soketNo:text,soketTipi:z.string(),soketTuru:z.string(),soketGucu:z.union([z.string(),z.number()]).nullable()}).passthrough()),
}).passthrough();
export function normalizeEpdk(bytes:Buffer,retrievedAt=new Date().toISOString()){
  if(bytes.length>64*1024*1024)throw new Error('EPDK source exceeds 64 MiB');
  const root=z.object({statusCode:z.literal(200),numRows:z.number().int().nonnegative().max(100000),
    errors:z.array(z.unknown()).length(0),data:z.array(z.unknown()).max(100000)}).parse(JSON.parse(bytes.toString('utf8')));
  if(root.numRows!==root.data.length)throw new Error('EPDK source record count mismatch');
  const rawSha256=createHash('sha256').update(bytes).digest('hex');
  const records:StationCatalogueRecord[]=[];
  const quarantine:{externalId:string|null;reason:string;raw:unknown}[]=[];
  for(const raw of root.data){
    const parsed=rowSchema.safeParse(raw);
    if(!parsed.success){quarantine.push({externalId:null,reason:'INVALID_SOURCE_ROW',raw});continue;}
    const r=parsed.data;
    if(r.enlem<35 || r.enlem>43 || r.boylam<25 || r.boylam>46){
      quarantine.push({externalId:r.sarjIstasyonuNo,reason:'OUTSIDE_TR_REVIEW_BOUNDS',raw});continue;
    }
    const source={sourceId:'epdk-stations',recordId:r.sarjIstasyonuNo,version:rawSha256,url:'https://apigateway.epdk.gov.tr/sarjIstasyonlari',
      retrievedAt,publishedAt:null,license:null};
    const warnings=['registry_lifecycle_not_live_status','evse_grouping_unknown'];
    const connectorClaims=r.soketler.map(c=>{
      const standard=c.soketTuru==='AC_TYPE2'?'type2' as const:c.soketTuru==='DC_CHADEMO'?'chademo' as const:'other' as const;
      if(standard==='other')warnings.push('connector_subtype_unverified:'+c.soketTuru);
      const power=typeof c.soketGucu==='number'?c.soketGucu:Number(c.soketGucu?.replace(',','.'));
      return {sourceConnectorId:c.soketNo,standard,powerType:c.soketTipi==='AC'?'ac' as const:c.soketTipi==='DC'?'dc' as const:'unknown' as const,
        maxPowerKw:Number.isFinite(power)&&power>0?power:null,rawType:c.soketTuru};
    });
    const record=stationCatalogueRecordSchema.safeParse({externalId:r.sarjIstasyonuNo,partyId:r.sarjAgiIsletmecisiLisansNo,
      countryCode:'TR',matchCanonicalId:null,matchRationale:null,lifecycle:'unknown',
      station:{id:r.sarjIstasyonuNo,name:r.sarjIstasyonuAdi,location:{latitude:r.enlem,longitude:r.boylam},
        operatorId:r.sarjAgiIsletmecisiLisansNo,evses:[],sharedPowerPools:[],
        access:{publicAccess:r.hizmetSekli==='HALKA_ACIK'?true:r.hizmetSekli==='OZEL'?false:null,membershipRequired:null,openingHours:null},source},
      connectorClaims,warnings:[...new Set(warnings)],raw});
    if(!record.success){quarantine.push({externalId:r.sarjIstasyonuNo,reason:'INVALID_NORMALIZED_EQUIPMENT',raw});continue;}
    records.push(record.data);
  }
  return stationImportPackageSchema.parse({schemaVersion:'station-catalogue/1.0.0',
    source:{key:'epdk-stations',name:'EPDK Şarj İstasyonları',homepageUrl:'https://epdk.gov.tr',permission:'public_service',
      permissionReference:'EPDK public station service and published usage guide; system integration described in EPDK FAQ 13.',
      attribution:'Kaynak: EPDK — Şarj İstasyonları Web Servisi',license:null,priority:10},
    scope:{countryCode:'TR',key:'TR:national-registry',completeSourceSnapshot:true,geographicCoverageVerified:false},
    version:rawSha256,retrievedAt,sourceUpdatedAt:null,rawSha256,sourceRowCount:root.numRows,records,quarantine});
}
