// Prepared orchestration only: no network, credential loading or API executor.
const fs=require('node:fs'), path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {compile,baselines,digest,snapshotFromMcp}=require('./producer-quarantine.cjs');
const IDS=baselines.map(w=>w.id);
const TELE=[{id:'271334799',path:'.github/workflows/ai-plan.yml'},{id:'273082025',path:'.github/workflows/ai-impl.yml'}];
const REPO='smartsoft001/galena-tele';
// Capture the implementation actually loaded for this process, not a moving branch.
const IMPLEMENTATION_SHA=digest(['rollout.cjs','producer-quarantine.cjs'].map(name=>({name,sha256:createHash('sha256').update(fs.readFileSync(path.join(__dirname,name))).digest('hex')})));
const HASH=/^[a-f0-9]{64}$/;
const clone=x=>JSON.parse(JSON.stringify(x));
function graph(w){return clone({name:w.name,nodes:w.nodes,connections:w.connections,settings:w.settings||{},nodeGroups:w.nodeGroups||[]});}
function buildPlan(workflows,tele){
 const compiled=compile(workflows.map(snapshotFromMcp));
 if(tele.repository!==REPO || !HASH.test(tele.refs_sha256) || tele.workflows.length!==2)throw Error('Incomplete Tele inventory');
 for(const expected of TELE){const hits=tele.workflows.filter(w=>String(w.id)===expected.id);if(hits.length!==1||hits[0].path!==expected.path||hits[0].state!=='active')throw Error('Tele workflow drift');}
 const producers=compiled.changes.map(change=>{
  const w=workflows.find(w=>w.id===change.workflowId),before=graph(w),after=clone(before);
  for(const op of change.operations)after.nodes.find(n=>n.name===op.nodeName).parameters[op.path]=op.value;
  return {id:w.id,baseline_version:w.activeVersionId,baseline_draft:w.versionId,before_sha256:digest(before),candidate_sha256:digest(after),operations:change.operations};
 });
 return {schema_version:1,prepared_only:true,implementation_sha256:IMPLEMENTATION_SHA,registry_sha256:compiled.registry_sha256,producers,tele:{repository:REPO,refs_sha256:tele.refs_sha256,workflows:clone(TELE)},model_calls:0};
}
function validatePlan(p){
 const compiled=compile(baselines);
 if(p.schema_version!==1||p.prepared_only!==true||p.implementation_sha256!==IMPLEMENTATION_SHA||p.registry_sha256!==compiled.registry_sha256||p.tele?.repository!==REPO||!HASH.test(p.tele.refs_sha256)||digest(p.tele.workflows)!==digest(TELE)||p.producers?.length!==2)throw Error('Invalid reviewed plan');
 for(const c of compiled.changes){const x=p.producers.find(x=>x.id===c.workflowId);if(!x||x.baseline_version!==c.expectedActiveVersionId||x.baseline_draft!==c.expectedDraftVersionId||!HASH.test(x.before_sha256)||!HASH.test(x.candidate_sha256)||digest(x.operations)!==digest(c.operations))throw Error('Unreviewed producer material');}
}
function privatePath(p,directory=false){
 const s=fs.lstatSync(p);if(!path.isAbsolute(p)||s.uid!==process.getuid()||(s.mode&0o077)||!(directory?s.isDirectory():s.isFile()))throw Error('Owner-only nonsymlink state required');
}
function writeExclusive(file,value){const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function syncDir(root){const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
class Journal{
 static initialize(root,plan){validatePlan(plan);privatePath(root,true);writeExclusive(path.join(root,'state.json'),{schema_version:1,plan_sha256:digest(plan),entries:{}});syncDir(root);}
 constructor(root,plan){privatePath(root,true);this.root=root;this.file=path.join(root,'state.json');this.plan=plan;this.read();}
 read(){privatePath(this.file);const state=JSON.parse(fs.readFileSync(this.file,'utf8'));if(state.schema_version!==1||state.plan_sha256!==digest(this.plan)||!state.entries||Array.isArray(state.entries))throw Error('State/material mismatch');return state;}
 save(state){const temporary=path.join(this.root,'.state-'+randomUUID());writeExclusive(temporary,state);fs.renameSync(temporary,this.file);syncDir(this.root);}
 lease(fn){const file=path.join(this.root,'lease.json'),nonce=randomUUID();try{writeExclusive(file,{nonce,pid:process.pid,plan_sha256:digest(this.plan)});}catch(e){if(e.code==='EEXIST')return {status:'busy',automatic_retry:false};throw e;}
  try{return fn();}finally{privatePath(file);if(JSON.parse(fs.readFileSync(file,'utf8')).nonce!==nonce)throw Error('Lease ownership changed');fs.unlinkSync(file);syncDir(this.root);}}
}
function steps(){return [...IDS.map(id=>({id:'pause:'+id,kind:'pause',target:id})),...TELE.map(w=>({id:'disable:'+w.id,kind:'disable',target:w.id})),...IDS.map(id=>({id:'stage:'+id,kind:'stage',target:id})),...IDS.map(id=>({id:'publish:'+id,kind:'publish',target:id}))];}
function inspect(plan,o,state,now){
 if(!Number.isFinite(now)||!Number.isFinite(o.observed_at)||now-o.observed_at<0||now-o.observed_at>30)throw Error('Stale observation');
 if(o.tele?.repository!==REPO||o.tele.refs_sha256!==plan.tele.refs_sha256||o.tele.workflows?.length!==2||o.producers?.length!==2)throw Error('Source inventory drift');
 const all=steps();if(Object.keys(state.entries).some(k=>!all.some(s=>s.id===k)))throw Error('Unknown journal step');
 let gap=false;for(const step of all){const e=state.entries[step.id];if(!e){gap=true;continue;}if(gap)throw Error('Nonsequential journal');if(e.status!=='confirmed')gap=true;}
 for(const [k,e]of Object.entries(state.entries))if(!['intent','confirmed'].includes(e.status)||e.step!==k||!Number.isFinite(e.intent_at))throw Error('Invalid journal entry');
 for(const p of plan.producers){
  const matches=o.producers.filter(w=>w.id===p.id);if(matches.length!==1)throw Error('Producer identity drift');const w=matches[0];
  const pause=state.entries['pause:'+p.id],stage=state.entries['stage:'+p.id],pub=state.entries['publish:'+p.id];
  if(w.draft_sha256!==p.before_sha256&&w.draft_sha256!==p.candidate_sha256)throw Error('Unexpected draft material');
  if(w.draft_sha256===p.candidate_sha256&&!stage)throw Error('Unowned draft change');
  if(stage?.status==='confirmed'&&(w.draft_sha256!==p.candidate_sha256||w.draft_version!==stage.draft_version))throw Error('Staged version changed');
  if(!pause&&(w.active!==true||w.active_version!==p.baseline_version||w.draft_version!==p.baseline_draft||w.active_sha256!==p.before_sha256))throw Error('Initial producer drift');
  if(pause?.status==='confirmed'&&w.active===true&&!pub)throw Error('Producer resumed outside rollout');
  if(w.active===true){
   if(pub){if(w.active_version!==stage?.draft_version||w.active_sha256!==p.candidate_sha256)throw Error('Unexpected published version');}
   else if(w.active_version!==p.baseline_version||w.active_sha256!==p.before_sha256)throw Error('Unexpected active material');
  }else if(w.active!==false||w.active_version!==null)throw Error('Unconfirmed pause');
  if(pub?.status==='confirmed'&&w.active!==true)throw Error('Published producer changed');
 }
 for(const t of TELE){const matches=o.tele.workflows.filter(w=>String(w.id)===t.id);if(matches.length!==1||matches[0].path!==t.path)throw Error('Tele identity drift');const e=state.entries['disable:'+t.id];
  if(!['active','disabled_manually'].includes(matches[0].state))throw Error('Unknown Tele state');
  if(!e&&matches[0].state!=='active')throw Error('Tele changed outside rollout');
  if(e?.status==='confirmed'&&matches[0].state!=='disabled_manually')throw Error('Tele was re-enabled');
 }
}
function drain(o){
 for(const system of ['n8n','github']){const d=o.inflight?.[system];if(d?.complete!==true||!Array.isArray(d.rows)||d.count!==d.rows.length)throw Error('Incomplete in-flight inventory');if(d.rows.length)return false;}return true;
}
function targetReached(step,plan,o,state){
 if(step.kind==='disable')return o.tele.workflows.find(w=>String(w.id)===step.target).state==='disabled_manually';
 const w=o.producers.find(w=>w.id===step.target),p=plan.producers.find(p=>p.id===step.target);
 if(step.kind==='pause')return w.active===false&&w.active_version===null&&w.draft_sha256===p.before_sha256;
 if(step.kind==='stage')return w.active===false&&w.active_version===null&&w.draft_sha256===p.candidate_sha256&&typeof w.draft_version==='string'&&!!w.draft_version&&w.draft_version!==p.baseline_draft;
 return w.active===true&&w.active_version===state.entries['stage:'+step.target].draft_version&&w.active_sha256===p.candidate_sha256;
}
function grantAllows(grant,plan,now,publish){return grant?.plan_sha256===digest(plan)&&Number.isFinite(grant.expires_at)&&Number.isFinite(grant.issued_at)&&grant.expires_at-grant.issued_at<=3600&&grant.expires_at>now&&grant.issued_at<=now&&now-grant.issued_at<=3600&&grant.exclusive_supervised_window_ack===true&&grant.shared_producer_pause_ack===true&&grant.tele_ai_pause_ack===true&&grant.allow_mutation===true&&(!publish||(grant.allow_publish===true&&grant.legacy_paid_activity_ack===true));}
function action(step,plan,state){
 const p=plan.producers.find(p=>p.id===step.target);
 if(step.kind==='pause')return {tool:'unpublish_workflow',workflowId:step.target};
 if(step.kind==='disable')return {method:'PUT',repository:REPO,path:`/repos/${REPO}/actions/workflows/${step.target}/disable`};
 if(step.kind==='stage')return {tool:'update_workflow',workflowId:step.target,operations:p.operations};
 const versionId=state.entries['stage:'+step.target]?.draft_version;if(!versionId)throw Error('Missing readback version');return {tool:'publish_workflow',workflowId:step.target,versionId};
}
class Rollout{
 constructor(plan,root){validatePlan(plan);this.plan=clone(plan);this.journal=new Journal(root,this.plan);}
 next(observation,grant=null,now=Date.now()/1000){return this.journal.lease(()=>{
  const state=this.journal.read();inspect(this.plan,observation,state,now);
  for(const step of steps()){
   const e=state.entries[step.id];if(e?.status==='confirmed')continue;
   if(e){if(!targetReached(step,this.plan,observation,state))return {status:'reconcile-only',step:step.id,automatic_retry:false};
    e.status='confirmed';e.confirmed_at=now;if(step.kind==='stage')e.draft_version=observation.producers.find(w=>w.id===step.target).draft_version;this.journal.save(state);continue;}
   if(step.kind==='stage'||step.kind==='publish'){
    if(!observation.tele.workflows.every(w=>w.state==='disabled_manually'))throw Error('Legacy entry still enabled');
    if(!drain(observation))return {status:'waiting-for-drain',step:step.id,automatic_retry:false};
   }
   if(!grantAllows(grant,this.plan,now,step.kind==='publish'))return {status:step.kind==='publish'?'staged-paused-awaiting-publication-approval':'awaiting-authorization',step:step.id,model_calls:0};
   if(step.kind==='publish'&&(observation.failure_monitor?.readback_verified!==true||!HASH.test(observation.failure_monitor.receipt_sha256)||grant.failure_monitor_receipt_sha256!==observation.failure_monitor.receipt_sha256))return {status:'blocked-monitoring-unverified',step:step.id};
   state.entries[step.id]={step:step.id,status:'intent',intent_at:now};this.journal.save(state);
   return {status:'manual-mutation-proposed',step:step.id,action:action(step,this.plan,state),automatic_retry:false,model_calls:0};
  }
  return {status:'readback-complete',tele_still_disabled:true,model_tests_performed:false};
 });}
}
// Containment only: never re-enable old receivers or publish old unsafe code.
function containment(plan){validatePlan(plan);return {apply:false,actions:[...IDS.map(workflowId=>({tool:'unpublish_workflow',workflowId})),...TELE.map(w=>({method:'PUT',repository:REPO,path:`/repos/${REPO}/actions/workflows/${w.id}/disable`}))]};}
module.exports={buildPlan,graph,validatePlan,Journal,Rollout,containment,digest,IDS,TELE,REPO,IMPLEMENTATION_SHA};
