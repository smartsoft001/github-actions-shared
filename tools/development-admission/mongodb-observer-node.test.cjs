const test=require('node:test');
const assert=require('node:assert/strict');
const {roleFor,identities,atlasRoles,accessPlan,verifyIdentity}=require('./mongodb-observer-access.cjs');
const {executeObserver}=require('./mongodb-observer-node-runtime.cjs');
function status(mode){const x=identities[mode];return {ok:1,authInfo:{authenticatedUsers:[{user:x.username,db:'admin'}],authenticatedUserRoles:[{role:x.role,db:'admin'}],authenticatedUserPrivileges:roleFor(mode).privileges}};}
test('Atlas role payloads have collection-only actions, no inherited built-ins or secrets',()=>{
  const p=accessPlan();assert.deepEqual(require('./observer-scoped-access-plan.json'),p);assert.equal(p.apply,false);assert.equal(p.project_id,null);assert.equal(p.cluster_name,null);
  for(const role of atlasRoles()){
    assert.deepEqual(role.inheritedRoles,[]);
    for(const a of role.actions){assert.ok(['FIND','INSERT','UPDATE'].includes(a.action));for(const r of a.resources){assert.equal(r.cluster,false);assert.equal(r.db,'ai-os');assert.ok(r.collection);}}
  }
  assert.ok(p.users.every(x=>!Object.hasOwn(x,'password')&&x.cluster_scope===null&&x.created===false));
});
test('self-privilege preflight rejects wildcard, extra action, swapped identities and extra roles',()=>{
  for(const mode of ['ingress','observe']){
    assert.equal(verifyIdentity(status(mode),mode),true);
    assert.equal(verifyIdentity(status(mode),mode==='ingress'?'observe':'ingress'),false);
    for(const change of [x=>x.authInfo.authenticatedUserPrivileges.push({resource:{anyResource:true},actions:['find']}),x=>x.authInfo.authenticatedUserPrivileges[0].actions.push('insert'),x=>x.authInfo.authenticatedUserRoles.push({role:'readWrite',db:'ai-os'})]){
      const s=structuredClone(status(mode));change(s);assert.equal(verifyIdentity(s,mode),false);
    }
  }
});
test('prepared node stops before input, credential, driver or network access',async()=>{
  const context=new Proxy({getNodeParameter:()=>true},{get:(o,k)=>k in o?o[k]:assert.fail('Unexpected access '+String(k))});
  const result=await executeObserver(context,{loadDriver:()=>assert.fail('driver')});
  assert.equal(result[0][0].json.action,'observer-node-prepared-disabled');
});
function context(){return {getNodeParameter:k=>({preparedOnly:false,mode:'ingress',approvedMongoCredentialId:'scoped-id'}[k]),getNode:()=>({credentials:{mongoDb:{id:'scoped-id'}},retryOnFail:false}),getInputData:()=>[{json:{packet:{}}}],getCredentials:async()=>({configurationType:'connectionString',database:'ai-os',connectionString:'mongodb+srv://synthetic.invalid'})};}
test('admin credential or mismatched binding refuses before reading credential values',async()=>{
  for(const id of ['18','bKjCNekrlGKLq8C2','other']){
    const c=context();c.getNode=()=>({credentials:{mongoDb:{id}}});c.getCredentials=()=>assert.fail('secret read');
    await assert.rejects(()=>executeObserver(c,{loadDriver:()=>assert.fail('driver')}),/AI OS observer blocked/);
  }
});
test('driver and connection errors are redacted; TLS and no-retry are mandatory',async()=>{
  let closed=false;
  class Client{constructor(uri,options){assert.equal(options.tls,true);assert.equal(options.tlsAllowInvalidCertificates,false);assert.equal(options.retryWrites,false);assert.equal(options.retryReads,false);this.options=options;}async connect(){throw Error('PRIVATE_URI_PASSWORD');}async close(){closed=true;}}
  await assert.rejects(()=>executeObserver(context(),{loadDriver:()=>Client}),e=>e.message==='AI OS observer blocked; inspect state before any retry');assert.equal(closed,true);
});
module.exports={status};
test('prepared workflow sources cannot schedule, connect credentials or bypass the ingress gate',()=>{
  const fs=require('node:fs'),path=require('node:path');
  for(const file of ['observer-ingress-prepared.workflow.json','observer-observe-prepared.workflow.json','observer-heartbeat-ingress-unpublished.workflow.json']){
    const w=JSON.parse(fs.readFileSync(path.join(__dirname,file)));
    assert.equal(w.active,false);assert.equal(w.nodes[0].disabled,true);
    assert.ok(w.nodes.every(n=>!n.credentials&&!/scheduleTrigger/.test(n.type)));
    assert.ok(w.nodes.filter(n=>n.type==='CUSTOM.developmentObserver').every(n=>n.parameters.preparedOnly===true&&n.parameters.approvedMongoCredentialId===''));
  }
  const ingress=require('./observer-heartbeat-ingress-unpublished.workflow.json');
  assert.equal(ingress.nodes[0].parameters.authentication,'headerAuth');
  assert.match(ingress.nodes[1].parameters.jsCode,/^throw new Error/);
});

test('verified Atlas target changes only project and exact cluster scope; access remains disabled',()=>{
  const target=require('./observer-scoped-access-target.json');
  assert.equal(target.project_id,'63f8d3e1e58a946d793a9e9b');
  assert.equal(target.cluster_name,'ClusterN8n');
  for(const user of target.users)assert.deepEqual(user.cluster_scope,[{name:'ClusterN8n',type:'CLUSTER'}]);
  const unbound=structuredClone(target);unbound.project_id=null;unbound.cluster_name=null;
  for(const user of unbound.users)user.cluster_scope=null;
  assert.deepEqual(unbound,accessPlan());
});

test('Mongo access probe runs only connectionStatus and rejects swapped accounts', async () => {
  for (const mode of ['ingress', 'observe']) {
    const probe = context();
    const original = probe.getNodeParameter;
    probe.getNodeParameter = key => {
      if (key === 'verifyOnly') return true;
      if (key === 'mode') return mode;
      if (key === 'recipient') assert.fail('probe read recipient');
      return original(key);
    };
    probe.getInputData = () => assert.fail('probe read input');
    Object.defineProperty(probe, 'helpers', { get: () => assert.fail('probe accessed HTTP') });

    for (const actualMode of ['ingress', 'observe']) {
      let commands = 0;
      let closed = false;
      class Client {
        async connect() {}
        db(database) {
          assert.equal(database, 'ai-os');
          return { command: async command => {
            assert.deepEqual(command, { connectionStatus: 1, showPrivileges: true, maxTimeMS: 3000 });
            commands++;
            return status(actualMode);
          }};
        }
        async close() { closed = true; }
      }
      const run = executeObserver(probe, { loadDriver: () => Client });
      if (mode === actualMode) {
        assert.deepEqual(await run, [[{ json: {
          action: 'observer-mongo-access-verified', mode, database: 'ai-os',
          tls_verified: true, privileges_verified: true,
        }}]]);
      } else {
        await assert.rejects(run, /AI OS observer blocked/);
      }
      assert.equal(commands, 1);
      assert.equal(closed, true);
    }
  }
});
