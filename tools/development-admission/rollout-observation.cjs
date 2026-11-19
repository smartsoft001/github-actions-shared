'use strict';
// Pure normalization for trusted authenticated readers. Never accept webhook/model
// snapshots as authority. No client, credentials, monitor receipt or executor.
const {validatePlan,graph,digest}=require('./rollout.cjs');
const HEX=/^[a-f0-9]{40}$/;
const fail=()=>{throw Error('Incomplete, stale or inconsistent rollout source');};
function fresh(source,now){if(!source||!Number.isFinite(source.observed_at)||!Number.isFinite(now)||now-source.observed_at<0||now-source.observed_at>30)fail();}
function exactIds(rows,ids,key){if(!Array.isArray(rows)||rows.length!==ids.length||new Set(rows.map(r=>String(r?.[key]))).size!==ids.length||rows.some(r=>!ids.includes(String(r?.[key]))))fail();}
function refs(rows){
 if(!Array.isArray(rows)||!rows.length||rows.some(r=>typeof r?.ref!=='string'||!/^refs\/(heads|tags)\/.+/.test(r.ref)||!HEX.test(r.sha))||new Set(rows.map(r=>r.ref)).size!==rows.length)fail();
 return rows.map(({ref,sha})=>({ref,sha})).sort((a,b)=>a.ref.localeCompare(b.ref,'en'));
}
function observe(plan,sources,now){
 validatePlan(plan);
 const ids=plan.producers.map(p=>p.id),teleIds=plan.tele.workflows.map(w=>w.id);
 for(const name of ['n8n','github','refs'])fresh(sources?.[name],now);
 const n=sources.n8n,g=sources.github,r=sources.refs;
 exactIds(n.workflows,ids,'id');
 const producers=n.workflows.map(w=>{
  if(typeof w.active!=='boolean'||typeof w.versionId!=='string'||!w.versionId||!Array.isArray(w.nodes)||!w.connections||typeof w.connections!=='object'||Array.isArray(w.connections)||!w.settings||typeof w.settings!=='object'||!Array.isArray(w.nodeGroups))fail();
  let active=null;
  if(w.active){
   if(typeof w.activeVersionId!=='string'||!w.activeVersionId)fail();
   if(w.activeVersion?.sameAsDraft===true){if(w.versionId!==w.activeVersionId)fail();active=graph(w);}
   else if(w.activeVersion?.sameAsDraft===false){
    const a=w.activeVersion;
    if(!Array.isArray(a.nodes)||!a.connections||!Array.isArray(a.nodeGroups))fail();
    active=graph({...w,nodes:a.nodes,connections:a.connections,nodeGroups:a.nodeGroups});
   }else fail();
  }else if(w.activeVersionId!==null||w.activeVersion!==null)fail();
  return {id:w.id,active:w.active,active_version:w.activeVersionId,draft_version:w.versionId,
   active_sha256:active?digest(active):null,draft_sha256:digest(graph(w))};
 });
 if(g.repository!==plan.tele.repository)fail();
 exactIds(g.workflows,teleIds,'id');
 const workflows=g.workflows.map(w=>{
  const expected=plan.tele.workflows.find(t=>t.id===String(w.id));
  if(w.path!==expected.path||!['active','disabled_manually'].includes(w.state))fail();
  return {id:String(w.id),path:w.path,state:w.state};
 });
 const before=refs(r.before),after=refs(r.after);
 if(digest(before)!==digest(after))fail();
 // Every targeted workflow needs a complete response, even when its total is 0.
 exactIds(g.run_inventories,teleIds,'workflow_id');
 const githubRows=[],seen=new Set();
 for(const inventory of g.run_inventories){
  if(!Array.isArray(inventory.pages)||inventory.pages.length===0)fail();
  const total=inventory.pages[0]?.total_count;
  if(!Number.isSafeInteger(total)||total<0)fail();
  let count=0;
  for(const page of inventory.pages){
   if(page.total_count!==total||!Array.isArray(page.workflow_runs))fail();
   for(const row of page.workflow_runs){
    if(row==null||!['string','number'].includes(typeof row.id)||!String(row.id)||String(row.workflow_id)!==String(inventory.workflow_id)||typeof row.status!=='string'||!row.status||seen.has(String(row.id)))fail();
    seen.add(String(row.id));count++;
    if(row.status!=='completed')githubRows.push({id:String(row.id),workflowId:String(row.workflow_id),status:row.status});
   }
  }
  if(count!==total)fail();
 }
 if(!Array.isArray(n.execution_scope)||digest([...n.execution_scope].sort())!==digest([...ids].sort())||!Array.isArray(n.executions)||n.total_count!==n.executions.length||!Number.isSafeInteger(n.total_count))fail();
 const n8nRows=[],executionIds=new Set();
 for(const row of n.executions){
  if(!row||!['string','number'].includes(typeof row.id)||!String(row.id)||!ids.includes(row.workflowId)||typeof row.status!=='string'||!row.status||executionIds.has(String(row.id)))fail();
  executionIds.add(String(row.id));
  if(!['success','error','canceled','crashed'].includes(row.status))n8nRows.push({id:String(row.id),workflowId:row.workflowId,status:row.status});
 }
 return {observed_at:Math.min(n.observed_at,g.observed_at,r.observed_at),producers,
  tele:{repository:g.repository,refs_sha256:digest(after),workflows},
  inflight:{n8n:{complete:true,count:n8nRows.length,rows:n8nRows},github:{complete:true,count:githubRows.length,rows:githubRows}}};
}
module.exports={observe};
