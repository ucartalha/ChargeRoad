import {planningEvaluationSchema} from '@chargeroad/shared';
import {ChargeStopOptimizer} from '../charge-stop-optimizer';
import {PlanningSession} from '../planning-session';
import {EnergyConsumptionEngine} from '../../energy/energy-engine';
import {ChargingCurveEngine} from '../../charging/charging-engine';
import {chargeTargetCandidates,seedChargeTargets,improveFixedStopTargets} from '../charge-target-search';
import {compareStates} from '../charge-stop-optimizer';
import {analyticalStopReference} from '../validation/optimizer-reference';
import type {PlanningContext,OptimizerState} from '../optimizer-types';
import {optimizerWorld} from './optimizer.fixtures';
import {STOP_PENALTY_POLICY} from '../optimizer-policy';
// Optimizer 1.9.0: this case checks that charge targets are improved before broad search, not the stop penalty or near-tie rule (covered by optimizer-1-9.spec.ts); these cases run without them.
const withoutStopPenalty=["improves a partial-charge seed","keeps all three objectives equal to the independent exhaustive"];const savedPenalty={...STOP_PENALTY_POLICY};
beforeEach(()=>{if(withoutStopPenalty.some(n=>expect.getState().currentTestName?.includes(n)))Object.assign(STOP_PENALTY_POLICY,{secondsPerStop:0,tieSeconds:0});});
afterEach(()=>{Object.assign(STOP_PENALTY_POLICY,savedPenalty);});


function setup(){
  const w=optimizerWorld(),context:PlanningContext={request:w.request,vehicle:w.vehicle,evaluatedAt:w.now,options:w.options,candidates:w.candidates,
    nodes:Object.entries(w.locations).map(([id,location])=>({id,location,stationId:['origin','destination'].includes(id)?null:id})),baseRoutes:[w.route('origin','destination')]};
  const port=new PlanningSession(context,w.roads as never,w.weather as never,new EnergyConsumptionEngine(),new ChargingCurveEngine(),
    w.preparation.road,performance.now()+20000,context.baseRoutes);
  return {w,context,port};
}

describe('Charge targets before broad search exhausts the data budget',()=>{
  it.each(['verified_hardware','catalogue_power_scenario'] as const)('improves a partial-charge seed before a state-limited search: %s',async quality=>{
    const {w,context,port}=setup();w.request.policy.stationDataQuality=quality;w.options.maxStates=2;
    const result=await new ChargeStopOptimizer().solve(context,port,new AbortController().signal);
    expect(result.result.status).toBe('planned');if(result.result.status!=='planned')throw Error('Expected incumbent');
    const plan=result.result.plan,reference=analyticalStopReference('minimum_total_duration');
    expect(plan.chargingStops).toHaveLength(2);expect(plan.chargingStops.every(s=>s.targetChargePercent<=80)).toBe(true);
    expect(plan.estimatedArrivalChargePercent).toBeGreaterThanOrEqual(w.request.constraints.targetArrivalChargePercent);
    expect(plan.estimatedArrivalChargePercent).toBeLessThan(20.2);
    expect(plan.scenario!.totalSeconds-reference.answer!.seconds).toBeLessThan(.3);
    expect(plan.search?.stoppedReason).toBe('state_budget');expect(plan.search?.searchComplete).toBe(false);
    expect(()=>planningEvaluationSchema.parse({input:result.validationInput,result:result.result})).not.toThrow();
  });
  it('retains a necessary >80% charge in fewer-stops mode and trims excess final SOC',async()=>{
    const {w,context,port}=setup();w.request.policy.objective='minimum_charging_stops';w.options.maxStates=2;
    const result=await new ChargeStopOptimizer().solve(context,port,new AbortController().signal);
    expect(result.result.status).toBe('planned');if(result.result.status!=='planned')return;
    expect(result.result.plan.chargingStops).toHaveLength(1);
    expect(result.result.plan.chargingStops[0].targetChargePercent).toBeGreaterThan(80);
    expect(result.result.plan.estimatedArrivalChargePercent).toBeLessThan(20.2);
  });
  it('also permits >80% in fastest mode when the next reachable charger does not exist',async()=>{
    const {w,context,port}=setup();w.candidates.candidates=w.candidates.candidates.filter(c=>c.station.id==='a');
    context.nodes=context.nodes.filter(n=>n.id!=='b');w.options.maxStates=1;
    const result=await new ChargeStopOptimizer().solve(context,port,new AbortController().signal);
    expect(result.result.status).toBe('planned');if(result.result.status!=='planned')return;
    expect(result.result.plan.chargingStops).toHaveLength(1);
    expect(result.result.plan.chargingStops[0].targetChargePercent).toBeGreaterThan(80);
    expect(result.result.plan.estimatedArrivalChargePercent).toBeGreaterThanOrEqual(20);
    expect(result.result.plan.estimatedArrivalChargePercent).toBeLessThan(20.2);
  });
  it('prioritizes exact reachability anchors and knees but retains every uniform-grid candidate',()=>{
    const {context}=setup();const targets=chargeTargetCandidates(context,30,[54.37,95.1]);
    expect(targets[0]).toBe(54.37);expect(targets).toContain(95.1);expect(targets).toContain(100);
    for(let n=40;n<=100;n+=10)expect(targets).toContain(n);
    expect(new Set(targets).size).toBe(targets.length);
    expect(seedChargeTargets(context,10)).toEqual([80,100]);context.request.policy.objective='minimum_charging_stops';
    expect(seedChargeTargets(context,10)).toEqual([100,80]);
  });
  it('rechecks later arrival times and engine inputs without mutating a validated incumbent',async()=>{
    const {w,context,port}=setup();w.request.policy.objective='minimum_charging_stops';w.options.maxStates=2;
    const initial=await new ChargeStopOptimizer().solve(context,port,new AbortController().signal);
    const base=(initial.replay as {state:OptimizerState}).state,snapshot=JSON.stringify(base),calls=w.weather.forecast.mock.calls.length;
    const drive=jest.spyOn(port,'drive');
    const seen:OptimizerState[]=[],compare=(a:OptimizerState,b:OptimizerState)=>compareStates(a,b,'minimum_total_duration');
    await improveFixedStopTargets(context,base,port,new AbortController().signal,compare,async()=>{},s=>{seen.push(s);return true;},()=>0);
    expect(JSON.stringify(base)).toBe(snapshot);expect(drive).toHaveBeenCalled();expect(w.weather.forecast.mock.calls.length).toBeGreaterThanOrEqual(calls);
    for(const candidate of seen){expect(candidate.soc).toBeGreaterThanOrEqual(w.request.constraints.targetArrivalChargePercent);
      expect(candidate.legs.every(l=>l.energy.status==='estimated')).toBe(true);}
  });
  it('does not replace an incumbent when the candidate fails final validation, and propagates cancellation',async()=>{
    const {w,context,port}=setup();w.options.maxStates=2;
    const result=await new ChargeStopOptimizer().solve(context,port,new AbortController().signal),base=(result.replay as {state:OptimizerState}).state;
    const compare=(a:OptimizerState,b:OptimizerState)=>compareStates(a,b,'minimum_total_duration');
    expect(await improveFixedStopTargets(context,base,port,new AbortController().signal,compare,async()=>{},()=>false,()=>0)).toBe(base);
    const cancel=new AbortController();cancel.abort(new Error('cancelled target refinement'));
    await expect(improveFixedStopTargets(context,base,port,cancel.signal,compare,async()=>{},()=>true,()=>0)).rejects.toBe(cancel.signal.reason);
  });
  it('keeps all three objectives equal to the independent exhaustive small-graph answer',async()=>{
    for(const objective of ['minimum_total_duration','minimum_charging_stops','minimum_energy'] as const){
      const {context,port}=setup();context.request.policy.objective=objective;
      const result=await new ChargeStopOptimizer().solve(context,port,new AbortController().signal),reference=analyticalStopReference(objective);
      expect(result.result.status).toBe('planned');if(result.result.status!=='planned')continue;
      expect(result.result.plan.scenario!.totalSeconds).toBeCloseTo(reference.answer!.seconds,2);
      expect(result.result.plan.search!.drivingNetBatteryKwh).toBeCloseTo(reference.answer!.netKwh,8);
      expect(result.result.plan.chargingStops).toHaveLength(reference.answer!.stops.length);
    }
  });
});
