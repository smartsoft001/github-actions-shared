// Opt-in integration against a newly initialized loopback-only PostgreSQL.
// No connection URL, production credentials or runtime options are accepted.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import net from 'node:net';
const require=createRequire(import.meta.url);
const observer=require('./external-observer.cjs');
const installation=resolve(process.argv[2]||'');
assert.equal(process.argv.length,3,'Pass only a pre-existing embedded-postgres installation');
assert.equal(JSON.parse(await readFile(join(installation,'node_modules/embedded-postgres/package.json'),'utf8')).version,'18.6.0-beta.19');
const EmbeddedPostgres=(await import(pathToFileURL(join(installation,'node_modules/embedded-postgres/dist/index.js')).href)).default;
const {Pool}=require(join(installation,'node_modules/pg'));
const directory=await mkdtemp(join(tmpdir(),'external-observer-pg-'));
const listener=net.createServer();await new Promise((ok,bad)=>listener.listen(0,'127.0.0.1',ok).once('error',bad));
const port=listener.address().port;await new Promise(ok=>listener.close(ok));
const password=randomBytes(24).toString('hex');
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'pg'),user:'postgres',password,port,
  persistent:true,createPostgresUser:false,postgresFlags:['-c','listen_addresses=127.0.0.1'],onLog:()=>{},onError:()=>{}});
let pool,ingressPool,watchPool,started=false;const results=[];
const check=(name,condition)=>{assert.ok(condition,name);results.push({name,passed:true});};
try {
  await cluster.initialise();await cluster.start();started=true;
  pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',connectionTimeoutMillis:2000,max:8});
  const here=dirname(fileURLToPath(import.meta.url));
  await pool.query(await readFile(join(here,'external-observer.sql'),'utf8'));
  const ingressPassword=randomBytes(24).toString('hex'),watchPassword=randomBytes(24).toString('hex');
  await pool.query(`CREATE ROLE observer_ingress LOGIN PASSWORD '${ingressPassword}'`);
  await pool.query(`CREATE ROLE observer_watch LOGIN PASSWORD '${watchPassword}'`);
  await pool.query('GRANT SELECT ON development_observer_registry TO observer_ingress,observer_watch');
  await pool.query('GRANT SELECT,INSERT,UPDATE ON development_observer_latest TO observer_ingress');
  await pool.query('GRANT SELECT ON development_observer_latest,development_observer_notices TO observer_watch');
  await pool.query('GRANT INSERT(notice_id,monitor_id,status),UPDATE(status,request_id) ON development_observer_notices TO observer_watch');
  const settings={host:'127.0.0.1',port,database:'postgres',connectionTimeoutMillis:2000,max:8};
  ingressPool=new Pool({...settings,user:'observer_ingress',password:ingressPassword});
  watchPool=new Pool({...settings,user:'observer_watch',password:watchPassword});
  const ingressDb=observer.postgresPort(ingressPool),watchDb=observer.postgresPort(watchPool);
  await assert.rejects(ingressPool.query('UPDATE development_observer_registry SET enabled=true'),e=>e.code==='42501');
  await assert.rejects(watchPool.query('UPDATE development_observer_registry SET enabled=true'),e=>e.code==='42501');
  check('runtime roles cannot change activation flags',true);
  await assert.rejects(watchPool.query('DELETE FROM development_observer_notices'),e=>e.code==='42501');
  await assert.rejects(watchPool.query('UPDATE development_observer_notices SET attempted_at=clock_timestamp()'),e=>e.code==='42501');
  check('observer role cannot delete or backdate reservations',true);
  const python=process.env.OBSERVER_TEST_PYTHON||'python3';
  const demo=JSON.parse(execFileSync(python,[join(here,'heartbeat-offline.py')],{encoding:'utf8',
    env:{PATH:process.env.PATH,HOME:directory,PYTHONDONTWRITEBYTECODE:'1'},timeout:10000}));
  assert.equal(demo.synthetic,true);assert.equal(demo.scope,'manual-test');
  const p=demo.packet,options={allowManualTest:true};
  await pool.query(`INSERT INTO development_observer_registry
    (monitor_id,scope,binding_sha256,observe_since) VALUES ($1,'manual-test',$2,$3)`,
    [observer.MONITOR,p.binding_sha256,new Date((p.cycle_finished_at-10)*1000)]);
  check('disabled default', (await observer.ingest(ingressDb,p)).action==='ingress-disabled');
  check('Python exporter to actual PostgreSQL', (await observer.ingest(ingressDb,p,options)).action==='heartbeat-recorded');
  const before=(await pool.query('SELECT received_at FROM development_observer_latest')).rows[0].received_at.getTime();
  check('duplicate does not refresh receipt', (await observer.ingest(ingressDb,p,options)).action==='duplicate-no-refresh');
  assert.equal((await pool.query('SELECT received_at FROM development_observer_latest')).rows[0].received_at.getTime(),before);
  check('same sequence with changed content refuses',(await observer.ingest(ingressDb,{...p,delivery:'pending'},options)).action==='sequence-conflict');
  check('new sequence cannot replay old cycle',(await observer.ingest(ingressDb,{...p,sequence:2},options)).action==='cycle-replay-refused');
  let sends=0;
  const send=async()=>{sends++;return {status:1,request:'synthetic-provider-receipt'};};
  check('fresh heartbeat does not send',(await observer.observe(watchDb,send,options)).action==='no-alert');
  const digest=(await pool.query('SELECT packet_sha256 FROM development_observer_latest')).rows[0].packet_sha256;
  await pool.query('UPDATE development_observer_latest SET packet_sha256=$1',['0'.repeat(64)]);
  check('corrupt stored heartbeat is never healthy',(await observer.observe(watchDb,send,options)).action==='observer-state-unavailable'&&sends===0);
  await pool.query('UPDATE development_observer_latest SET packet_sha256=$1',[digest]);
  // Make a real failed-cycle packet; this is synthetic fixture data only.
  const bad={...p,sequence:2,cycle_id:'f'.repeat(32),cycle_finished_at:p.cycle_finished_at+0.001,
    sent_at:Date.now()/1000,monitor:'unknown',issues:['cycle-failed']};
  check('new failure heartbeat recorded',(await observer.ingest(ingressDb,bad,options)).action==='heartbeat-recorded');
  const concurrent=await Promise.all(Array.from({length:6},()=>observer.observe(watchDb,send,options)));
  check('six actual PG transactions reserve one alert',sends===1&&concurrent.filter(x=>x.action==='attempted-once').length===1);
  check('receipt persisted before next observer',(await pool.query("SELECT COUNT(*)::int AS n FROM development_observer_notices WHERE status='accepted'")).rows[0].n===1);
  // Distinct issue cannot bypass the global30minute cooldown.
  const worse={...bad,sequence:3,cycle_id:'e'.repeat(32),cycle_finished_at:bad.cycle_finished_at+0.001,
    issues:['cycle-failed','delivery-unconfirmed']};
  check('changed incident heartbeat recorded',(await observer.ingest(ingressDb,worse,options)).action==='heartbeat-recorded');
  check('changed incident respects cooldown',(await observer.observe(watchDb,send,options)).action==='cooldown'&&sends===1);
  check('old sequence cannot replace newer heartbeat',(await observer.ingest(ingressDb,p,options)).action==='old-sequence-refused');
  const oldReceived=(await pool.query('SELECT received_at FROM development_observer_latest')).rows[0].received_at.getTime()/1000-181;
  const oldPacket=observer.packet({...worse,sent_at:worse.sent_at-181,cycle_finished_at:worse.cycle_finished_at-181},oldReceived,p.binding_sha256);
  await pool.query('UPDATE development_observer_latest SET cycle_finished_at=$1,sent_at=$2,received_at=$3,packet_sha256=$4,packet=$5::jsonb',
    [new Date(oldPacket.cycle_finished_at*1000),new Date(oldPacket.sent_at*1000),new Date(oldReceived*1000),
      createHash('sha256').update(JSON.stringify(oldPacket)).digest('hex'),JSON.stringify(oldPacket)]);
  const stale=await observer.observe(watchDb,send,options);
  check('stopped source expires on observer clock',stale.issues.includes('heartbeat-stale')&&sends===1);
  // Drop primary heartbeat data to simulate complete loss of publisher/host.
  // The observer's PostgreSQL/outbox remains live and on its own clock.
  await pool.query('DELETE FROM development_observer_latest');
  await pool.query("UPDATE development_observer_registry SET observe_since=clock_timestamp()-interval '181 seconds'");
  check('full publisher loss remains visible',(await observer.observe(watchDb,send,options)).action==='cooldown'&&sends===1);
  await pool.query("UPDATE development_observer_notices SET attempted_at=clock_timestamp()-interval '1801 seconds'");
  const loss=await observer.observe(watchDb,async()=>{sends++;throw Error('SYNTHETIC_PRIVATE_TRANSPORT_ERROR');},options);
  check('new outage alert after cooldown is uncertain',loss.action==='attempted-once'&&loss.delivery==='unknown');
  check('uncertain receipt restart does not resend',(await observer.observe(watchDb,send,options)).action==='already-attempted'&&sends===2);
  await assert.rejects(pool.query("UPDATE development_observer_registry SET scope='production',enabled=true"));
  check('SQL activation gates require all acceptance flags',true);
  await pool.query("UPDATE development_observer_registry SET scope='production'");
  check('manual override cannot enable production',(await observer.observe(watchDb,send,options)).action==='observer-disabled'&&sends===2);
  console.log(JSON.stringify({schema_version:1,synthetic:true,postgres:(await pool.query('SHOW server_version')).rows[0].server_version,
    loopback_only:true,python_export_bridge:true,results,fake_provider_calls:sends,real_provider_calls:0,
    human_receipt_verified:false,production_acceptance:false,runtime_activated:false}));
} finally {
  if(ingressPool)await ingressPool.end();
  if(watchPool)await watchPool.end();
  if(pool)await pool.end();
  if(started)await cluster.stop();
  await rm(directory,{recursive:true,force:true});
}
