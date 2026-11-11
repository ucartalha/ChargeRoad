import { normalizeOcm } from '../sources/ocm-source';
export const ocmRef={ConnectionTypes:[{ID:33,Title:'CCS (Type 2)'}],UsageTypes:[{ID:4,Title:'Public - Membership Required',IsMembershipRequired:true}]};
export function ocmRow(ID=1){return {ID,DataProviderID:1,OperatorID:3712,AddressInfo:{Title:'Fixture OCM station',Latitude:39.904,Longitude:32.8,Country:{ISOCode:'TR'}},
  Connections:[{ID:ID*10,ConnectionTypeID:33,PowerKW:180,Quantity:4,CurrentTypeID:30}],StatusTypeID:50,UsageTypeID:4,
  DateLastStatusUpdate:'2026-01-01T00:00:00Z',NumberOfPoints:2,
  DataProvider:{ID:1,IsOpenDataLicensed:true,License:'Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0)'},
  MediaItems:[{secretTest:'excluded'}],UserComments:[{secretTest:'excluded'}]};}
export function ocmPackage(){const rows=[ocmRow()],bytes=Buffer.from(JSON.stringify(rows));return {bytes,data:normalizeOcm(rows,ocmRef,'2026-11-11T00:00:00Z',bytes)};}

