import {compareStateObservations,type StateObservation} from '../state-dominance';
const scope={};
function observation():StateObservation{return {scope,nodeId:'node',visited:['origin','a','node'],soc:15,at:'2026-11-15T09:01:00Z',temperature:['user_input',30,'2026-11-15T09:00:00Z',null,null,null,null],capacityToken:1,legsToken:2,stopsToken:3,netKwh:1,seconds:60,distance:1000};}
describe('State duplicate hints are never pruning permission',()=>{
 it('labels only equal captured values plus identical graph tokens as a candidate',()=>{
  const a=observation(),b={...a,visited:[...a.visited],temperature:[...a.temperature]},before=JSON.stringify([a,b]);
  expect(compareStateObservations(a,b)).toEqual({level:'exact_duplicate_candidate',mayPrune:false,proof:'shallow_observation_only'});expect(JSON.stringify([a,b])).toBe(before);
 });
 it.each(['node','visited_order','visited_set','time','temperature_value','temperature_origin','temperature_source','temperature_model','capacity','legs','stops','scope'] as const)('does not equate %s',kind=>{
  const a=observation();let b={...a};
  switch(kind){case 'node':b.nodeId='other';break;case 'visited_order':b.visited=['origin','node','a'];break;case 'visited_set':b.visited=['origin','b','node'];break;
   case 'time':b.at='2026-11-15T09:01:00.001Z';break;case 'temperature_value':b.temperature=['user_input',29];break;
   case 'temperature_origin':b.temperature=['estimated',30];break;case 'temperature_source':b.temperature=[...a.temperature,'different-source'];break;
   case 'temperature_model':b.temperature=['estimated',30,null,null,'2026-11-15T09:00Z',null,'different-model'];break;
   case 'capacity':b.capacityToken=4;break;case 'legs':b.legsToken=4;break;case 'stops':b.stopsToken=4;break;case 'scope':b.scope={};break;}
  expect(compareStateObservations(a,b).level).not.toBe('exact_duplicate_candidate');expect(compareStateObservations(a,b).mayPrune).toBe(false);
 });
 it.each(['soc','netKwh','seconds','distance'] as const)('does not bucket/round a tiny difference in %s',key=>{
  const a=observation(),b={...a,[key]:a[key]+1e-10};expect(compareStateObservations(a,b).level).not.toBe('exact_duplicate_candidate');
 });
 it('shows reserve/target feasibility can differ for almost identical SOC',()=>{
  const low={...observation(),soc:15-1e-10},high={...observation(),soc:15+1e-10};
  expect(low.soc>=15).toBe(false);expect(high.soc>=15).toBe(true);expect(compareStateObservations(low,high).mayPrune).toBe(false);
 });
 it('shows higher SOC can accept less regeneration: a numerical dominance hint is unsafe',()=>{
  const low={...observation(),soc:80},high={...observation(),soc:90},regen=(s:StateObservation)=>Math.min(.2,1-s.soc/100);
  expect(regen(low)).toBeGreaterThan(regen(high));expect(compareStateObservations(low,high).level).toBe('potential_dominance_only');expect(compareStateObservations(low,high).mayPrune).toBe(false);
 });
 it('cannot certify deep source contents or session side effects, even with equal tokens',()=>{
  const answer=compareStateObservations(observation(),observation());expect(answer.proof).toBe('shallow_observation_only');expect(answer.mayPrune).toBe(false);
 });
});
