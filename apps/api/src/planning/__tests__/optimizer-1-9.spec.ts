import {STOP_PENALTY_POLICY,REACH_PREFILTER_POLICY,STOP_ELIMINATION_POLICY,reachPrefilterKm,eliminationTargets,OPTIMIZER_VERSION} from '../optimizer-policy';
import {compareStates} from '../charge-stop-optimizer';

// Optimizer 1.9.0 (2026-11-19, phone İstanbul→Erzurum: 9 stops, stops 1–2 only 61 km apart, a 9th stop that a slightly higher
// 8th charge would avoid; 79 % of the weather budget spent on legs that could never arrive).
const state=(seconds:number,stops:number,distance=1000,netKwh=10)=>({seconds,stops:Array.from({length:stops},()=>({})),distance,netKwh,visited:['origin']}) as never;
describe('P1 stop penalty (user: 6 min per stop, ranking only)',()=>{
  it('adds 6 minutes per stop when ranking shortest-time plans',()=>{
    expect(STOP_PENALTY_POLICY.secondsPerStop).toBe(360);
    // 2 stops in 1000 s ranks behind 1 stop in 1300 s (1720 vs 1660), but ahead of 1 stop in 1500 s (1720 vs 1860).
    expect(compareStates(state(1000,2),state(1300,1),'minimum_total_duration')).toBeGreaterThan(0);
    expect(compareStates(state(1000,2),state(1500,1),'minimum_total_duration')).toBeLessThan(0);
  });
  it('within one minute of penalized time the plan with fewer stops wins (user decision: near-ties)',()=>{
    expect(STOP_PENALTY_POLICY.tieSeconds).toBe(60);
    // Phone İstanbul→Erzurum: dropping the 9th stop costs +361 s of physical time, i.e. 1 s worse after the 6-min penalty.
    expect(compareStates(state(59941,8),state(59580,9),'minimum_total_duration')).toBeLessThan(0);
    expect(compareStates(state(59580,9),state(59941,8),'minimum_total_duration')).toBeGreaterThan(0);
    // Outside the tie window the penalized time decides as before.
    expect(compareStates(state(60100,8),state(59580,9),'minimum_total_duration')).toBeGreaterThan(0);
  });
  it('leaves the other objectives as they were',()=>{
    expect(compareStates(state(1000,2),state(1300,1),'minimum_charging_stops')).toBeGreaterThan(0);
    expect(compareStates(state(1000,2,1000,9),state(1300,1,1000,10),'minimum_energy')).toBeLessThan(0);
  });
});
describe('P4 reach prefilter',()=>{
  it('is generous: 2.5 × range share above reserve + 25 km, with a 150 km range floor',()=>{
    expect(REACH_PREFILTER_POLICY).toMatchObject({factor:2.5,minRangeKm:150,slackKm:25});
    expect(reachPrefilterKm(175,100,8)).toBeCloseTo(175*.92*2.5+25,6);
    expect(reachPrefilterKm(100,100,10)).toBeCloseTo(150*.9*2.5+25,6);
    expect(reachPrefilterKm(175,5,10)).toBe(25);expect(reachPrefilterKm(null,60,20)).toBeCloseTo(150*.4*2.5+25,6);
  });
});
describe('P3 stop elimination targets',()=>{
  it('charges the previous stop for both legs plus the required arrival, with rising margins, capped at 100',()=>{
    expect(STOP_ELIMINATION_POLICY.marginsPercent).toEqual([2,5,8]);
    // previous target 56, arrival at removed stop 8.6, removed stop target 35.1, arrival at destination 17, required 17.
    expect(eliminationTargets(56,8.6,35.1,17,17)).toEqual([84.5,87.5,90.5]);
    expect(eliminationTargets(80,30,80,20,10)).toEqual([100]);
  });
  it('optimizer version is 1.9.0',()=>expect(OPTIMIZER_VERSION).toBe('chargeroad-optimizer/1.9.0'));
});
