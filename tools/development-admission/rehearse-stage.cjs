'use strict';
// Local simulation only. Reads trusted Shared code; no API clients or executor.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
function run(){
 const tool=__dirname;
 const {Journal,Rollout,validatePlan,digest}=require(path.join(tool,'rollout.cjs'));
 const plan=JSON.parse(fs.readFileSync(path.join(tool,'rollout-preview.json'),'utf8'));
 validatePlan(plan);
 const now=1000; // Synthetic time and authority are scoped to disposable fixtures.
 const initial={observed_at:now,tele:{...structuredClone(plan.tele),workflows:plan.tele.workflows.map(w=>({...w,state:'active'}))},
  producers:plan.producers.map(p=>({id:p.id,active:true,active_version:p.baseline_version,draft_version:p.baseline_draft,active_sha256:p.before_sha256,draft_sha256:p.before_sha256})),
  inflight:{n8n:{complete:true,count:0,rows:[]},github:{complete:true,count:0,rows:[]}}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage-only-fixture-'));
 const dirs=[];
 const make=()=>{const dir=path.join(root,String(dirs.length));fs.mkdirSync(dir,{mode:0o700});dirs.push(dir);Journal.initialize(dir,plan);return dir;};
 try{
  const absent=make(),noAuthority=new Rollout(plan,absent);
  assert.equal(noAuthority.next(initial,null,now).status,'awaiting-authorization');
  assert.deepEqual(noAuthority.journal.read().entries,{});
  const fixtureGrant={plan_sha256:digest(plan),issued_at:now-1,expires_at:now+100,allow_mutation:true,allow_publish:false,
   exclusive_supervised_window_ack:true,shared_producer_pause_ack:true,tele_ai_pause_ack:true};
  const dir=make(),observation=structuredClone(initial),steps=[];
  let uncertainBlocked=0;
  for(let i=0;i<6;i++){
   const proposed=new Rollout(plan,dir).next(observation,fixtureGrant,now);
   assert.equal(proposed.status,'manual-mutation-proposed');
   assert.notEqual(proposed.action.tool,'publish_workflow');
   // Lose the response and reopen the actual durable journal before readback.
   const restarted=new Rollout(plan,dir).next(observation,fixtureGrant,now);
   assert.equal(restarted.status,'reconcile-only');uncertainBlocked++;
   steps.push(proposed.step);
   const [kind,id]=proposed.step.split(':');
   if(kind==='disable')observation.tele.workflows.find(w=>String(w.id)===id).state='disabled_manually';
   else{
    const w=observation.producers.find(w=>w.id===id),p=plan.producers.find(p=>p.id===id);
    if(kind==='pause'){w.active=false;w.active_version=null;w.active_sha256=null;}
    else{assert.equal(kind,'stage');assert.ok(observation.tele.workflows.every(w=>w.state==='disabled_manually'));
     w.draft_sha256=p.candidate_sha256;w.draft_version='fixture-draft-'+id;}
   }
  }
  const last=new Rollout(plan,dir).next(observation,fixtureGrant,now);
  assert.equal(last.status,'staged-paused-awaiting-publication-approval');
  const journal=new Journal(dir,plan).read();
  assert.equal(Object.keys(journal.entries).length,6);
  assert.ok(Object.values(journal.entries).every(e=>e.status==='confirmed'));
  assert.ok(observation.producers.every(p=>p.active===false));
  assert.deepEqual(steps.map(x=>x.split(':')[0]),['pause','pause','disable','disable','stage','stage']);
  return {fixture_only:true,plan_sha256:digest(plan),steps,uncertain_response_replays_blocked:uncertainBlocked,
   no_authority_intents:0,final_status:last.status,producers_paused_in_fixture:true,tele_disabled_in_fixture:true,
   live_api_calls:0,model_calls:0,finalizer_activated:false};
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
if(require.main===module)console.log(JSON.stringify(run(),null,2));
module.exports={run};
