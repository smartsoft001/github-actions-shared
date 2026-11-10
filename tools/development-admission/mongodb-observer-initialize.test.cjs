const test=require('node:test');
const assert=require('node:assert/strict');
const {plan,prepare,initialize}=require('./mongodb-observer-initialize.cjs');
const proposal=()=>plan('b'.repeat(64),new Date('2026-11-10T00:00:00Z'));
test('initialization has no DB access before explicit authorization',async()=>{
  const db=new Proxy({},{get:()=>assert.fail('DB accessed')});
  assert.deepEqual(await initialize(db,proposal()),{action:'initialization-not-authorized',write_attempted:false});
});
test('wrong database, existing empty collection and changed plan refuse before writes',async()=>{
  for(const db of [{databaseName:'claude'},{databaseName:'ai-os',listCollections:()=>({toArray:async()=>[{name:'registry'}]})}]){
    await assert.rejects(()=>prepare(db,{binding:'b'.repeat(64),baseline:new Date()}));
    const p=proposal();assert.equal((await initialize(db,p,{approved:true,planSha256:p.plan_sha256})).write_attempted,false);
  }
  const p=proposal();p.enabled=true;
  assert.equal((await initialize({},p,{approved:true,planSha256:p.plan_sha256})).write_attempted,false);
});
test('uncertain create leaves partial state for review without retry or destructive cleanup',async()=>{
  let calls=0;
  const db={databaseName:'ai-os',listCollections:()=>({toArray:async()=>[]}),createCollection:async()=>{calls++;throw Error('PRIVATE_DB_FAILURE');}};
  const p=proposal(),r=await initialize(db,p,{approved:true,planSha256:p.plan_sha256});
  assert.equal(r.action,'initialization-uncertain-manual-review');assert.equal(calls,1);
  assert.equal(r.cleanup_attempted,false);assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
