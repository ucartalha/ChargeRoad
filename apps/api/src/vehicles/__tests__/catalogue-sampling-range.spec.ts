import {DbVehicleEnergyProvider} from '../knowledge/db-vehicle-energy.provider';
describe('Catalogue range is a licensed sampling hint, not a battery-reachability certificate',()=>{
 function provider(detail:unknown){const p=new DbVehicleEnergyProvider({} as never);jest.spyOn(p as any,'read').mockResolvedValue({rows:detail?[{detail}]:[]});return p;}
 const source={key:'synthetic',vehicleId:'fixture',version:'1',homepageUrl:'https://example.invalid',license:'TEST-ONLY',
  fetchedAt:'2026-11-16T09:00:00Z',generatedAt:'2026-11-16T08:00:00Z'};
 it('selects the configured cycle order and preserves the source snapshot',async()=>{
  const p=provider({source,rangeRatings:[{kind:'rated',profile:'epa',rangeKm:350},{kind:'rated',profile:'wltp',rangeKm:400},{kind:'real_world',profile:'highway',rangeKm:290}]});
  expect(await p.catalogueRange('11111111-1111-4111-8111-111111111111',new AbortController().signal)).toMatchObject({rangeKm:400,cycle:'wltp',source:{sourceId:'synthetic',version:'1',license:'TEST-ONLY'}});
 });
 it('returns no rating when the catalogue is absent or not licensed',async()=>{
  expect(await provider(null).catalogueRange('id',new AbortController().signal)).toBeNull();
  expect(await provider({source:{...source,license:null},rangeRatings:[{kind:'rated',profile:'wltp',rangeKm:400}]}).catalogueRange('id',new AbortController().signal)).toBeNull();
 });
 it('ignores malformed and real-world ratings instead of relabelling them as catalogue cycles',async()=>{
  expect(await provider({source,rangeRatings:[{kind:'rated',rangeKm:400},{kind:'rated',profile:'wltp',rangeKm:-1},{kind:'real_world',profile:'highway',rangeKm:400}]}).catalogueRange('id',new AbortController().signal)).toBeNull();
 });
});
