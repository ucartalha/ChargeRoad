import { createHash } from 'node:crypto';
import { z } from 'zod';
import { stationCatalogueRecordSchema,stationImportPackageSchema } from '@chargeroad/shared';
import type { StationCatalogueRecord } from '@chargeroad/shared';
import type { CatalogueSourceContext,StationCatalogueSource } from './catalogue-source';

const id=z.number().int().positive();
const rowSchema=z.object({ID:id,DataProviderID:id,OperatorID:z.number().int().nullable().optional(),
  AddressInfo:z.object({Title:z.string().min(1),Latitude:z.number().min(35).max(43),Longitude:z.number().min(25).max(46),
    Country:z.object({ISOCode:z.literal('TR')})}).passthrough(),
  Connections:z.array(z.object({ID:id,ConnectionTypeID:z.number().int().nonnegative().nullable(),PowerKW:z.number().nullable().optional(),
    Quantity:z.number().int().nullable().optional(),CurrentTypeID:z.number().int().nullable().optional()}).passthrough()).max(1000),
  StatusTypeID:z.number().int().nullable().optional(),UsageTypeID:z.number().int().nullable().optional(),
  DateLastStatusUpdate:z.string().nullable().optional(),
  DataProvider:z.object({ID:id,IsOpenDataLicensed:z.boolean().nullable(),License:z.string().nullable()}).passthrough(),
}).passthrough();
const referenceSchema=z.object({ConnectionTypes:z.array(z.object({ID:z.number().int().nonnegative(),Title:z.string()})),
  UsageTypes:z.array(z.object({ID:z.number().int(),Title:z.string(),IsMembershipRequired:z.boolean().nullable().optional()}))}).passthrough();
const standards:Record<number,string>={1:'type1',2:'chademo',25:'type2',32:'ccs1',33:'ccs2',1036:'type2'};
const validTime=(value:unknown)=>typeof value==='string'&&z.iso.datetime({offset:true}).safeParse(value).success?value:null;

export function normalizeOcm(rows:unknown[],reference:unknown,retrievedAt:string,rawBytes:Buffer){
  const ref=referenceSchema.parse(reference);
  const types=new Map(ref.ConnectionTypes.map(t=>[t.ID,t.Title]));
  const usages=new Map(ref.UsageTypes.map(t=>[t.ID,t]));
  const hash=createHash('sha256').update(rawBytes).digest('hex');
  const records:StationCatalogueRecord[]=[],quarantine:{externalId:string|null;reason:string;raw:Record<string,unknown>}[]=[];
  for(const raw of rows){
    const parsed=rowSchema.safeParse(raw);
    if(!parsed.success&&typeof raw==='object'&&raw!==null&&'ID'in raw&&'AddressInfo'in raw){
      const address=raw.AddressInfo as {Latitude?:unknown;Longitude?:unknown}|null;
      if(address?.Latitude===0&&address.Longitude===0){
        quarantine.push({externalId:String(raw.ID),reason:'ZERO_COORDINATE',raw:{ID:raw.ID,Latitude:0,Longitude:0}});continue;
      }
    }
    if(!parsed.success){quarantine.push({externalId:typeof raw==='object'&&raw!==null&&'ID'in raw?String(raw.ID):null,
      reason:'INVALID_OCM_RECORD',raw:{issues:parsed.error.issues.map(i=>({path:i.path,code:i.code}))}});continue;}
    const r=parsed.data;
    // Initial reviewed permission set. New data providers require an explicit licence-policy change.
    if(r.DataProviderID!==1||r.DataProvider.ID!==1||r.DataProvider.IsOpenDataLicensed!==true||
      !/Creative Commons Attribution 4\.0 International \(CC BY 4\.0\)/.test(r.DataProvider.License??'')){
      quarantine.push({externalId:String(r.ID),reason:'OCM_LICENSE_NOT_APPROVED',raw:{ID:r.ID,DataProviderID:r.DataProviderID}});continue;
    }
    const recordUpdatedAt=validTime(r.DateLastStatusUpdate);
    const recent=recordUpdatedAt!==null&&Date.parse(recordUpdatedAt)<=Date.parse(retrievedAt)&&
      Date.parse(retrievedAt)-Date.parse(recordUpdatedAt)<=365*86400000;
    const lifecycle=recent?(r.StatusTypeID===150?'planned':r.StatusTypeID===200||r.StatusTypeID===210?'removed':
      r.StatusTypeID===100||r.StatusTypeID===30?'temporarily_closed':r.StatusTypeID===50?'operating':'unknown'):'unknown';
    const usage=usages.get(r.UsageTypeID??-1);
    // OCM public usage IDs are resolved against their source titles, not inferred from IsMembershipRequired.
    const publicAccess=usage?.Title.startsWith('Public')?true:usage?.Title.startsWith('Private')?false:null;
    const source={sourceId:'open-charge-map',recordId:String(r.ID),version:hash,
      url:'https://openchargemap.org/site/poi/details/'+r.ID,retrievedAt,publishedAt:null,license:'CC-BY-4.0'};
    const normalized=stationCatalogueRecordSchema.safeParse({externalId:String(r.ID),partyId:'ocm',countryCode:'TR',
      matchCanonicalId:null,matchRationale:null,lifecycle,recordUpdatedAt,
      licenseEvidence:[{sourceId:'open-charge-map',dataProviderId:'1',license:'CC-BY-4.0',
        licenseUrl:'https://creativecommons.org/licenses/by/4.0/',attribution:'Open Charge Map contributors',recordUrl:source.url}],
      station:{id:String(r.ID),name:r.AddressInfo.Title,location:{latitude:r.AddressInfo.Latitude,longitude:r.AddressInfo.Longitude},
        operatorId:r.OperatorID?'ocm:operator:'+r.OperatorID:null,evses:[],sharedPowerPools:[],
        access:{publicAccess,membershipRequired:usage?.IsMembershipRequired??null,openingHours:null},source},
      connectorClaims:r.Connections.map(c=>({sourceConnectorId:String(c.ID),standard:standards[c.ConnectionTypeID??0]??'other',
        powerType:c.CurrentTypeID===30?'dc':c.CurrentTypeID===10||c.CurrentTypeID===20?'ac':'unknown',
        maxPowerKw:c.PowerKW&&c.PowerKW>0?c.PowerKW:null,rawType:types.get(c.ConnectionTypeID??0)??String(c.ConnectionTypeID),
        granularity:'equipment_summary',quantity:c.Quantity&&c.Quantity>0?c.Quantity:null})),
      warnings:['ocm_general_status_not_live_availability','evse_grouping_unknown',...(!recent?['record_status_age_unverified_or_stale']:[])],
      // Strip comments, media, users, and volatile computed verification fields from normalized evidence.
      raw:{ID:r.ID,OperatorID:r.OperatorID??null,StatusTypeID:r.StatusTypeID??null,UsageTypeID:r.UsageTypeID??null,
        DateLastStatusUpdate:r.DateLastStatusUpdate??null,NumberOfPoints:r.NumberOfPoints??null,
        AddressInfo:{Title:r.AddressInfo.Title,Latitude:r.AddressInfo.Latitude,Longitude:r.AddressInfo.Longitude},
        Connections:r.Connections.map(c=>({ID:c.ID,ConnectionTypeID:c.ConnectionTypeID,PowerKW:c.PowerKW??null,
          Quantity:c.Quantity??null,CurrentTypeID:c.CurrentTypeID??null}))}});
    if(!normalized.success){quarantine.push({externalId:String(r.ID),reason:'INVALID_OCM_NORMALIZED_RECORD',raw:{ID:r.ID}});continue;}
    records.push(normalized.data);
  }
  return stationImportPackageSchema.parse({schemaVersion:'station-catalogue/1.0.0',
    source:{key:'open-charge-map',name:'Open Charge Map',homepageUrl:'https://openchargemap.org',permission:'open_license',
      permissionReference:'https://openchargemap.org/about/terms; reviewed per-record provider licence',
      attribution:'Open Charge Map contributors; per-record provider attribution retained',license:null,priority:20},
    scope:{countryCode:'TR',key:'TR:ocm:contributors',completeSourceSnapshot:true,geographicCoverageVerified:false},
    version:hash,retrievedAt,sourceUpdatedAt:null,rawSha256:hash,sourceRowCount:rows.length,records,quarantine});
}

export class OcmCatalogueSource implements StationCatalogueSource {
  readonly key='open-charge-map';readonly countries=['TR'];readonly liveAvailability=false as const;
  readonly fields=['station','access.publicAccess','access.membershipRequired','connectorClaims','lifecycle'] as const;
  constructor(private readonly apiKey:string|undefined,private readonly pageSize=500,private readonly maxPages=20){}
  async collect(countryCode:string,context:CatalogueSourceContext){
    if(countryCode!=='TR')throw new Error('OCM country unsupported');
    if(!this.apiKey)throw new Error('OPEN_CHARGE_MAP_API_KEY is required');
    const call=async(path:string,params:Record<string,string>)=>{
      const url=new URL('https://api.openchargemap.io/v3/'+path+'/');
      for(const [k,v]of Object.entries({...params,client:'ChargeRoad'}))url.searchParams.set(k,v);
      return context.request({url:url.href,headers:{'X-API-Key':this.apiKey!},requestClass:'catalogue',
        minIntervalMs:1100,maxBytes:8*1024*1024,timeoutMs:25000});
    };
    const reference=await call('referencedata',{});
    const ref=JSON.parse(reference.bytes.toString('utf8'));
    referenceSchema.parse(ref);
    const rows:unknown[]=[],pages:{urlCursor:number;retrievedAt:string;sha256:string;data:unknown[]}[]=[];
    let cursor=0,complete=false;
    for(let page=0;page<this.maxPages;page++){
      context.signal.throwIfAborted();
      const response=await call('poi',{output:'json',countrycode:countryCode,opendata:'true',dataproviderid:'1',
        maxresults:String(this.pageSize),sortby:'id_asc',greaterthanid:String(cursor),compact:'false',verbose:'true',includecomments:'false'});
      const data=z.array(z.record(z.string(),z.unknown())).max(this.pageSize).parse(JSON.parse(response.bytes.toString('utf8')));
      const ids=data.map(r=>id.parse(r.ID));
      if(ids.some((value,i)=>value<=(i?ids[i-1]:cursor)))throw new Error('OCM pagination did not advance in strict ID order');
      pages.push({urlCursor:cursor,retrievedAt:response.retrievedAt,sha256:createHash('sha256').update(response.bytes).digest('hex'),data});
      rows.push(...data);if(data.length<this.pageSize){complete=true;break;}cursor=ids.at(-1)!;
    }
    if(!complete)throw new Error('OCM page budget reached; incomplete catalogue will not be published');
    const retrievedAt=pages.at(-1)!.retrievedAt;
    // One immutable acquisition bundle includes reference data and every page with receipts.
    const rawBytes=Buffer.from(JSON.stringify({schemaVersion:1,reference:{retrievedAt:reference.retrievedAt,data:ref},pages}));
    return {rawBytes,package:normalizeOcm(rows,ref,retrievedAt,rawBytes)};
  }
}
