const test=require('node:test');
const assert=require('node:assert/strict');
const {validateRequest,normalizePages}=require('./metadata-gateway.cjs');
const {build,definitions}=require('./build-metadata-gateway.cjs');
const NOW=Date.parse('2026-11-09T10:00:00Z');
const request=()=>({query:{workflowId:'Kj0Bm4Q2XnRtKsn1',status:'error',startedAfter:'2026-11-09T09:00:00Z',startedBefore:'2026-11-09T10:00:00Z'},headers:{authorization:'PRIVATE-HEADER'}});
const query=()=>validateRequest(request(),NOW);
const row=(id='123')=>({id,workflowId:query().workflowId,status:'error',startedAt:'2026-11-09T09:30:00Z',data:{prompt:'PRIVATE-PAYLOAD'}});
test('only exact two producer IDs and three failure statuses accepted',()=>{
  for(const id of ['Kj0Bm4Q2XnRtKsn1','YfyZaVDeZspB8VgK']) for(const status of ['error','crashed','unknown']) {
    const r=request();r.query.workflowId=id;r.query.status=status;assert.equal(validateRequest(r,NOW).status,status);
  }
  for(const changes of [{workflowId:'ForeignWorkflow1'},{status:'success'},{includeData:'true'},{url:'https://evil.invalid'},{cursor:'forged'}]) {
    const r=request();Object.assign(r.query,changes);assert.throws(()=>validateRequest(r,NOW));
  }
});
test('rejects arrays, missing fields, body and malformed times before any reader',()=>{
  for(const mutate of [r=>r.query.status=['error'],r=>delete r.query.status,r=>r.body={command:'run'},r=>r.query.startedAfter='invalid',r=>r.query.startedAfter='2026-11-09T09:00:00']) {
    const r=request();mutate(r);assert.throws(()=>validateRequest(r,NOW));
  }
});
test('window bounded to24h and upper bound no more than30s old',()=>{
  for(const start of ['2026-11-08T09:59:59Z','2026-11-09T10:00:01Z']){const r=request();r.query.startedAfter=start;assert.throws(()=>validateRequest(r,NOW));}
  assert.throws(()=>validateRequest(request(),NOW+30001));assert.throws(()=>validateRequest(request(),NOW-1));
  const r=request();r.query.startedAfter='2026-11-08T10:00:00Z';assert.ok(validateRequest(r,NOW));
});
test('headers and prompts are not projected into response',()=>{
  const q=query();const out=normalizePages([{data:[row()],nextCursor:null}],q,NOW);
  assert.equal(out.count,1);assert.deepEqual(Object.keys(out.data[0]),['id','workflowId','status','startedAt']);
  assert.ok(!JSON.stringify([q,out]).includes('PRIVATE'));
});
test('terminal empty page is complete, missing terminal marker refuses',()=>{
  assert.equal(normalizePages([{data:[],nextCursor:null}],query(),NOW).count,0);
  for(const pages of [[],[{data:[]}],[{data:[],nextCursor:'more'}],[{data:[row()],nextCursor:'more'}]])assert.throws(()=>normalizePages(pages,query(),NOW));
});
test('all pages required, repeated cursor or premature terminal marker refuses',()=>{
  const pages=[{data:[row()],nextCursor:'second'},{data:[row('124')],nextCursor:null}];
  assert.equal(normalizePages(pages,query(),NOW).count,2);
  assert.throws(()=>normalizePages([{data:[row()],nextCursor:'same'},{data:[row('124')],nextCursor:'same'}],query(),NOW));
  assert.throws(()=>normalizePages([{data:[row()],nextCursor:null},{data:[row('124')],nextCursor:null}],query(),NOW));
});
test('invalid status, target, duplicate IDs, clock and out-of-window rows refuse',()=>{
  for(const changes of [{status:'success'},{workflowId:'ForeignWorkflow1'},{startedAt:null},{startedAt:'2026-11-09T09:30:00'},{startedAt:'2026-11-09T08:59:59Z'},{id:'../../bad'}]) {
    assert.throws(()=>normalizePages([{data:[{...row(),...changes}],nextCursor:null}],query(),NOW));
  }
  assert.throws(()=>normalizePages([{data:[row(),row()],nextCursor:null}],query(),NOW));
  for(const now of [NaN,NOW-1,NOW+30001])assert.throws(()=>normalizePages([{data:[],nextCursor:null}],query(),now));
});
test('limits refuse oversized pages and20th nonterminal page',()=>{
  assert.throws(()=>normalizePages([{data:Array.from({length:101},(_,i)=>row(String(i+1))),nextCursor:null}],query(),NOW));
  const pages=Array.from({length:20},(_,i)=>({data:[row(String(i+1))],nextCursor:'cursor'+i}));
  assert.throws(()=>normalizePages(pages,query(),NOW));pages[19].nextCursor=null;assert.equal(normalizePages(pages,query(),NOW).count,20);
  pages.push({data:[],nextCursor:null});assert.throws(()=>normalizePages(pages,query(),NOW));
});
test('compiled graph has authenticated GET, fixed host and native credential reference',()=>{
  const entry=definitions.find(x=>x[0]==='entry')[4],read=definitions.find(x=>x[0]==='read')[4];
  assert.equal(entry.parameters.authentication,'headerAuth');assert.equal(entry.parameters.httpMethod,'GET');
  assert.equal(entry.disabled,true);assert.ok(build().includes('Dedicated Header Auth setup incomplete'));
  assert.equal(read.parameters.method,'GET');assert.equal(read.parameters.url,'https://n8n.smartsoft.biz.pl/api/v1/executions');
  assert.equal(read.parameters.queryParameters.parameters.find(p=>p.name==='includeData').value,'false');
  assert.equal(read.retryOnFail,false);assert.equal(read.parameters.options.redirect.redirect.followRedirects,false);
  assert.equal(read.parameters.options.pagination.pagination.maxRequests,20);assert.equal(read.parameters.options.timeout,10000);
  assert.equal(read.credentials.n8nApi.name,'n8n internal');
  assert.ok(!build().includes('scheduleTrigger'));assert.ok(build().includes('newCredential("Development Producer Metadata Gateway")'));
});
