const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {read}=require('./rollout-reader.cjs'),{buildPlan,digest}=require('./rollout.cjs'),{baselines}=require('./producer-quarantine.cjs');
function setup(){
 const refs=[{ref:'refs/heads/development',sha:'a'.repeat(40)}],refText=refs.map(r=>r.sha+'\t'+r.ref).join('\n')+'\n';
 const workflows=structuredClone(baselines).map(w=>({...w,name:'fixture',versionId:w.draftVersionId,activeVersion:{sameAsDraft:true},settings:{},nodeGroups:[]}));
 const tele={repository:'smartsoft001/galena-tele',refs_sha256:digest(refs),workflows:[{id:'271334799',path:'.github/workflows/ai-plan.yml',state:'active'},{id:'273082025',path:'.github/workflows/ai-impl.yml',state:'active'}]};
 const plan=buildPlan(workflows,tele),calls=[],n8n={observed_at:1000,workflows,execution_scope:workflows.map(w=>w.id),executions:[],total_count:0};
 const f={plan,calls,n8n,refText,pages:()=>[{total_count:0,workflow_runs:[]}],clock:()=>1000};
 f.run=(command,args,options)=>{
  calls.push({command,args,options});
  if(command==='git')return f.refText;
  if(command==='kubectl')return JSON.stringify(f.n8n);
  assert.equal(command,'gh');assert.equal(args[0],'api');assert.ok(args.includes('github.com'));
  const route=args.at(-1),id=route.match(/workflows\/(\d+)/)[1];
  return JSON.stringify(route.includes('/runs?')?f.pages(id):tele.workflows.find(w=>w.id===id));
 };
 return f;
}
test('authenticated commands are fixed reads; outputs omit private graph parameters and no grant/journal is created',()=>{
 const f=setup();f.n8n.workflows[0].nodes[0].parameters={fixture:'private-value-never-output'};
 const result=read(f.plan,f);assert.equal(result.mutations,0);assert.equal(result.read_only,true);assert.equal(f.calls.length,7);assert.equal(result.observation.failure_monitor,undefined);assert.ok(!JSON.stringify(result).includes('private-value-never-output'));
 const k=f.calls.find(c=>c.command==='kubectl');assert.deepEqual(k.args,['--context','smartsoft','--request-timeout=10s','-n','n8n','exec','-i','deploy/deploy-main-app','-c','app','--','node','-']);
 for(const c of f.calls){assert.ok(!c.args.some(a=>['POST','PUT','PATCH','DELETE','--method'].includes(a)));if(c.command==='git')assert.ok(c.args.includes('https://github.com/smartsoft001/galena-tele.git'));}
});
test('all paginated results reach normalizer; pending is not silently discarded',()=>{
 const f=setup();f.pages=id=>[{total_count:2,workflow_runs:[{id:id+'1',workflow_id:id,status:'completed'}]},{total_count:2,workflow_runs:[{id:id+'2',workflow_id:id,status:'pending'}]}];
 const result=read(f.plan,f);assert.equal(result.observation.inflight.github.count,2);assert.ok(f.calls.filter(c=>c.command==='gh'&&c.args.at(-1).includes('/runs?')).every(c=>c.args.includes('--paginate')&&c.args.includes('--slurp')));
});
test('truncated runs and changed ref inventory fail closed',()=>{
 let f=setup();f.pages=()=>[{total_count:1,workflow_runs:[]}];assert.throws(()=>read(f.plan,f));
 f=setup();const run=f.run;let refs=0;f.run=(c,a,o)=>c==='git'&&++refs===2?'b'.repeat(40)+'\trefs/heads/development\n':run(c,a,o);assert.throws(()=>read(f.plan,f));
});
test('overlong collection is stale instead of refreshing the read timestamps',()=>{
 const f=setup();let count=0;f.clock=()=>++count===3?1031:1000;assert.throws(()=>read(f.plan,f));
});
test('authentication/transport failure stops without fallback or writes',()=>{
 const f=setup();f.run=()=>{throw Error('unavailable')};assert.throws(()=>read(f.plan,f));assert.deepEqual(f.calls,[]);
});
test('actual SQLite helper reads published history and unknown executions without credentials or execution data',()=>{
 const {DatabaseSync}=require('node:sqlite'),root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-sqlite-')),file=path.join(root,'fixture.sqlite');
 try{
  const db=new DatabaseSync(file);db.exec('CREATE TABLE workflow_entity(id TEXT,name TEXT,nodes TEXT,connections TEXT,settings TEXT,nodeGroups TEXT,versionId TEXT,activeVersionId TEXT,active INTEGER); CREATE TABLE workflow_history(workflowId TEXT,versionId TEXT,nodes TEXT,connections TEXT,nodeGroups TEXT); CREATE TABLE execution_entity(id TEXT,workflowId TEXT,status TEXT);');
  for(const id of baselines.map(w=>w.id)){
   db.prepare('INSERT INTO workflow_entity VALUES(?,?,?,?,?,?,?,?,?)').run(id,'fixture','[]','{}','{}','[]','draft','published',1);
   db.prepare('INSERT INTO workflow_history VALUES(?,?,?,?,?)').run(id,'published','[{"name":"published"}]','{}','[]');
   for(const status of ['success','unknown','waiting'])db.prepare('INSERT INTO execution_entity VALUES(?,?,?)').run(id+status,id,status);
  }
  db.close();
  const script=fs.readFileSync(path.join(__dirname,'rollout-read-n8n.cjs'),'utf8').replace("'/home/node/.n8n/database.sqlite'",JSON.stringify(file));
  const output=JSON.parse(execFileSync(process.execPath,['-'],{input:script,encoding:'utf8',stdio:['pipe','pipe','pipe']}));
  assert.equal(output.total_count,4);assert.ok(output.workflows.every(w=>w.activeVersion.sameAsDraft===false&&w.activeVersion.nodes[0].name==='published'));assert.ok(output.executions.every(r=>r.status!=='success'));
  const check=new DatabaseSync(file,{readOnly:true});assert.equal(check.prepare('SELECT count(*) n FROM execution_entity').get().n,6);check.close();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
