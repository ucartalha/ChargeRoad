import {buildPlanningWeather,samplingRange,PLANNING_WEATHER_POLICY} from '../planning-weather-policy';
import {sampleRouteWeather} from '../weather-sampler';
import {windowRoute} from './window-route.fixture';
import {optimizerWorld} from '../../planning/__tests__/optimizer.fixtures';
import {weatherSampleDistanceLimit,planningEvaluationSchema} from '@chargeroad/shared';
import type {CatalogueRange} from '../planning-weather-policy';
import {source} from '../../planning/__tests__/fixtures';

const catalogue:CatalogueRange={rangeKm:400,cycle:'wltp',source:source('synthetic-catalogue')};
describe('Range-adaptive planning weather, not a physical range certificate',()=>{
  it.each([199,200,201,700,1000,1001,1200,2000])('covers a %i km route without a 64-sample wall',km=>{
    const input=windowRoute(km),w=optimizerWorld(),p=buildPlanningWeather(input.route,samplingRange(w.vehicle,catalogue)),sampling=sampleRouteWeather(input,p);
    expect(p.detailedHorizonMeters).toBe(Math.min(km*1000,km<=200?km*1000:340000));
    const near=p.anchors.filter(a=>a.distanceMeters<=p.detailedHorizonMeters).map(a=>a.distanceMeters);
    for(let i=1;i<near.length;i++)expect(near[i]-near[i-1]).toBeLessThanOrEqual(15000);
    const far=p.anchors.filter(a=>a.distanceMeters>=p.detailedHorizonMeters).map(a=>a.distanceMeters);
    if(km>1000){expect(far).toHaveLength(26);expect(p.futureStepMeters).toBeCloseTo((km*1000-p.detailedHorizonMeters)/25);}
    else for(let i=1;i<far.length;i++)expect(far[i]-far[i-1]).toBeLessThanOrEqual(25000);
    expect(sampling.queries).toHaveLength(km);expect(sampling.samples.length).toBeLessThanOrEqual(128);
    for(const q of sampling.queries){expect(q.samplingResolution).toBeDefined();expect(weatherSampleDistanceLimit(q.samplingResolution)).toBeGreaterThan(0);}
  });
  it('labels a licensed capacity/reference fallback and never scales the sampling horizon with user SOC',()=>{
    const w=optimizerWorld(),p=samplingRange(w.vehicle,null);expect(p.rangeBasis).toBe('capacity_consumption_estimate');expect(p.rangeKm).toBeCloseTo(2);
    w.request.startingChargePercent=5;expect(samplingRange(w.vehicle,null)).toEqual(p);
    w.vehicle.consumptionReferences=[];expect(samplingRange(w.vehicle,null)).toMatchObject({rangeKm:null,rangeBasis:'fixed_window_no_range_reference'});
  });
  it('uses globally pinned sample locations across overlapping legs and keeps every segment ETA',()=>{
    const input=windowRoute(1200),p=buildPlanningWeather(input.route,samplingRange(optimizerWorld().vehicle,catalogue)),first=sampleRouteWeather(input,p);
    const route=structuredClone(input.route),offset=500000;route.segments=route.segments.slice(500);
    route.segments.forEach(s=>{s.startDistanceMeters-=offset;s.endDistanceMeters-=offset;});route.distanceMeters-=offset;route.drivingDurationSeconds=route.segments.reduce((s,v)=>s+v.drivingDurationSeconds,0);
    const later=sampleRouteWeather({...input,route,departureAt:new Date(Date.parse(input.departureAt)+3600000).toISOString()},p,offset);
    expect(later.queries.every(q=>q.samplingResolution?.phase==='future')).toBe(true);
    expect(later.queries[0].sampleLocation).toEqual(first.queries[500].sampleLocation);
    expect(Date.parse(later.queries[1].validAt)-Date.parse(later.queries[0].validAt)).toBe(36000);
    expect(later.samples.length).toBeLessThanOrEqual(26);
  });
  it.each([700,1200])('finds a validated charge chain on a %i km synthetic scaled graph before broad search',async km=>{
    // Scaled distance graph with a correspondingly scaled reference rate; not real geography/car performance.
    const w=optimizerWorld(),factor=km/2,original=w.roads.routes.getMockImplementation()!;
    w.options.maxStates=2;w.vehicle.consumptionReferences.forEach(r=>r.valueKwhPer100Km/=factor);
    w.vehicle.physics.curbMassKg!/=factor;w.vehicle.physics.dragAreaSquareMeters!/=factor;
    for(const c of w.candidates.candidates){const at=km*(c.station.id==='a'?.25:.625),index=Math.floor(at);
      c.routeMatches=[{routeId:'origin-destination',segmentId:'origin-destination-'+index,segmentProgress:at-index,distanceMeters:0}];}
    w.roads.routes.mockImplementation(async request=>{const r=await original(request);for(const route of r.data.routes){
      const templates=route.segments,distance=route.distanceMeters*factor,count=Math.ceil(distance/1000),from=templates[0].geometry[0],to=templates.at(-1)!.geometry.at(-1)!;
      route.distanceMeters=distance;route.drivingDurationSeconds=distance/1000*60;
      route.segments=Array.from({length:count},(_,i)=>({...structuredClone(templates[0]),id:route.id+'-'+i,startDistanceMeters:distance*i/count,endDistanceMeters:distance*(i+1)/count,
        distanceMeters:distance/count,drivingDurationSeconds:distance/count/1000*60,
        geometry:[{latitude:from.latitude+(to.latitude-from.latitude)*i/count,longitude:from.longitude},{latitude:from.latitude+(to.latitude-from.latitude)*(i+1)/count,longitude:from.longitude}],
        elevationProfile:[{distanceFromStartMeters:0,elevationMeters:0},{distanceFromStartMeters:distance/count,elevationMeters:0}]}));
      route.metadata!.speedLimitKnownMeters=distance;
    }return r;});
    const r=await w.service.plan(w.request,w.preparation,w.options);
    if(r.result.status!=='planned')throw Error(JSON.stringify({status:r.result.status,reasons:r.result.reasons,search:r.search}));
    expect(r.result.status).toBe('planned');
    if(r.result.status==='planned'){expect(r.result.plan.chargingStops.length).toBeGreaterThan(0);expect(r.result.plan.warnings.some(v=>v.code==='coarse_future_weather_scenario')).toBe(true);
      expect(()=>planningEvaluationSchema.parse({input:r.validationInput,result:r.result})).not.toThrow();}
  },30000);
});
