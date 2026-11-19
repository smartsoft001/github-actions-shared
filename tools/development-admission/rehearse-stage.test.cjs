const test=require('node:test'),assert=require('node:assert/strict');
const {run}=require('./rehearse-stage.cjs');
test('current reviewed manifest reaches staged pause, with recovery of six lost responses and no publication',()=>{
 const result=run();
 assert.equal(result.final_status,'staged-paused-awaiting-publication-approval');
 assert.equal(result.uncertain_response_replays_blocked,6);
 assert.equal(result.live_api_calls,0);
});
