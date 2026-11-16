import {energyFixture} from '../../energy/__tests__/fixtures';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {weatherForecastSchema} from '@chargeroad/shared';
import {meters} from '../../roads/geometry';
describe('Independent energy boundary for v2 weather offsets',()=>{
 const evaluate=async(version:'range-adaptive/1.0.0'|'range-adaptive/2.0.0',elevation:number)=>{
  const f=energyFixture(),w=f.weather[0],sample={latitude:w.location.latitude+.01,longitude:w.location.longitude};
  f.route.segments[0].roadClass='motorway';f.route.segments[0].startsAtChargingAccess=false;f.route.segments[0].endsAtChargingAccess=false;
  const start=f.request.departureAt,end=new Date(Date.parse(start)+3600000).toISOString();
  f.weather[0]=weatherForecastSchema.parse({...w,metadata:{sampledLocation:sample,sampledElevationMeters:elevation,sampleDistanceMeters:meters(w.location,sample),
   samplingResolution:version==='range-adaptive/1.0.0'?{policyVersion:version,phase:'near_term',intervalMeters:15000}:
    {policyVersion:version,phase:'near_term',intervalMeters:35000,maxSampleDistanceMeters:17500,risk:'homogeneous'},
   coverageStart:start,coverageEnd:end,lastValidatedAt:start,intervalStart:start,intervalEnd:end,timeStepSeconds:3600,method:'linear_temperature_vector_wind',pressureKind:'unknown',precipitationPeriod:null,
   warnings:[],license:'test-only',attribution:'synthetic'}});
  return new EnergyConsumptionEngine().evaluate(f,new AbortController().signal);
 };
 it('rejects a distant mountain representation even if its numeric offset is within v2 bound',async()=>{
  const r=await evaluate('range-adaptive/2.0.0',800);expect(r.status).toBe('insufficient_data');expect(r.reasons.map(v=>v.code)).toContain('WEATHER_ADAPTIVE_TERRAIN_UNVERIFIED');
 });
 it('allows a bounded same-elevation v2 sample',async()=>{expect((await evaluate('range-adaptive/2.0.0',0)).status).toBe('estimated');});
 it('leaves the legacy terrain behavior unchanged',async()=>{expect((await evaluate('range-adaptive/1.0.0',800)).status).toBe('estimated');});
});
