const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const provision=require('./observer-provisioning.cjs');
const preflight=require('./build-observer-db-preflight.cjs');

test('provisioning is transactional, target-bound, passwordless and login-disabled',()=>{
  const sql=provision.build();
  assert.ok(sql.startsWith('BEGIN;')&&sql.endsWith('COMMIT;\n'));
  assert.ok(sql.includes("current_database() <> 'ai_os_development_observer'"));
  assert.equal((sql.match(/CREATE ROLE .* NOLOGIN /g)||[]).length,3);
  assert.ok(!/DROP\s|PASSWORD\s|\bLOGIN\s+PASSWORD|enabled\s*=\s*true/i.test(sql));
  assert.ok(sql.includes('Fresh empty observer schema required'));
});
test('readiness SQL is fixed to two scoped principals and read-only',()=>{
  for(const role of [provision.INGRESS,provision.WATCH]) {
    const sql=provision.readiness(role);
    assert.ok(sql.startsWith('SELECT '));assert.ok(sql.includes("current_user='"+role+"'"));
    assert.ok(!/\b(INSERT INTO|UPDATE\s+\w|DELETE FROM|CREATE\s+\w)\b/i.test(sql));
  }
  assert.throws(()=>provision.readiness('postgres'));
});
test('unbound preflight is manual, disabled and stops before all DB nodes',()=>{
  const defs=preflight.definitions;
  assert.equal(defs[0][4].disabled,true);
  assert.equal(defs[1][4].parameters.jsCode,preflight.GUARD);
  assert.ok(!preflight.build().includes('scheduleTrigger'));
  assert.ok(preflight.build().includes('UNBOUND'));
  assert.equal(defs.filter(d=>d[2]==='n8n-nodes-base.postgres').length,2);
  for(const d of defs.filter(d=>d[2]==='n8n-nodes-base.postgres'))assert.equal(d[4].retryOnFail,false);
});
test('permission assertion refuses missing, extra or false evidence',()=>{
  for(const id of ['assertIngress','assertWatch']) {
    const code=preflight.definitions.find(d=>d[0]===id)[4].parameters.jsCode;
    const expected=JSON.parse(code.match(/const expected=(\[.*?\]);/)[1]);
    const good=Object.fromEntries(expected.map(k=>[k,true]));
    const run=value=>vm.runInNewContext('(function(){'+code+'})()',{$input:{all:()=>[{json:value}]}});
    assert.equal(run(good)[0].json.scope_verified,true);
    const missing={...good};delete missing[expected[0]];
    for(const value of [missing,{...good,extra:true},{...good,[expected[0]]:false}])assert.throws(()=>run(value));
  }
});
