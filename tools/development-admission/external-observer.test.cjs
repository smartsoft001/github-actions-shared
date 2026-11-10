const test=require('node:test');
const assert=require('node:assert/strict');
const {packet,ingest,observe,postgresPort,boundedSend}=require('./external-observer.cjs');
const binding='b'.repeat(64),now=1000;
const fixture=()=>({schema_version:1,monitor_id:'development-producers',binding_sha256:binding,
  sequence:1,cycle_id:'a'.repeat(32),cycle_finished_at:999,sent_at:1000,
  monitor:'alive',delivery:'idle-unverified',issues:[]});

test('only bounded exact metadata envelope admitted',()=>{
  assert.deepEqual(packet(fixture(),now,binding),fixture());
  for(const change of [{url:'https://foreign.invalid'},{token:'PRIVATE'},{monitor_id:'other'},
    {binding_sha256:'a'.repeat(64)},{sequence:0},{sequence:Number.MAX_SAFE_INTEGER+1},
    {cycle_id:'../bad'},{issues:['PRIVATE_ERROR']},{issues:['cycle-failed'],monitor:'alive'},
    {monitor:'unknown'},{issues:['clock-invalid']},{delivery:'phone-delivered'}]) {
    assert.throws(()=>packet({...fixture(),...change},now,binding));
  }
});
test('old sender, stale completion, future or inverted clocks refuse',()=>{
  for(const change of [{sent_at:1006},{sent_at:969,cycle_finished_at:968},
    {cycle_finished_at:819},{cycle_finished_at:1001},{sent_at:NaN}])assert.throws(()=>packet({...fixture(),...change},now,binding));
});
test('failed source is an enum and cannot carry raw details',()=>{
  const p=packet({...fixture(),monitor:'unknown',issues:['cycle-failed'],delivery:'pending'},now,binding);
  assert.equal(p.monitor,'unknown');assert.deepEqual(p.issues,['cycle-failed']);
  assert.throws(()=>packet({...p,issues:['cycle-failed','cycle-failed']},now,binding));
});
test('disabled production cannot be bypassed by manual override',async()=>{
  const client={query:async()=>({rows:[{scope:'production',enabled:false,ingress_verified:false,
    external_host_verified:false,fallback_verified:false,observer_now:now,observe_since:new Date(999000)}]})};
  const db={transaction:fn=>fn(client)};let sends=0;
  assert.equal((await ingest(db,fixture(),{allowManualTest:true})).action,'ingress-disabled');
  assert.equal((await observe(db,()=>sends++,{allowManualTest:true})).action,'observer-disabled');
  assert.equal(sends,0);
});
test('state errors expose no remote body and cannot send',async()=>{
  const db={transaction:async()=>{throw Error('PRIVATE_DATABASE_ERROR');}};
  const a=await ingest(db,fixture()),b=await observe(db,()=>assert.fail('unexpected send'));
  assert.equal(a.action,'heartbeat-refused');assert.equal(b.action,'observer-state-unavailable');
  assert.ok(!JSON.stringify([a,b]).includes('PRIVATE'));
});
test('sender deadline aborts once, including a non-resolving transport',async()=>{
  let calls=0,signal;
  await assert.rejects(boundedSend((_p,options)=>{calls++;signal=options.signal;return new Promise(()=>{});},{},5));
  assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('injected postgres transaction commits, rolls back and releases',async()=>{
  const sql=[];let released=0;
  const client={query:async text=>{sql.push(text);return {rows:[]};},release:()=>released++};
  const db=postgresPort({connect:async()=>client});
  assert.equal(await db.transaction(async()=>123),123);
  await assert.rejects(db.transaction(async()=>{throw Error('fixture failure');}));
  assert.equal(sql.filter(x=>x==='BEGIN').length,2);
  assert.equal(sql.filter(x=>x==='COMMIT').length,1);
  assert.equal(sql.filter(x=>x==='ROLLBACK').length,1);assert.equal(released,2);
  assert.ok(sql.includes("SET LOCAL statement_timeout='3s'"));
});
test('Python read-only exporter and JS receiver share the same protocol',()=>{
  const {execFileSync}=require('node:child_process');
  const demo=JSON.parse(execFileSync('python3',[require('node:path').join(__dirname,'heartbeat-offline.py')],
    {encoding:'utf8',timeout:10000}));
  assert.equal(demo.synthetic,true);assert.equal(demo.real_provider_calls,0);
  const normalized=packet(demo.packet,Date.now()/1000,demo.packet.binding_sha256);
  assert.equal(normalized.monitor,'alive');assert.equal(normalized.sequence,1);
});
