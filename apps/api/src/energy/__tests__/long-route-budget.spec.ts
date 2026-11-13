import {EnergyConsumptionEngine} from '../energy-engine';
import {energyFixture} from './fixtures';
import {energyInputUsage} from '../energy-input-budget';
function longRoute(count=6000){
  const input=energyFixture(),template=input.route.segments[0],weather=input.weather[0],at=Date.parse(input.request.departureAt);
  input.route.segments=Array.from({length:count},(_,i)=>({...structuredClone(template),id:'long-'+i,startDistanceMeters:i*75,endDistanceMeters:(i+1)*75,
    distanceMeters:75,drivingDurationSeconds:4.5,expectedSpeedKph:60,
    geometry:[{latitude:39+i*75/111195,longitude:32},{latitude:39+(i+1)*75/111195,longitude:32}],
    elevationProfile:[{distanceFromStartMeters:0,elevationMeters:0},{distanceFromStartMeters:75,elevationMeters:0}],elevationGainMeters:0,elevationLossMeters:0}));
  input.route.distanceMeters=count*75;input.route.drivingDurationSeconds=count*4.5;
  input.weather=input.route.segments.map((s,i)=>({...structuredClone(weather),queryId:'wx-'+i,segmentId:s.id,
    location:{latitude:39+(i+.5)*75/111195,longitude:32},validAt:new Date(at+(i+.5)*4500).toISOString()}));
  return input;
}
describe('Long energy routes have independent coordinate and terrain budgets',()=>{
  it('accepts 20024 stored terrain points / 14968 unique knots across 5057 segments without changing the profile or result',async()=>{
    const input=longRoute(5057);
    input.route.segments.forEach((s,i)=>{s.elevationProfile=(i<204?[0,37.5,75]:[0,25,50,75]).map(d=>({distanceFromStartMeters:d,elevationMeters:0}));});
    const before=JSON.stringify(input.route),usage=energyInputUsage(input.route);
    expect(usage).toMatchObject({segments:5057,elevationPoints:20024,uniqueElevationPoints:14968});
    const result=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);
    expect(result.status).toBe('estimated');expect(result.segments).toHaveLength(5057);expect(JSON.stringify(input.route)).toBe(before);
    const force=1000*9.80665*.01+.5*.5*(60/3.6)**2;
    expect(result.netBatteryEnergyKwh).toBeCloseTo(force*5057*75/3600000,7);
  });
  it('does not deduplicate contradictory terrain heights just because their segment endpoints share a distance',async()=>{
    const input=longRoute(5057);input.route.segments.forEach((s,i)=>{
      s.elevationProfile=(i<204?[0,37.5,75]:[0,25,50,75]).map(d=>({distanceFromStartMeters:d,elevationMeters:i}));});
    expect(energyInputUsage(input.route).uniqueElevationPoints).toBe(20024);
    const result=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);
    expect(result.status).toBe('computation_limit');expect(result.reasons.some(r=>r.code==='ENERGY_INPUT_BUDGET')).toBe(true);
  });
  it('integrates 450 km / 6000 segments with 12000 coordinates and 12000 terrain samples without rejecting their sum',async()=>{
    const input=longRoute(),result=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);
    expect(result.reasons).toEqual([]);expect(result.status).toBe('estimated');expect(result.segments).toHaveLength(6000);
    const force=1000*9.80665*.01+.5*.5*(60/3.6)**2;
    expect(result.netBatteryEnergyKwh).toBeCloseTo(force*450000/3600000,7);
  });
  it('still rejects a route that independently exceeds its coordinate budget',async()=>{
    const input=longRoute(1);input.route.segments[0].geometry=Array.from({length:20001},(_,i)=>({latitude:39+i/20000*75/111195,longitude:32}));
    const result=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);
    expect(result.status).toBe('computation_limit');expect(result.reasons.some(r=>r.code==='ENERGY_INPUT_BUDGET')).toBe(true);
  });
  it('matches millisecond weather timestamps to fractional-millisecond road intervals without inventing forecasts',async()=>{
    const input=longRoute(2),at=Date.parse(input.request.departureAt);
    input.route.segments.forEach((s,i)=>{s.startDistanceMeters=i*.01;s.endDistanceMeters=(i+1)*.01;s.distanceMeters=.01;s.drivingDurationSeconds=.0006;
      s.elevationProfile=[{distanceFromStartMeters:0,elevationMeters:0},{distanceFromStartMeters:.01,elevationMeters:0}];
      input.weather[i].validAt=new Date(at+(i+.5)*.6).toISOString();});
    input.route.distanceMeters=.02;input.route.drivingDurationSeconds=.0012;
    const result=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);expect(result.status).toBe('estimated');expect(result.segments).toHaveLength(2);
    input.weather[1].validAt=new Date(at+1000).toISOString();const wrong=await new EnergyConsumptionEngine().evaluate(input,new AbortController().signal);
    expect(wrong.status).toBe('insufficient_data');
  });
});
