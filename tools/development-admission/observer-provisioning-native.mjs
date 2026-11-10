// Disposable native PG+n8n compatibility test; never accepts a production URL.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import net from 'node:net';
const require=createRequire(import.meta.url);
const provision=require('./observer-provisioning.cjs');
const preflight=require('./build-observer-db-preflight.cjs');
assert.equal(process.argv.length,4,'Pass existing embedded-postgres and n8n installations only');
assert.equal(process.platform,'darwin');assert.equal(Number(process.versions.node.split('.')[0]),24);
const pgInstall=resolve(process.argv[2]),n8nInstall=resolve(process.argv[3]);
assert.equal(JSON.parse(await readFile(join(pgInstall,'node_modules/embedded-postgres/package.json'),'utf8')).version,'18.6.0-beta.19');
assert.equal(JSON.parse(await readFile(join(n8nInstall,'node_modules/n8n/package.json'),'utf8')).version,'2.46.6');
const Embedded=(await import(pathToFileURL(join(pgInstall,'node_modules/embedded-postgres/dist/index.js')).href)).default;
const {Pool}=require(join(pgInstall,'node_modules/pg'));
async function freePort(){const server=net.createServer();await new Promise((ok,bad)=>server.listen(0,'127.0.0.1',ok).once('error',bad));const port=server.address().port;await new Promise(ok=>server.close(ok));return port;}
const root=await mkdtemp(join(tmpdir(),'observer-provisioning-native-')),port=await freePort(),broker=await freePort();
const secret=randomBytes(24).toString('hex');
const cluster=new Embedded({databaseDir:join(root,'pg'),user:'postgres',password:secret,port,persistent:true,
  createPostgresUser:false,postgresFlags:['-c','listen_addresses=127.0.0.1'],onLog:()=>{},onError:()=>{}});
const profile=join(root,'loopback.sb');
await writeFile(profile,'(version 1) (allow default) (deny network*) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:*"))',{mode:0o600});
const env={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:root,N8N_USER_FOLDER:join(root,'n8n'),
  DB_TYPE:'sqlite',N8N_DIAGNOSTICS_ENABLED:'false',N8N_VERSION_NOTIFICATIONS_ENABLED:'false',
  N8N_TEMPLATES_ENABLED:'false',N8N_LICENSE_AUTO_RENEW_ENABLED:'false',N8N_RUNNERS_MODE:'internal',
  N8N_RUNNERS_BROKER_LISTEN_ADDRESS:'127.0.0.1',N8N_RUNNERS_BROKER_PORT:String(broker),N8N_LOG_LEVEL:'info'};
const cli=(args,allowFailure=false)=>new Promise((ok,bad)=>{
  const child=spawn('/usr/bin/sandbox-exec',['-f',profile,process.execPath,join(n8nInstall,'node_modules/n8n/bin/n8n'),...args],{env,stdio:['ignore','pipe','pipe']});
  let text='';const timer=setTimeout(()=>{child.kill('SIGKILL');bad(Error('Native preflight deadline'));},60000);
  child.stdout.on('data',x=>text+=x);child.stderr.on('data',x=>text+=x);child.on('error',bad);
  child.on('exit',code=>{clearTimeout(timer);code===0||allowFailure?ok(text):bad(Error('Native CLI failed (output withheld; synthetic credentials private)'));});
});
function execution(raw){
  const start=raw.indexOf('{\n  "data":');assert.ok(start>=0,'Missing native execution receipt');
  let level=0,string=false,escape=false;
  for(let i=start;i<raw.length;i++){
    const c=raw[i];
    if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;}
    else if(c==='"')string=true;else if(c==='{')level++;else if(c==='}'&&--level===0)return JSON.parse(raw.slice(start,i+1));
  }
  throw Error('Incomplete native execution receipt');
}
let clusterStarted=false,admin,dedicated;const pools=[],results=[];
const check=(name,value)=>{assert.ok(value,name);results.push({name,passed:true});};
async function rejected(pool,sql){const c=await pool.connect();try{await assert.rejects(c.query(sql));}finally{await c.query('ROLLBACK');c.release();}}
try {
  await cluster.initialise();await cluster.start();clusterStarted=true;
  const cfg={host:'127.0.0.1',port,user:'postgres',password:secret,connectionTimeoutMillis:2000,max:1};
  admin=new Pool({...cfg,database:'postgres'});
  await rejected(admin,provision.build());check('wrong database refuses before provisioning',true);
  await admin.query('CREATE DATABASE '+provision.DATABASE);
  dedicated=new Pool({...cfg,database:provision.DATABASE});
  await dedicated.query('CREATE TABLE public.synthetic_unrelated (id int)');
  await rejected(dedicated,provision.build());check('nonempty schema is not overwritten',true);
  await dedicated.query('DROP TABLE public.synthetic_unrelated');
  await dedicated.query(provision.build());check('fresh dedicated database provisioned transactionally',true);
  const roles=(await dedicated.query('SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])',[[provision.OWNER,provision.INGRESS,provision.WATCH]])).rows;
  check('all three roles initially NOLOGIN and unprivileged',roles.length===3&&roles.every(r=>!r.rolcanlogin&&!r.rolsuper&&!r.rolcreatedb&&!r.rolcreaterole&&!r.rolreplication&&!r.rolbypassrls));
  await rejected(dedicated,provision.build());check('rerun refuses without resetting existing state',true);
  const passwords=[randomBytes(24).toString('hex'),randomBytes(24).toString('hex')];
  const identities=[provision.INGRESS,provision.WATCH];
  const creds=[];
  for(let i=0;i<2;i++){
    // LOGIN/password assignment is test-only, inside this disposable cluster.
    await dedicated.query(`ALTER ROLE ${identities[i]} LOGIN PASSWORD '${passwords[i]}'`);
    const pool=new Pool({...cfg,database:provision.DATABASE,user:identities[i],password:passwords[i]});pools.push(pool);
    const row=(await pool.query(provision.readiness(identities[i]))).rows[0];
    check(identities[i]+' exact permissions',Object.values(row).every(x=>x===true));
    creds.push({id:'synthetic-observer-'+i,name:'Synthetic observer '+i,type:'postgres',data:{host:'127.0.0.1',port,database:provision.DATABASE,user:identities[i],password:passwords[i],ssl:'disable',allowUnauthorizedCerts:false,maxConnections:1,sshTunnel:false}});
  }
  const nodes=preflight.definitions.map(([id,,type,typeVersion,config],index)=>({id:'fixture-'+id,type,typeVersion,...JSON.parse(JSON.stringify(config)),position:[index*200,0]}));
  nodes[0].disabled=false;
  nodes[1].parameters.jsCode='return [{json:{synthetic:true}}];';
  nodes.find(n=>n.name==='Inspect ingress privileges').credentials={postgres:{id:creds[0].id,name:creds[0].name}};
  nodes.find(n=>n.name==='Inspect observer privileges').credentials={postgres:{id:creds[1].id,name:creds[1].name}};
  const connections={};for(let i=0;i<nodes.length-1;i++)connections[nodes[i].name]={main:[[{node:nodes[i+1].name,type:'main',index:0}]]};
  const workflow={id:'observerdbfixture',name:'Synthetic native observer DB readiness',active:false,nodes,connections,settings:{executionOrder:'v1',saveManualExecutions:false,saveDataSuccessExecution:'none',saveDataErrorExecution:'none',executionTimeout:30}};
  const workflowFile=join(root,'workflow.json'),credentialFile=join(root,'credentials.json');
  await writeFile(workflowFile,JSON.stringify(workflow),{mode:0o600});await writeFile(credentialFile,JSON.stringify(creds),{mode:0o600});
  await cli(['import:workflow','--input='+workflowFile]);await cli(['import:credentials','--input='+credentialFile]);
  const raw=await cli(['execute','--id='+workflow.id,'--rawOutput']);
  const result=execution(raw);assert.equal(result.data.resultData.error,undefined);
  const summary=result.data.resultData.runData['Observer DB readiness receipt'][0].data.main[0][0].json;
  check('native Postgres2.7 nodes verify both scoped credentials',summary.ingress_verified===true&&summary.observer_verified===true&&summary.write_operations===0&&summary.activated===false);
  const wrong=JSON.parse(JSON.stringify(workflow));wrong.id='observerdbwrongfixture';
  wrong.nodes.find(n=>n.name==='Inspect ingress privileges').credentials={postgres:{id:creds[1].id,name:creds[1].name}};
  const wrongFile=join(root,'wrong-workflow.json');await writeFile(wrongFile,JSON.stringify(wrong),{mode:0o600});
  await cli(['import:workflow','--input='+wrongFile]);
  const wrongResult=execution(await cli(['execute','--id='+wrong.id,'--rawOutput'],true));
  check('native assertion refuses swapped credentials before next DB node',
    wrongResult.data.resultData.lastNodeExecuted==='Assert ingress scope'&&!!wrongResult.data.resultData.error&&!wrongResult.data.resultData.runData['Inspect observer privileges']);
  const blocked=JSON.parse(JSON.stringify(workflow));blocked.id='observerdbguardfixture';
  blocked.nodes.find(n=>n.name==='Require approved access bindings').parameters.jsCode=preflight.GUARD;
  const blockedFile=join(root,'blocked-workflow.json');await writeFile(blockedFile,JSON.stringify(blocked),{mode:0o600});
  await cli(['import:workflow','--input='+blockedFile]);
  const blockedResult=execution(await cli(['execute','--id='+blocked.id,'--rawOutput'],true));
  check('native preparation guard stops before any database node',
    blockedResult.data.resultData.lastNodeExecuted==='Require approved access bindings'&&!!blockedResult.data.resultData.error&&!blockedResult.data.resultData.runData['Inspect ingress privileges']);
  check('native preflight did not seed or enable registry',(await dedicated.query('SELECT COUNT(*)::int AS n FROM public.development_observer_registry')).rows[0].n===0);
  console.log(JSON.stringify({schema_version:1,synthetic:true,postgres:'18.6',n8n:'2.46.6',node:process.versions.node,results,
    production_connections:0,live_credentials_created:0,real_provider_calls:0,model_calls:0,published:false,runtime_activated:false}));
} finally {
  for(const pool of pools)await pool.end();
  if(dedicated)await dedicated.end();if(admin)await admin.end();
  if(clusterStarted)await cluster.stop();await rm(root,{recursive:true,force:true});
}
