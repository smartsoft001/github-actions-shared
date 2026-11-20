'use strict';
// Supervised read-only operator tool, not a service. Existing gh/kubectl auth only.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {observe}=require('./rollout-observation.cjs');
const {validatePlan,digest}=require('./rollout.cjs');
const REPO='smartsoft001/galena-tele';
function transport(command,args,options={}){
 try{return execFileSync(command,args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:15000,maxBuffer:8*1024*1024,...options});}
 catch{throw Error('Authenticated read failed; private response suppressed');}
}
function read(plan,{run=transport,clock=()=>Date.now()/1000}={}){
 validatePlan(plan);if(plan.tele.repository!==REPO)throw Error('Unexpected reader scope');
 const started=clock(),api=p=>JSON.parse(run('gh',['api','--hostname','github.com',p]));
 const refs=()=>run('git',['ls-remote','--refs',`https://github.com/${REPO}.git`,'refs/heads/*','refs/tags/*']).trim().split('\n').map(line=>{const [sha,ref,...extra]=line.split('\t');if(extra.length)throw Error('Invalid ref response');return {ref,sha};});
 const before=refs();
 const github={observed_at:clock(),repository:REPO,workflows:[],run_inventories:[]};
 for(const w of plan.tele.workflows){
  const raw=api(`repos/${REPO}/actions/workflows/${w.id}`);
  github.workflows.push({id:String(raw.id),path:raw.path,state:raw.state});
  const pages=JSON.parse(run('gh',['api','--hostname','github.com','--paginate','--slurp',`repos/${REPO}/actions/workflows/${w.id}/runs?per_page=100`]));
  if(!Array.isArray(pages))throw Error('Invalid paginated response');
  github.run_inventories.push({workflow_id:w.id,pages:pages.map(p=>({total_count:p.total_count,workflow_runs:Array.isArray(p.workflow_runs)?p.workflow_runs.map(r=>({id:r.id,workflow_id:r.workflow_id,status:r.status})):null}))});
 }
 const n8n=JSON.parse(run('kubectl',['--context','smartsoft','--request-timeout=10s','-n','n8n','exec','-i','deploy/deploy-main-app','-c','app','--','node','-'],{input:fs.readFileSync(path.join(__dirname,'rollout-read-n8n.cjs'),'utf8')}));
 const after=refs(),finished=clock();
 const observation=observe(plan,{github,n8n,refs:{observed_at:started,before,after}},finished);
 // Reader has no journal or grant. Do not call Rollout.next or write receipts.
 return {schema_version:1,read_only:true,plan_sha256:digest(plan),reader_sha256:digest(['rollout-reader.cjs','rollout-read-n8n.cjs','rollout-observation.cjs'].map(name=>({name,source:fs.readFileSync(path.join(__dirname,name),'utf8')}))),duration_seconds:finished-started,collection:{ref_count:after.length,n8n_execution_rows:n8n.total_count,github:github.run_inventories.map(i=>({workflow_id:i.workflow_id,pages:i.pages.length,rows:i.pages.reduce((count,p)=>count+p.workflow_runs.length,0)}))},observation,model_calls:0,mutations:0};
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--read-only')throw Error('Explicit --read-only required');
 try{const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'rollout-preview.json'),'utf8'));console.log(JSON.stringify(read(plan),null,2));}
 catch{console.log(JSON.stringify({schema_version:1,read_only:true,result:'blocked',reason:'authenticated-source-incomplete-stale-or-inconsistent',model_calls:0,mutations:0}));process.exitCode=1;}
}
module.exports={read};
