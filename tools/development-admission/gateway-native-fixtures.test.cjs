'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {workflow,CASES}=require('./gateway-native-fixtures.cjs');
const {definitions}=require('./build-metadata-gateway.cjs');

test('local fixtures cannot inherit service credentials, trigger, or remote source',()=>{
  for(const scenario of CASES) {
    const w=workflow(scenario,12345);
    assert.equal(w.active,false);
    assert.ok(w.nodes.every(n=>!n.credentials));
    assert.ok(!w.nodes.some(n=>/webhook|schedule|executeWorkflow/.test(n.type)));
    assert.equal(w.nodes.find(n=>n.name==='Read bounded execution metadata').parameters.url,'http://127.0.0.1:12345/'+scenario);
  }
  assert.throws(()=>workflow('unknown',12345));
  assert.throws(()=>workflow('nonempty','https://example.com'));
});

test('integration fixture keeps reviewed pagination, error path and projection',()=>{
  const w=workflow('multipage',12345),read=w.nodes.find(n=>n.name==='Read bounded execution metadata');
  const original=definitions.find(d=>d[0]==='read')[4];
  assert.equal(read.typeVersion,4.5);
  assert.deepEqual(read.parameters.options.pagination,JSON.parse(JSON.stringify(original.parameters.options.pagination).replaceAll('EXPR:','=')));
  assert.equal(read.onError,'continueRegularOutput');assert.equal(read.retryOnFail,false);
  assert.equal(read.parameters.options.timeout,10000);
  assert.equal(w.nodes.find(n=>n.name==='Return complete safe metadata').parameters.jsCode,definitions.find(d=>d[0]==='project')[4].parameters.jsCode);
  assert.ok(definitions.find(d=>d[0]==='guard')[4].parameters.jsCode.startsWith('throw new Error('));
  assert.equal(original.parameters.url,'https://n8n.smartsoft.biz.pl/api/v1/executions');
  assert.equal(original.credentials.n8nApi.id,'a9ODOIqSIyJWUvRK');
});
