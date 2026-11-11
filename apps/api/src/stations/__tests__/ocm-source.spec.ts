import { normalizeOcm,OcmCatalogueSource } from '../sources/ocm-source';
import { StationSourceRegistry } from '../sources/catalogue-source';
import type { CatalogueSourceContext,StationCatalogueSource } from '../sources/catalogue-source';
import { DEFAULT_SOURCE_POLICY } from '../sources/source-policy';
import { mergeStationEvidence } from '../merge-evidence';
import { stationPackage } from './fixtures';

import { ocmRef,ocmRow,ocmPackage } from './ocm.fixtures';

describe('OCM catalogue adapter and provider policy',()=>{
  it('preserves equipment summaries, quantities and licence without fabricating EVSE groups',()=>{
    const r=ocmPackage().data.records[0];
    expect(r.connectorClaims[0]).toMatchObject({standard:'ccs2',maxPowerKw:180,quantity:4,granularity:'equipment_summary'});
    expect(r.station.evses).toEqual([]);expect(r.licenseEvidence?.[0].license).toBe('CC-BY-4.0');
    expect(r.station.access.membershipRequired).toBe(true);
    expect(JSON.stringify(r.raw)).not.toContain('secretTest');
  });
  it.each([10,20,50,75])('never promotes general/automated catalogue code %s to live availability',status=>{
    const row=ocmRow();row.StatusTypeID=status;
    const r=normalizeOcm([row],ocmRef,'2026-11-11T00:00:00Z',Buffer.from('source')).records[0];
    expect(r.station.evses).toHaveLength(0);expect(r.warnings).toContain('ocm_general_status_not_live_availability');
  });
  it('does not treat a fresh download as proof of a years-old failure',()=>{
    const row=ocmRow();row.DateLastStatusUpdate='2020-01-01T00:00:00Z';row.StatusTypeID=100;
    expect(normalizeOcm([row],ocmRef,'2026-11-11T00:00:00Z',Buffer.from('old')).records[0].lifecycle).toBe('unknown');
  });
  it('holds NC or changed provider licences despite the open-data flag',()=>{
    const bad=ocmRow(2);bad.DataProvider.License='CC BY-NC-SA 3.0';
    const p=normalizeOcm([ocmRow(),bad],ocmRef,'2026-11-11T00:00:00Z',Buffer.from('mixed'));
    expect(p.records).toHaveLength(1);expect(p.quarantine[0].reason).toBe('OCM_LICENSE_NOT_APPROVED');
  });
  it('keeps aliases independent of operator and does not guess unknown connector standards',()=>{
    const a=ocmRow(),b=ocmRow();b.OperatorID=3323;b.Connections[0].ConnectionTypeID=999;
    const normalize=(r:unknown)=>normalizeOcm([r],ocmRef,'2026-11-11T00:00:00Z',Buffer.from('stable')).records[0];
    expect(normalize(a).partyId).toBe(normalize(b).partyId);expect(normalize(a).externalId).toBe(normalize(b).externalId);
    expect(normalize(b).connectorClaims[0].standard).toBe('other');
  });
  it('accepts the source Unknown=0 reference entry and treats a zero quantity as unknown',()=>{
    const row=ocmRow();row.Connections[0].ConnectionTypeID=0;row.Connections[0].Quantity=0;
    const reference={...ocmRef,ConnectionTypes:[...ocmRef.ConnectionTypes,{ID:0,Title:'Unknown'}]};
    const claim=normalizeOcm([row],reference,'2026-11-11T00:00:00Z',Buffer.from('zero')).records[0].connectorClaims[0];
    expect(claim.standard).toBe('other');expect(claim.quantity).toBeNull();
  });
  it('rejects empty or repeated IDs rather than allowing an empty replacement catalogue',()=>{
    expect(()=>normalizeOcm([],ocmRef,'2026-11-11T00:00:00Z',Buffer.from('empty'))).toThrow('Empty complete');
    expect(()=>normalizeOcm([ocmRow(),ocmRow()],ocmRef,'2026-11-11T00:00:00Z',Buffer.from('dup'))).toThrow('Duplicate');
  });
  it('requires a key and refuses a pagination loop or truncated page budget',async()=>{
    const context:CatalogueSourceContext={signal:new AbortController().signal,request:jest.fn(async input=>({
      bytes:Buffer.from(JSON.stringify(input.url.includes('referencedata')?ocmRef:[ocmRow()])),retrievedAt:'2026-11-11T00:00:00Z'}))};
    await expect(new OcmCatalogueSource(undefined).collect('TR',context)).rejects.toThrow('API_KEY');
    expect(context.request).not.toHaveBeenCalled();
    await expect(new OcmCatalogueSource('test',1,1).collect('TR',context)).rejects.toThrow('page budget');
    await expect(new OcmCatalogueSource('test',1,2).collect('TR',context)).rejects.toThrow('strict ID');
  });
  it('adds a third provider without changing ingestion and ranks eligible fields by configured priority/cost',()=>{
    const adapter=(key:string,fields:StationCatalogueSource['fields']):StationCatalogueSource=>({key,fields,countries:['TR'],
      liveAvailability:false,collect:jest.fn()});
    const registry=new StationSourceRegistry([adapter('paid',['connectorClaims']),adapter('cheap',['connectorClaims']),adapter('access-only',['access.membershipRequired'])],
      {version:'test',providers:{paid:{enabled:true,priority:10,costRank:9},cheap:{enabled:true,priority:10,costRank:0},'access-only':{enabled:false,priority:1,costRank:0}},fields:{}});
    expect(registry.planMissingFields('TR',['connectorClaims','access.membershipRequired'])).toEqual([
      {field:'connectorClaims',providers:['cheap','paid']},{field:'access.membershipRequired',providers:[]}]);
    expect(()=>registry.get('access-only','TR')).toThrow('disabled');
    expect(()=>registry.get('cheap','US')).toThrow('country');
  });
  it('merges explicitly matched fields by policy, retaining licence/provenance and atomic equipment counts',()=>{
    const primary=stationPackage().data.records[0],secondary=ocmPackage().data.records[0];
    const result=mergeStationEvidence([primary,secondary],{...DEFAULT_SOURCE_POLICY,fields:{connectorClaims:['open-charge-map']}});
    expect(result.connectorClaims).toHaveLength(1);expect(result.connectorClaims[0].quantity).toBe(4);
    expect(result.fieldEvidence?.connectorClaims.sourceId).toBe('open-charge-map');
    expect(result.licenseEvidence?.[0].attribution).toBe('Open Charge Map contributors');
  });
});
