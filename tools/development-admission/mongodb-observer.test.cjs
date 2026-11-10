const test=require('node:test');
const assert=require('node:assert/strict');
const mongo=require('./mongodb-observer.cjs');
const {specification}=require('./mongodb-observer-schema.cjs');
const protocol=require('./external-observer-protocol.cjs');
test('Mongo port requires bounded no-retry options and fixes the namespace',()=>{
  let selected;
  const client={options:{retryWrites:false,retryReads:false,serverSelectionTimeoutMS:3000,socketTimeoutMS:3000},db:name=>{selected=name;return {collection:name=>name};}};
  assert.equal(mongo.mongoPort(client).collection('registry'),'registry');
  assert.equal(selected,'ai_os_development_observer');
  assert.throws(()=>mongo.mongoPort({...client,options:{...client.options,retryWrites:true}}));
  assert.throws(()=>mongo.mongoPort({...client,options:{...client.options,socketTimeoutMS:0}}));
});
test('bootstrap is disabled, creates no users, roles split registry/heartbeat/history',()=>{
  const s=specification('b'.repeat(64),new Date());
  assert.equal(s.apply,false);assert.equal(s.users_created,0);assert.equal(s.seeds.registry.enabled,false);
  assert.equal(s.seeds.heartbeats.heartbeat,null);assert.equal(s.seeds.reservations.last_attempt,null);
  assert.deepEqual(Object.keys(s.collections).sort(),['heartbeats','notices','receipts','registry','reservations']);
  for(const role of s.roles){
    assert.ok(role.privileges.every(p=>!p.actions.includes('remove')&&!p.actions.includes('dropCollection')));
    assert.deepEqual(role.privileges.find(p=>p.resource.collection==='registry').actions,['find']);
    for(const p of role.privileges.filter(p=>['notices','receipts'].includes(p.resource.collection)))assert.deepEqual(p.actions,['find','insert']);
  }
  assert.throws(()=>specification('invalid',new Date()));
});
test('disabled production cannot be bypassed by manual test input',async()=>{
  const store={collection:()=>({aggregate:()=>({next:async()=>({_id:protocol.MONITOR,scope:'production',enabled:false,
    binding_sha256:'b'.repeat(64),observe_since:new Date(0),observer_now:new Date(1000000)})})})};
  assert.equal((await mongo.ingest(store,{}, {allowManualTest:true})).action,'ingress-disabled');
  assert.equal((await mongo.observe(store,()=>assert.fail('send'),{allowManualTest:true})).action,'observer-disabled');
});
test('unavailable state neither creates replacement collections nor exposes errors',async()=>{
  const store={collection:()=>{throw Error('PRIVATE_MONGO_ERROR');}};
  const results=[await mongo.ingest(store,{}),await mongo.observe(store,()=>assert.fail('send'))];
  assert.equal(results[0].action,'heartbeat-refused');assert.equal(results[1].action,'observer-state-unavailable');
  assert.ok(!JSON.stringify(results).includes('PRIVATE'));
});
test('Mongo and historical PG adapter share the exact safe protocol',()=>{
  const old=require('./external-observer.cjs');assert.equal(old.packet,protocol.packet);
  assert.equal(old.boundedSend,protocol.boundedSend);
});
