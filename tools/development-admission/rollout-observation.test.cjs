const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {observe}=require('./rollout-observation.cjs');
const {buildPlan,Journal,Rollout,digest}=require('./rollout.cjs');
const {baselines}=require('./producer-quarantine.cjs');
function fixture(){
 const refs=[{ref:'refs/heads/development',sha:'a'.repeat(40)},{ref:'refs/tags/fixture',sha:'b'.repeat(40)}];
 const workflows=structuredClone(baselines).map(w=>({...w,name:'fixture',versionId:w.draftVersionId,activeVersion:{sameAsDraft:true},settings:{timezone:'UTC'},nodeGroups:[]}));
 const tele={repository:'smartsoft001/galena-tele',refs_sha256:digest(refs),workflows:[{id:'271334799',path:'.github/workflows/ai-plan.yml',state:'active'},{id:'273082025',path:'.github/workflows/ai-impl.yml',state:'active'}]};
 const plan=buildPlan(workflows,tele),sources={n8n:{observed_at:1000,workflows,execution_scope:workflows.map(w=>w.id),executions:[],total_count:0},github:{observed_at:1000,repository:tele.repository,workflows:tele.workflows,run_inventories:tele.workflows.map(w=>({workflow_id:w.id,pages:[{total_count:0,workflow_runs:[]}]}))},refs:{observed_at:1000,before:refs,after:structuredClone(refs)}};
 return {plan,sources};
}
test('complete fixture normalizes into existing planner without granting authority or creating an intent',()=>{
 const {plan,sources}=fixture(),before=structuredClone(sources),o=observe(plan,sources,1000),root=fs.mkdtempSync(path.join(os.tmpdir(),'observation-test-'));
 try{Journal.initialize(root,plan);const runner=new Rollout(plan,root);assert.equal(runner.next(o,null,1000).status,'awaiting-authorization');assert.deepEqual(runner.journal.read().entries,{});assert.equal(o.failure_monitor,undefined);assert.deepEqual(sources,before);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('every source clock must be fresh, including future and nonnumeric values',()=>{
 for(const source of ['n8n','github','refs'])for(const t of [969,1001,NaN,'1000']){const {plan,sources}=fixture();sources[source].observed_at=t;assert.throws(()=>observe(plan,sources,1000));}
});
test('missing pages, changing total and duplicate runs never become complete',()=>{
 for(const mutate of [x=>x.pages=[],x=>x.pages[0].total_count=1,x=>x.pages.push({total_count:1,workflow_runs:[]}),x=>{const row={id:1,workflow_id:x.workflow_id,status:'completed'};x.pages=[{total_count:2,workflow_runs:[row,row]}];}]){const {plan,sources}=fixture();mutate(sources.github.run_inventories[0]);assert.throws(()=>observe(plan,sources,1000));}
});
test('actual pagination preserves pending and unknown work while excluding only completed GitHub runs',()=>{
 const {plan,sources}=fixture(),i=sources.github.run_inventories[0];i.pages=[{total_count:3,workflow_runs:[{id:1,workflow_id:i.workflow_id,status:'completed'}]},{total_count:3,workflow_runs:[{id:2,workflow_id:i.workflow_id,status:'waiting'},{id:3,workflow_id:i.workflow_id,status:'future-status'}]}];
 const o=observe(plan,sources,1000);assert.deepEqual(o.inflight.github.rows.map(r=>r.status),['waiting','future-status']);assert.equal(o.inflight.github.count,2);
});
test('missing n8n scope, count mismatch and foreign executions fail closed',()=>{
 for(const mutate of [n=>n.execution_scope.pop(),n=>n.total_count=1,n=>{n.executions=[{id:1,workflowId:'foreign',status:'running'}];n.total_count=1;}]){const {plan,sources}=fixture();mutate(sources.n8n);assert.throws(()=>observe(plan,sources,1000));}
});
test('unknown n8n work remains a drain blocker; terminal work is not running',()=>{
 const {plan,sources}=fixture(),id=plan.producers[0].id;sources.n8n.executions=['success','error','canceled','crashed','unknown','waiting'].map((status,id2)=>({id:id2+1,workflowId:id,status}));sources.n8n.total_count=6;
 assert.deepEqual(observe(plan,sources,1000).inflight.n8n.rows.map(r=>r.status),['unknown','waiting']);
});
test('changed refs between reads and workflow identity/path drift are rejected',()=>{
 for(const mutate of [s=>s.refs.after[0].sha='c'.repeat(40),s=>s.refs.before.push(s.refs.before[0]),s=>s.github.workflows[0].path='.github/workflows/other.yml',s=>s.github.run_inventories.pop(),s=>s.n8n.workflows[0].id='foreign']){const {plan,sources}=fixture();mutate(sources);assert.throws(()=>observe(plan,sources,1000));}
});
test('missing published graph and false same-as-draft evidence are rejected',()=>{
 for(const mutate of [w=>delete w.activeVersion,w=>w.activeVersionId='different',w=>{w.activeVersion={sameAsDraft:false};}]){const {plan,sources}=fixture();mutate(sources.n8n.workflows[0]);assert.throws(()=>observe(plan,sources,1000));}
});
test('paused workflows normalize without inventing an active version',()=>{
 const {plan,sources}=fixture();for(const w of sources.n8n.workflows){w.active=false;w.activeVersionId=null;w.activeVersion=null;}const o=observe(plan,sources,1000);assert.ok(o.producers.every(w=>w.active_sha256===null&&w.active_version===null));
});
test('different active/draft graphs keep separate hashes instead of treating the latest draft as published',()=>{
 const {plan,sources}=fixture(),w=sources.n8n.workflows[0],before=observe(plan,sources,1000).producers[0].active_sha256;
 w.activeVersion={sameAsDraft:false,nodes:structuredClone(w.nodes),connections:structuredClone(w.connections),nodeGroups:[]};
 w.versionId='unpublished-fixture';w.nodes[0].parameters={fixture:'changed'};
 const result=observe(plan,sources,1000).producers[0];assert.equal(result.active_sha256,before);assert.notEqual(result.draft_sha256,before);
});
test('normalized output never includes full node parameters, credential values or injected monitoring proof',()=>{
 const {plan,sources}=fixture();sources.n8n.workflows[0].nodes[0].parameters={recipient:'fixture-private-value'};sources.n8n.workflows[0].credentials={fixture:'fixture-private-value'};sources.failure_monitor={readback_verified:true,receipt_sha256:'a'.repeat(64)};
 const o=observe(plan,sources,1000);assert.ok(!JSON.stringify(o).includes('fixture-private-value'));assert.equal(o.failure_monitor,undefined);
});
test('pending work normalized from paginated GitHub reads prevents staging in the existing journal',()=>{
 const {plan,sources}=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'observation-drain-'));
 const i=sources.github.run_inventories[0];i.pages=[{total_count:1,workflow_runs:[{id:123,workflow_id:i.workflow_id,status:'pending'}]}];
 const grant={plan_sha256:digest(plan),issued_at:999,expires_at:1100,allow_mutation:true,allow_publish:false,exclusive_supervised_window_ack:true,shared_producer_pause_ack:true,tele_ai_pause_ack:true};
 try{Journal.initialize(root,plan);
  for(let count=0;count<4;count++){
   const p=new Rollout(plan,root).next(observe(plan,sources,1000),grant,1000);assert.equal(p.status,'manual-mutation-proposed');const [kind,id]=p.step.split(':');
   if(kind==='pause'){const w=sources.n8n.workflows.find(w=>w.id===id);w.active=false;w.activeVersionId=null;w.activeVersion=null;}
   else{assert.equal(kind,'disable');sources.github.workflows.find(w=>w.id===id).state='disabled_manually';}
  }
  const runner=new Rollout(plan,root);assert.equal(runner.next(observe(plan,sources,1000),grant,1000).status,'waiting-for-drain');assert.equal(Object.keys(runner.journal.read().entries).length,4);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
