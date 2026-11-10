const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const proposal=require('./observer-production-initialization-plan.json');
const binding=require('./observer-production-binding-proposal.json');
const {plan}=require('./mongodb-observer-initialize.cjs');
test('candidate production policy verifies against pinned Python code and exact disabled plan',()=>{
  const py=spawnSync('python3',['-c',"import json,sys;sys.path.insert(0,sys.argv[1]);import producer_monitor_health as h;p=json.load(sys.stdin);h.validate(p['health_policy']);assert p['health_policy']['enabled'] is False;assert p['health_policy']['monitor_profile']['enabled'] is False;assert p['health_policy']['monitor_profile']['scope']=='production';assert h.binding(p['health_policy'])==p['binding_sha256']",__dirname],{input:JSON.stringify(binding),encoding:'utf8'});
  assert.equal(py.status,0,py.stderr);assert.equal(binding.candidate_not_installed,true);
  assert.equal(proposal.binding_sha256,binding.binding_sha256);
  assert.equal(JSON.stringify(proposal),JSON.stringify(plan(binding.binding_sha256,new Date(proposal.baseline))));
  assert.equal(proposal.database,'ai-os');assert.equal(proposal.enabled,false);
});
test('admin initialize refuses missing/wrong approval before configuration or credential access',async()=>{
  const {validateRequest,run}=await import('./mongodb-observer-admin.mjs');
  for(const approval of [undefined,'f'.repeat(64)]){
    assert.throws(()=>validateRequest(['--initialize','/not-existing-private-config',...(approval?[approval]:[])],proposal));
  }
  await assert.rejects(()=>run(['--initialize','/not-existing-private-config','wrong']));
  const child=spawnSync(process.execPath,[path.join(__dirname,'mongodb-observer-admin.mjs'),'--initialize','/not-existing-private-config','wrong'],{encoding:'utf8'});
  assert.equal(child.status,1);assert.deepEqual(JSON.parse(child.stdout),{action:'admin-request-blocked',healthy:false,automatic_retry:false,details_redacted:true});
});

test('admin check validates private configuration without reading secret or connecting',async()=>{
  const fs=require('node:fs/promises'),os=require('node:os');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mongo-admin-check-'));
  try{
    const config=path.join(root,'config.json');
    await fs.writeFile(config,JSON.stringify({schema_version:1,database:'ai-os',enabled:false,driver_path:'/missing/driver',uri_file:'/missing/secret',plan_sha256:proposal.plan_sha256}),{mode:0o600});
    const {run}=await import('./mongodb-observer-admin.mjs');
    const r=await run(['--check',config]);assert.equal(r.connected,false);assert.equal(r.write_attempted,false);
    await fs.chmod(config,0o644);await assert.rejects(()=>run(['--check',config]));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
