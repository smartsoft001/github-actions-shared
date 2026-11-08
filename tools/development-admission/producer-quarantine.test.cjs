const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {compile,baselines,fenced,snapshotFromMcp}=require('./producer-quarantine.cjs');
const registry=JSON.parse(fs.readFileSync(path.join(__dirname,'../../.github/actions/development-admission/ownership.json'),'utf8'));
const copy=x=>structuredClone(x);
const uuid=i=>`00000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`;
function issue(labels=['ordinary']) {return {id:uuid(100),identifier:'GAL-9999',title:'fixture',url:'https://linear.app/fixture',team:{id:uuid(200)},attachments:{nodes:[{title:'plan.md',url:'https://fixture.invalid/plan.md'}]},labels:{nodes:labels.map((name,i)=>({id:uuid(i+1),name})),pageInfo:{hasNextPage:false,endCursor:null}}};}
function input(issues) {return {data:{projects:{nodes:[{name:'fixture',externalLinks:{nodes:[{label:'Code',url:'https://github.com/smartsoft001/galena-tele'}]},issues:{nodes:issues}}]}}};}
function execute(w,payload,patched=true) {
 const code=patched?compile(copy(baselines)).changes.find(c=>c.workflowId===w.id).operations[1].value:w.nodes.find(n=>n.name==='Filter & Enrich').parameters.jsCode;
 return JSON.parse(JSON.stringify(vm.runInNewContext('(function(){'+code+'})()',{$input:{first:()=>({json:payload})}},{timeout:1000})));
}
function stripTime(rows) {for(const r of rows)for(const c of r.json.candidates||[])delete c.triggeredAt;return rows;}
for(const w of baselines) {
 test(`${w.id}: ordinary legacy candidates preserve existing output`,()=>{
  const i=issue(w.id===baselines[1].id?['AI Plan']:['ordinary']);
  assert.deepEqual(stripTime(execute(w,input([i]))),stripTime(execute(w,input([i]),false)));
 });
 test(`${w.id}: completed and paused ownership remains excluded without labels`,()=>{
  for(const r of registry.entries)for(const state of ['completed','paused']){
   const i={...issue(),id:r.issue_id,identifier:r.issue_key,state:{type:state}};delete i.labels;
   assert.equal(execute(w,input([i]))[0].json.candidates.length,0);
  }
 });
 test(`${w.id}: ownership follows either UUID or key across wrong repository`,()=>{
  for(const identity of [{id:registry.entries[0].issue_id,identifier:'GAL-9999'},{id:uuid(123),identifier:registry.entries[0].issue_key}]){
   const p=input([{...issue(),...identity}]);p.data.projects.nodes[0].externalLinks.nodes[0].url='https://github.com/other/repository';
   assert.equal(execute(w,p)[0].json.candidates.length,0);
  }
 });
 test(`${w.id}: label beyond old first-20 window stops candidates`,()=>{
  const i=issue([...Array.from({length:20},(_,n)=>n===0&&w.id===baselines[1].id?'AI Plan':`label-${n}`),'AI Skip CI']);
  const old=copy(i);old.labels.nodes=old.labels.nodes.slice(0,20);delete old.labels.pageInfo;
  assert.equal(execute(w,input([old]),false)[0].json.candidates.length,1);
  assert.equal(execute(w,input([i]))[0].json.candidates.length,0);
 });
 test(`${w.id}: incomplete or malformed label read stops entire poll before effects`,()=>{
  for(const mutate of [i=>delete i.labels.pageInfo,i=>i.labels.pageInfo.hasNextPage=true,i=>i.labels.nodes.push(i.labels.nodes[0]),i=>delete i.id]){
   const bad=issue();mutate(bad);
   assert.throws(()=>execute(w,input([issue(),bad])),/Development producer:/);
  }
 });
 test(`${w.id}: partial GraphQL errors cannot produce candidates or leak messages`,()=>{
  const p=input([issue()]);p.errors=[{message:'private upstream detail'}];
  assert.throws(()=>execute(w,p),e=>e.message==='Development producer: source read failed');
 });
 test(`${w.id}: updated query requests label identity and complete page information`,()=>{
  const query=compile(copy(baselines)).changes.find(c=>c.workflowId===w.id).operations[0].value;
  assert.match(query,/labels\(first: 100\) \{ nodes \{ id name \} pageInfo \{ hasNextPage endCursor \}/);
 });
}
test('compiler changes only four exact parameters, never executor, transport, credentials or activation',()=>{
 const plan=compile(copy(baselines));assert.equal(plan.apply,false);assert.equal(plan.model_calls,0);assert.equal(plan.source_writes,0);
 assert.equal(plan.changes.length,2);
 for(const c of plan.changes){assert.equal(c.operations.length,2);assert.deepEqual(c.operations.map(o=>o.path),['jsonBody','jsCode']);assert.ok(c.operations.every(o=>o.type==='setNodeParameter'));}
});
test('missing, duplicate, version, source and topology drift block compilation',()=>{
 for(const mutate of [w=>w.pop(),w=>w[1]=w[0],w=>w[0].active=false,w=>w[0].activeVersionId='changed',w=>w[0].nodes[0].name='changed',w=>w[0].connections.extra={main:[]}]){
  const snapshots=copy(baselines);mutate(snapshots);assert.throws(()=>compile(snapshots),/inventory|drift/);
 }
});
test('invalid and duplicate registry entries cannot weaken quarantine',()=>{
 for(const mutate of [r=>r.schema_version=2,r=>r.entries.push(r.entries[0]),r=>r.entries[0].issue_id='invalid',r=>r.entries=[]]){
  const r=copy(registry);mutate(r);assert.throws(()=>compile(copy(baselines),r),/registry/);
 }
});
test('filter dominates all paths to model and GitHub dispatch; bypass is refused',()=>{
 for(const w of baselines){fenced(w);const broken=copy(w);const trigger=broken.nodes.find(n=>/Trigger$/.test(n.type)).name;const target=broken.nodes.find(n=>/^GitHub: dispatch/.test(n.name)).name;
  broken.connections[trigger]={main:[[{node:target,type:'main',index:0}]]};assert.throws(()=>fenced(broken),/bypass/);
 }
});

test('fresh MCP reader rejects unpublished drafts and incomplete graph reads',()=>{
 for(const w of baselines){
  const full={...copy(w),versionId:w.draftVersionId,activeVersion:{sameAsDraft:true}};
  assert.deepEqual(snapshotFromMcp(full),w);
  for(const mutate of [x=>x.activeVersion.sameAsDraft=false,x=>delete x.nodes,x=>delete x.versionId,x=>x.active=false]){
   const bad=copy(full);mutate(bad);assert.throws(()=>snapshotFromMcp(bad),/Full published graph/);
  }
 }
});
