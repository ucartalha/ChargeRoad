import {weatherForecastSchema} from '@chargeroad/shared';
import {MetNorwayAdapter} from '../met-norway.adapter';
import {normalizeWeather,weatherForecastFastCheck} from '../weather-normalize';
import {config,document,query,instant} from './fixtures';

// Copy-free forecast check (2026-11-20): normalizeWeather re-validated each internally built forecast with a full Zod parse
// (1.6 GB of 6.5 GB Zod allocations in 5 long plans, a full copy each). The fast check accepts only what the schema accepts;
// anything it cannot confirm goes through the same Zod parse as before, which throws the same errors.
const now=Date.parse(instant);
function forecasts(){
  const series=new MetNorwayAdapter(config).parse(document());
  const resolution={policyVersion:'range-adaptive/1.0.0' as const,phase:'future' as const,intervalMeters:35000};
  return [query(),query('q2','2026-11-11T15:00:00Z'),query('q3','2026-11-11T15:20:00Z'),{...query('q4','2026-11-11T16:00:00Z'),samplingResolution:resolution}]
    .map(q=>normalizeWeather(series,q as never,config.providerId,now));
}
const set=(value:unknown,path:string[],next:unknown)=>{const copy=structuredClone(value) as Record<string,unknown>;let at=copy;
  for(const key of path.slice(0,-1))at=at[key] as Record<string,unknown>;if(next===undefined)delete at[path.at(-1)!];else at[path.at(-1)!]=next;return copy;};
describe('Weather forecast fast check',()=>{
  it('accepts real forecasts and returns exactly what the Zod parse returns (same JSON, same key order)',()=>{
    for(const f of forecasts()){expect(weatherForecastFastCheck(f)).toBe(true);
      expect(JSON.stringify(f)).toBe(JSON.stringify(weatherForecastSchema.parse(f)));}
  });
  it('never accepts what the schema rejects',()=>{
    const bad:[string[],unknown][]=[[['queryId'],''],[['queryId'],'x'.repeat(201)],[['validAt'],'2026-11-11 15:00'],[['validAt'],'2026-13-01T00:00:00Z'],
      [['temperatureCelsius'],Number.NaN],[['temperatureCelsius'],Infinity],[['windSpeedKph'],-1],[['windFromDegrees'],360],[['precipitationProbabilityPercent'],101],
      [['airPressureHpa'],0],[['snowDepthCm'],-0.1],[['status'],'fine'],[['fetchedAt'],undefined],[['source','url'],'not a url'],[['source','license'],''],
      [['location','latitude'],91],[['location','extra'],1],[['extra'],true],[['metadata','method'],'cubic'],[['metadata','warnings'],[1]],
      [['metadata','timeStepSeconds'],-5],[['metadata','sampledLocation','longitude'],181],[['metadata','precipitationPeriod','totalMm'],-1],
      [['metadata','samplingResolution','intervalMeters'],0],[['source','retrievedAt'],'yesterday'],[['segmentId'],null]];
    for(const f of forecasts())for(const [path,value] of bad){
      if(path[1]==='precipitationPeriod'&&!f.metadata?.precipitationPeriod)continue;
      if(path[1]==='samplingResolution'&&!f.metadata?.samplingResolution)continue;
      const mutated=set(f,path,value);
      expect(weatherForecastSchema.safeParse(mutated).success).toBe(false);
      expect([path.join('.'),weatherForecastFastCheck(mutated)]).toEqual([path.join('.'),false]);
    }
  });
});
