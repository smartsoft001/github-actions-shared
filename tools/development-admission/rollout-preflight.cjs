'use strict';
// Supervised preview only. No grant parameter or mutation executor exists here.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {read}=require('./rollout-reader.cjs');
const {validatePlan,digest,Journal,Rollout}=require('./rollout.cjs');
function check(plan,{readSnapshot=()=>read(plan),clock=()=>Date.now()/1000}={}){
 validatePlan(plan);
 const packet=readSnapshot();
 if(packet?.read_only!==true||packet.mutations!==0||packet.model_calls!==0||packet.plan_sha256!==digest(plan)||!/^[a-f0-9]{64}$/.test(packet.reader_sha256))throw Error('Invalid read-only reader receipt');
 const o=packet.observation;
 let empty=true;
 for(const name of ['n8n','github']){
  const i=o?.inflight?.[name];if(i?.complete!==true||!Array.isArray(i.rows)||!Number.isSafeInteger(i.count)||i.count!==i.rows.length)throw Error('Incomplete preflight queue');
  if(i.count)empty=false;
 }
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rollout-preflight-'));
 try{
  // Disposable scratch journal, never the future operational recovery journal.
  Journal.initialize(root,plan);
  const runner=new Rollout(plan,root),result=runner.next(o,null,clock());
  if(result.status!=='awaiting-authorization'||Object.keys(runner.journal.read().entries).length!==0)throw Error('Preflight must not create an intent');
  return {schema_version:1,read_only:true,result:'baseline-verified-awaiting-authorization',plan_sha256:digest(plan),reader_sha256:packet.reader_sha256,
   observation:o,collection:packet.collection,queues_empty:empty,blocked_before_step:result.step,
   intents_created:0,grants_created:0,mutations:0,model_calls:0};
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--read-only')throw Error('Explicit --read-only required');
 try{const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'rollout-preview.json'),'utf8'));console.log(JSON.stringify(check(plan),null,2));}
 catch{console.log(JSON.stringify({schema_version:1,read_only:true,result:'blocked',reason:'preflight-source-or-plan-mismatch',mutations:0,model_calls:0}));process.exitCode=1;}
}
module.exports={check};
