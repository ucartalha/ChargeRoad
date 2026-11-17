import {WEATHER_POLICY} from '../weather-policy';

// MET Norway ToS (revised 2026-11-05): total application traffic must stay below 20 requests/second
// (all clients/instances together). Pacing is enforced through the shared PostgreSQL provider state,
// so minIntervalMs bounds the whole deployment, not one process.
const MET_TOTAL_REQUESTS_PER_SECOND=20;

describe('MET pacing policy',()=>{
  it('uses 100 ms spacing and four concurrent acquisitions',()=>{
    expect(WEATHER_POLICY.minIntervalMs).toBe(100);
    expect(WEATHER_POLICY.maxConcurrency).toBe(4);
  });
  it('keeps the shared request rate at or below half of the MET limit',()=>{
    expect(1000/WEATHER_POLICY.minIntervalMs).toBeLessThanOrEqual(MET_TOTAL_REQUESTS_PER_SECOND/2);
  });
  it('does not loosen quota, budget, lease or deadline guards',()=>{
    expect(WEATHER_POLICY).toMatchObject({dailyLimit:1000,maxExternalCalls:128,fetchTimeoutMs:5000,deadlineMs:30000,leaseSeconds:15,maxSamples:128});
  });
});
