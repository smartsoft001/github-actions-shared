'use strict';

// Opt-in integration suite. Uses an existing n8n installation, fresh SQLite,
// no credentials and an OS-enforced loopback-only network on macOS.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const {definitions}=require('./build-metadata-gateway.cjs');
const CASES=['nonempty','multipage','source-503','second-page-503','page-cap','duplicate-row'];
const copy=x=>JSON.parse(JSON.stringify(x));
function expressions(x) {
  if(typeof x==='string')return x.startsWith('EXPR:')?'='+x.slice(5):x;
  if(Array.isArray(x))return x.map(expressions);
  if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,expressions(v)]));
  return x;
}
function workflow(scenario,port) {
  assert.ok(CASES.includes(scenario));assert.ok(Number.isInteger(port)&&port>0&&port<65536);
  const nodes=[{name:'Manual fixture',type:'n8n-nodes-base.manualTrigger',typeVersion:1,parameters:{}},
    {name:'Fixture request',type:'n8n-nodes-base.code',typeVersion:2,parameters:{mode:'runOnceForAllItems',jsCode:
      'const end=Date.now()-1000; return [{json:{query:{workflowId:"Kj0Bm4Q2XnRtKsn1",status:"error",startedAfter:new Date(end-3600000).toISOString(),startedBefore:new Date(end).toISOString()}}}];'}}];
  for(const id of ['guard','read','project']) {
    const [,,type,version,config]=definitions.find(d=>d[0]===id);
    const n={...expressions(copy(config)),type,typeVersion:version};
    delete n.credentials;
    if(id==='guard')n.parameters.jsCode=n.parameters.jsCode.replace('throw new Error("Dedicated Header Auth setup incomplete");\n','');
    if(id==='read') {
      n.parameters.url=`http://127.0.0.1:${port}/${scenario}`;
      n.parameters.authentication='none';delete n.parameters.nodeCredentialType;
    }
    nodes.push(n);
  }
  nodes.forEach((n,i)=>{n.id='fixture-'+i;n.position=[i*240,0];});
  const connections={};for(let i=0;i<nodes.length-1;i++)connections[nodes[i].name]={main:[[{node:nodes[i+1].name,type:'main',index:0}]]};
  return {id:'gatewayfixture'+CASES.indexOf(scenario),name:'Local gateway fixture '+scenario,active:false,nodes,connections,
    settings:{executionOrder:'v1',saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,executionTimeout:30}};
}

async function run(installation) {
  assert.equal(process.platform,'darwin','This runner requires the reviewed macOS network sandbox');
  const version=JSON.parse(fs.readFileSync(path.join(installation,'node_modules/n8n/package.json'))).version;
  assert.equal(version,'2.46.6','Review a changed runtime before using this fixture');
  assert.equal(Number(process.versions.node.split('.')[0]),24,'Use the existing Node24 native modules');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gateway-native-fixtures-'));
  const profile=path.join(root,'loopback.sb');
  fs.writeFileSync(profile,'(version 1) (allow default) (deny network*) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:*"))');
  const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root,N8N_USER_FOLDER:path.join(root,'state'),
    DB_TYPE:'sqlite',N8N_DIAGNOSTICS_ENABLED:'false',N8N_VERSION_NOTIFICATIONS_ENABLED:'false',N8N_TEMPLATES_ENABLED:'false',
    N8N_LICENSE_AUTO_RENEW_ENABLED:'false',N8N_RUNNERS_MODE:'internal',N8N_RUNNERS_BROKER_LISTEN_ADDRESS:'127.0.0.1',
    N8N_RUNNERS_BROKER_PORT:'15783',N8N_LOG_LEVEL:'info',N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS:'true'};
  const cli=(args)=>new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/sandbox-exec',['-f',profile,process.execPath,path.join(installation,'node_modules/n8n/bin/n8n'),...args],{env,stdio:['ignore','pipe','pipe']});
    let out='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Fixture CLI deadline'));},60000);
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);child.on('error',reject);
    child.on('exit',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error('Fixture CLI failed: '+out.slice(-1200)));});
  });
  let current,requests=[],sourceFailure;
  const server=http.createServer((req,res)=>{
    try {
      const u=new URL(req.url,'http://127.0.0.1');assert.equal(req.method,'GET');assert.equal(u.pathname,'/'+current);
      assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['x-n8n-api-key'],undefined);
      const q=u.searchParams;assert.equal(q.get('workflowId'),'Kj0Bm4Q2XnRtKsn1');assert.equal(q.get('status'),'error');
      assert.equal(q.get('includeData'),'false');assert.equal(q.get('limit'),'100');
      assert.ok([...q.keys()].every(k=>['workflowId','status','startedAfter','startedBefore','includeData','limit','cursor'].includes(k)));
      const cursor=q.get('cursor');const page=requests.length;assert.ok(page<20);
      assert.equal(cursor,page===0?null:'page'+page);requests.push({page:page+1,cursor});
      res.setHeader('Content-Type','application/json');
      if(current==='source-503'||(current==='second-page-503'&&page===1)) {
        res.writeHead(503);res.end(JSON.stringify({error:'SYNTHETIC_PRIVATE_SOURCE_ERROR'}));return;
      }
      const stamp=new Date((Date.parse(q.get('startedAfter'))+Date.parse(q.get('startedBefore')))/2).toISOString();
      const row=id=>({id:String(id),workflowId:q.get('workflowId'),status:q.get('status'),startedAt:stamp,data:{prompt:'SYNTHETIC_PRIVATE_PAYLOAD'}});
      const count=current==='multipage'&&page===0?100:1;
      const data=Array.from({length:count},(_,i)=>row(current==='duplicate-row'?1:page*100+i+1));
      const more=current==='page-cap'||(['multipage','second-page-503','duplicate-row'].includes(current)&&page===0);
      res.end(JSON.stringify({data,nextCursor:more?'page'+(page+1):null}));
    }catch(e){sourceFailure=e;res.writeHead(500).end();}
  });
  const results=[];
  try {
    const probe=spawnSync('/usr/bin/sandbox-exec',['-f',profile,process.execPath,'-e',
      'const s=require("net").connect({host:"192.0.2.1",port:9});s.on("connect",()=>process.exit(2));s.on("error",e=>process.exit(e.code==="EPERM"?0:3));setTimeout(()=>process.exit(4),1000);'],{env,timeout:2000});
    assert.equal(probe.status,0,'OS sandbox must refuse non-loopback networking');
    await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
    for(const scenario of CASES) {
      current=scenario;requests=[];sourceFailure=undefined;
      const w=workflow(scenario,server.address().port),file=path.join(root,scenario+'.json');fs.writeFileSync(file,JSON.stringify(w));
      await cli(['import:workflow','--input='+file]);
      const raw=await cli(['execute','--id='+w.id,'--rawOutput']);
      if(sourceFailure)throw sourceFailure;
      const start=raw.indexOf('{\n  "data":');assert.ok(start>=0,'Missing execution output: '+raw.slice(-1800));
      const execution=JSON.parse(raw.slice(start));assert.equal(execution.data.resultData.error,undefined);
      const data=execution.data.resultData.runData;
      const out=data['Return complete safe metadata'][0].data.main[0][0].json;
      const expected={nonempty:[200,1,1],multipage:[200,101,2],'source-503':[503,null,1],'second-page-503':[503,null,2],'page-cap':[503,null,20],'duplicate-row':[503,null,2]}[scenario];
      assert.equal(out.reply_code,expected[0],scenario);assert.equal(requests.length,expected[2],scenario);
      if(out.reply_code===200) {
        assert.equal(out.reply_body.count,expected[1]);assert.equal(out.reply_body.complete,true);
        assert.equal(out.reply_body.data.length,expected[1]);
        assert.equal(new Set(out.reply_body.data.map(x=>x.id)).size,expected[1]);
        for(const r of out.reply_body.data)assert.deepEqual(Object.keys(r).sort(),['id','workflowId','status','startedAt'].sort());
      } else assert.deepEqual(out.reply_body,{schema_version:1,error:'metadata_unavailable'});
      assert.ok(!JSON.stringify(out).includes('SYNTHETIC_PRIVATE'));
      results.push({scenario,passed:true,reply_code:out.reply_code,count:out.reply_body.count??null,source_requests:requests.length});
      console.log(JSON.stringify(results.at(-1)));
    }
    return {schema_version:1,runtime_version:version,node_version:process.versions.node,network:'OS loopback only',egress_denial_verified:true,synthetic:true,live_gateway_modified:false,results};
  } finally {
    await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});
  }
}
if(require.main===module)run(process.argv[2]||'').then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={workflow,CASES};
