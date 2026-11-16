const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {runIsolated}=require('./state-isolated-runner.cjs');
test('watchdog kills the child and waits for close before rejecting',async()=>{
 const start=performance.now();await assert.rejects(runIsolated('minimum_energy',{watchdogMs:100,childFile:path.join(__dirname,'state-runner-hang.fixture.cjs')}),/STATE_CHILD_WATCHDOG_KILLED/);
 assert.ok(performance.now()-start>=100);
});
test('nonzero child exit propagates as functional failure',async()=>{
 await assert.rejects(runIsolated('minimum_energy',{childFile:path.join(__dirname,'state-runner-failure.fixture.cjs')}),/STATE_CHILD_FAILURE\/7/);
});
