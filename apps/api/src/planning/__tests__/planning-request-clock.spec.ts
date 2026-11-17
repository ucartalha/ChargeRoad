import {validatePlanningRequest} from '../http/planning-request';
import {PLANNING_HTTP_POLICY} from '../http/planning-http-policy';

// Phones are usually NTP-synced; servers/dev machines can lag slightly. A small, bounded skew must not reject a "now" observation.
const NOW=Date.parse('2026-11-17T12:00:00Z');
function body(observedOffsetMs:number){
  return {schemaVersion:'1.0.0',requestId:'7b1f4c9e-2a7d-4e55-9a51-0c3f2b8d6e10',origin:{latitude:41.0082,longitude:28.9784},destination:{latitude:39.9334,longitude:32.8597},
    vehicleVariantId:'a82a3933-a3fe-41f8-b830-b4b1a747a5ba',departureMode:'now',departureAt:new Date(NOW+60000).toISOString(),startingChargePercent:95,
    startingChargeObservedAt:new Date(NOW+observedOffsetMs).toISOString(),constraints:{minimumReserveChargePercent:10,targetArrivalChargePercent:20},
    vehicleDataQuality:'allow_engineering_estimates',stationDataQuality:'catalogue_power_scenario'};
}
const code=(fn:()=>unknown)=>{try{fn();return 'accepted';}catch(error){return (error as {getStatus?:()=>number}).getStatus?.()??'thrown';}};

describe('Planning request clock-skew tolerance',()=>{
  beforeEach(()=>jest.useFakeTimers({now:NOW,doNotFake:['nextTick','queueMicrotask','setImmediate','setTimeout','setInterval','clearTimeout','clearInterval','clearImmediate','performance','hrtime']}));
  afterEach(()=>jest.useRealTimers());
  it('uses a small bounded tolerance',()=>{
    expect(PLANNING_HTTP_POLICY.clockSkewToleranceMs).toBe(10000);
  });
  it.each([0,-60000,250,9999,10000])('accepts a starting SOC observation %i ms from server time',offset=>{
    expect(code(()=>validatePlanningRequest(body(offset)))).toBe('accepted');
  });
  it.each([10001,20000,600000])('rejects a starting SOC observation %i ms in the future',offset=>{
    expect(code(()=>validatePlanningRequest(body(offset)))).toBe(400);
  });
  it('applies the same bound to user-entered observations and never relabels them',()=>{
    const within={...body(0),initialBatteryTemperatureC:{origin:'user_input',value:20,observedAt:new Date(NOW+5000).toISOString()}};
    const beyond={...body(0),initialBatteryTemperatureC:{origin:'user_input',value:20,observedAt:new Date(NOW+15000).toISOString()}};
    const parsed=validatePlanningRequest(within);
    expect(parsed.startingChargeObservedAt).toBe(new Date(NOW).toISOString());
    expect(parsed.initialBatteryTemperatureC).toEqual(within.initialBatteryTemperatureC);
    expect(code(()=>validatePlanningRequest(beyond))).toBe(400);
  });
});
