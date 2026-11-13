import {RoadAdapterRegistry,RoadRoutingService} from '../road-service';
import {config,roadRequest,trip} from './fixtures';
import {DatabaseService} from '../../database/database.service';
function world(){const source=trip(),provider={id:config.providerId,capabilities:{alternatives:true,via:true,traffic:'none' as const,freeMapReuse:true},route:jest.fn().mockResolvedValue([source]),attributes:jest.fn()};
  const client={post:jest.fn()},attributes={getWays:jest.fn()},service=new RoadRoutingService({...config,maxSegments:1},new RoadAdapterRegistry([provider]),client,attributes,{} as DatabaseService);
  return {source,provider,client,attributes,service,request:roadRequest()};}
describe('Road-only preview is independent of energy segmentation',()=>{
  it('uses authoritative leg distance/time even when a long route exceeds the energy segment budget',async()=>{
    const w=world();w.source.legs[0].distanceMeters=450000;w.source.legs[0].seconds=18000;
    const result=await w.service.preview(w.request,new AbortController().signal);expect(result.route?.distanceMeters).toBe(450000);expect(result.route?.drivingDurationSeconds).toBe(18000);
    expect(w.provider.attributes).not.toHaveBeenCalled();expect(w.attributes.getWays).not.toHaveBeenCalled();expect(w.client.post).not.toHaveBeenCalled();
  });
  it('reports moderate city-centre snapping explicitly and refuses a distant road match',async()=>{
    const w=world();w.request.origin={...w.request.origin,latitude:w.request.origin.latitude+.003};
    const result=await w.service.preview(w.request,new AbortController().signal);expect(result.route!.originSnapMeters).toBeGreaterThan(100);expect(result.route!.warnings).toContain('road_preview_endpoint_snapped');
    w.request.origin.latitude+=.03;await expect(w.service.preview(w.request,new AbortController().signal)).rejects.toMatchObject({status:422});
  });
  it('retains toll/ferry restrictions and attribution requirements',async()=>{
    const w=world();w.request.avoidFerries=true;w.source.hasFerry=null;
    await expect(w.service.preview(w.request,new AbortController().signal)).rejects.toMatchObject({status:422});
    w.source.hasFerry=false;w.source.license='';await expect(w.service.preview(w.request,new AbortController().signal)).rejects.toThrow('attribution');
  });
});
