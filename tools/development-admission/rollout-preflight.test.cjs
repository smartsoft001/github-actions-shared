const test=require('node:test'),assert=require('node:assert/strict');
const {check}=require('./rollout-preflight.cjs'),{digest}=require('./rollout.cjs');
const reviewed=require('./rollout-preview.json');
function fixture(){
 const plan=structuredClone(reviewed),o={observed_at:1000,tele:{...structuredClone(plan.tele),workflows:plan.tele.workflows.map(w=>({...w,state:'active'}))},producers:plan.producers.map(p=>({id:p.id,active:true,active_version:p.baseline_version,draft_version:p.baseline_draft,active_sha256:p.before_sha256,draft_sha256:p.before_sha256})),inflight:{n8n:{complete:true,count:0,rows:[]},github:{complete:true,count:0,rows:[]}}};
 const packet={read_only:true,mutations:0,model_calls:0,reader_sha256:'a'.repeat(64),plan_sha256:digest(plan),observation:o};
 return {plan,packet,options:{readSnapshot:()=>packet,clock:()=>1000}};
}
test('current manifest and verified snapshot stop before pause with zero grants or intents',()=>{
 const f=fixture(),r=check(f.plan,f.options);assert.equal(r.result,'baseline-verified-awaiting-authorization');assert.equal(r.blocked_before_step,'pause:'+f.plan.producers[0].id);assert.equal(r.intents_created,0);assert.equal(r.grants_created,0);assert.equal(r.queues_empty,true);
});
test('forged receipt flags or plan digest are not accepted',()=>{
 for(const mutate of [p=>p.read_only=false,p=>p.mutations=1,p=>p.model_calls=1,p=>p.reader_sha256='missing',p=>p.plan_sha256='b'.repeat(64)]){const f=fixture();mutate(f.packet);assert.throws(()=>check(f.plan,f.options));}
});
test('stale snapshot, changed version, graph or refs block the preview',()=>{
 for(const mutate of [o=>o.observed_at=969,o=>o.producers[0].active_version='foreign',o=>o.producers[0].draft_sha256='b'.repeat(64),o=>o.tele.refs_sha256='c'.repeat(64)]){const f=fixture();mutate(f.packet.observation);assert.throws(()=>check(f.plan,f.options));}
});
test('incomplete queues fail while actual pending work is reported without a grant',()=>{
 const f=fixture(),q=f.packet.observation.inflight.github;q.complete=false;assert.throws(()=>check(f.plan,f.options));q.complete=true;q.rows=[{id:'pending-run',status:'pending'}];q.count=1;const r=check(f.plan,f.options);assert.equal(r.queues_empty,false);assert.equal(r.intents_created,0);
});
test('passing arbitrary approval in dependencies cannot authorize or publish',()=>{
 const f=fixture();f.options.grant={allow_mutation:true,allow_publish:true};f.packet.grant=f.options.grant;const r=check(f.plan,f.options);assert.equal(r.result,'baseline-verified-awaiting-authorization');assert.equal(r.intents_created,0);assert.ok(!JSON.stringify(r).includes('allow_publish'));
});
