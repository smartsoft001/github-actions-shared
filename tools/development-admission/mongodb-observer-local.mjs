// Opt-in isolated integration. Explicit existing binary/driver required; no download.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url);
const {mongoPort,ingest,observe,DATABASE,COLLECTIONS}=require('./mongodb-observer.cjs');
const {specification}=require('./mongodb-observer-schema.cjs');
const {MONITOR,hash}=require('./external-observer-protocol.cjs');
const {prepare,initialize}=require('./mongodb-observer-initialize.cjs');
const {inspectCompass,initializeCompass}=require('./mongodb-observer-compass.cjs');
if(!process.env.OBSERVER_TEST_MONGOD||!process.env.OBSERVER_TEST_MONGODB_DRIVER)throw Error('Explicit local mongod binary and driver path required');
const {MongoClient}=require(process.env.OBSERVER_TEST_MONGODB_DRIVER);
const dir=await mkdtemp(join(tmpdir(),'observer-mongo-'));
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const proc=spawn(process.env.OBSERVER_TEST_MONGOD,['--dbpath',dir,'--port',String(port),'--bind_ip','127.0.0.1','--nounixsocket','--auth','--logpath',join(dir,'mongod.log')],{stdio:'ignore'});
let spawnError;proc.on('error',e=>{spawnError=e;});
const options={retryReads:false,retryWrites:false,serverSelectionTimeoutMS:1000,socketTimeoutMS:3000};
const clients=[];let checks=0;
const check=(value)=>{assert.ok(value);checks++;};
const pwd=randomBytes(32).toString('hex');
const url=user=>`mongodb://${user?`${user}:${pwd}@`:''}127.0.0.1:${port}/${user==='root'?'admin':DATABASE}`;
const open=async(user)=>{const c=new MongoClient(url(user),options);clients.push(c);await c.connect();return c;};
try{
  let bootstrap;
  for(let i=0;i<40;i++){if(spawnError)throw spawnError;try{bootstrap=await open('');break;}catch{await delay(100);}}
  assert.ok(bootstrap,'Local MongoDB startup');
  await bootstrap.db('admin').command({createUser:'root',pwd,roles:['root']});await bootstrap.close();
  const admin=await open('root'),db=admin.db(DATABASE),binding='b'.repeat(64);
  const collection=name=>db.collection(COLLECTIONS[name]);
  await db.collection('unrelated_fixture').insertOne({_id:'preserve',value:'unchanged'});
  const namespace=await collection('registry').aggregate([{$collStats:{}},{$project:{_id:0,namespace_matches:{$eq:['$ns',DATABASE+'.registry']}}}]).toArray();
  check(namespace.length===1&&namespace[0].namespace_matches===true);
  check(!(await db.listCollections({name:COLLECTIONS.registry}).toArray()).length);
  const spec=specification(binding,new Date(Date.now()-190000),'manual-test');
  const proposal=await prepare(db,{binding,baseline:spec.seeds.registry.observe_since});
  const shellDb={getName:()=>db.databaseName,runCommand:db.command.bind(db)};
  check((await inspectCompass(shellDb,proposal)).write_attempted===false);
  check((await initializeCompass(shellDb,proposal)).write_attempted===false);
  check((await initialize(db,proposal)).write_attempted===false);
  check((await initializeCompass(shellDb,proposal,{approved:true,planSha256:proposal.plan_sha256})).action==='initialized-disabled');
  const seeded=await collection('registry').findOne({_id:MONITOR});
  check(seeded.scope==='production'&&seeded.enabled===false);
  check((await initialize(db,proposal,{approved:true,planSha256:proposal.plan_sha256})).action==='initialization-refused');
  check(JSON.stringify(await collection('registry').findOne({_id:MONITOR}))===JSON.stringify(seeded));
  // Only the fixture administrator switches the local acceptance scope.
  await collection('registry').updateOne({_id:MONITOR},{$set:{scope:'manual-test'}});
  for(const role of spec.roles)await db.command({createRole:role.role,privileges:role.privileges,roles:[]});
  for(const [user,role] of [['ingress','development_observer_ingress'],['watch','development_observer_watch']])await db.command({createUser:user,pwd,roles:[{role,db:DATABASE}]});
  const ingress=mongoPort(await open('ingress')),watch=mongoPort(await open('watch'));
  const manual={allowManualTest:true};let sends=0;
  const sender=async()=>{sends++;return {status:1,request:'synthetic-receipt-0001'};};
  const concurrent=await Promise.all(Array.from({length:6},()=>observe(watch,sender,manual)));
  check(sends===1&&concurrent.filter(x=>x.delivery==='provider-accepted').length===1);
  check((await observe(watch,sender,manual)).action==='already-attempted');
  check(await collection('notices').countDocuments()===1&&await collection('receipts').countDocuments()===1);
  const now=Date.now()/1000;
  const packet={schema_version:1,monitor_id:MONITOR,binding_sha256:binding,sequence:1,cycle_id:'c'.repeat(32),cycle_finished_at:now-2,sent_at:now,monitor:'alive',delivery:'idle-unverified',issues:[]};
  check((await ingest(ingress,packet,manual)).action==='heartbeat-recorded');
  const first=await collection('heartbeats').findOne({_id:MONITOR});
  check((await ingest(ingress,packet,manual)).action==='duplicate-no-refresh');
  check((await collection('heartbeats').findOne({_id:MONITOR})).heartbeat.received_at.getTime()===first.heartbeat.received_at.getTime());
  check((await ingest(ingress,{...packet,delivery:'pending'},manual)).action==='sequence-conflict');
  check((await ingest(ingress,{...packet,sequence:2},manual)).action==='cycle-replay-refused');
  check((await observe(watch,sender,manual)).action==='no-alert');
  for(const [store,collection,operation] of [[ingress,'registry','update'],[watch,'registry','update'],[ingress,'reservations','update'],[watch,'notices','update'],[watch,'notices','delete'],[watch,'receipts','update'],[watch,'receipts','delete']]){
    await assert.rejects(()=>operation==='delete'?store.collection(collection).deleteMany({}):store.collection(collection).updateOne({},{$set:{forbidden:true}}),e=>e.code===13);checks++;
  }
  await assert.rejects(()=>collection('registry').updateOne({_id:MONITOR},{$set:{enabled:true}}),e=>e.code===121);checks++;
  await collection('registry').updateOne({_id:MONITOR},{$set:{scope:'production'}});
  check((await ingest(ingress,packet,manual)).action==='ingress-disabled');
  check((await observe(watch,sender,manual)).action==='observer-disabled');
  await collection('registry').updateOne({_id:MONITOR},{$set:{scope:'manual-test'}});
  // Source stopped: verify freshness against Mongo's clock, not a new sender timestamp.
  const stale={...packet,cycle_finished_at:now-202,sent_at:now-200};
  await collection('heartbeats').updateOne({_id:MONITOR},{$set:{heartbeat:{packet:stale,packet_sha256:hash(stale),received_at:new Date((now-200)*1000)}}});
  check((await observe(watch,sender,manual)).action==='cooldown');
  // Isolated reset by fixture admin only: lost provider reply remains reserved.
  await collection('reservations').updateOne({_id:MONITOR},{$set:{last_attempt:null}});
  await collection('notices').deleteMany({});await collection('receipts').deleteMany({});
  const lost=await observe(watch,async()=>{sends++;throw Error('SYNTHETIC_LOST_REPLY');},manual);
  check(lost.delivery==='unknown'&&lost.reason_code==='provider-transport-unconfirmed'
    &&(await observe(watch,sender,manual)).action==='already-attempted'&&sends===2);
  // Inject failure after the real MongoDB insert to model a lost write response.
  await collection('reservations').updateOne({_id:MONITOR},{$set:{last_attempt:null}});
  await collection('notices').deleteMany({});
  const lostWriteReply={collection:name=>{
    const target=watch.collection(name);
    return name==='receipts'?{
      findOne:target.findOne.bind(target),
      insertOne:async(...args)=>{await target.insertOne(...args);throw Error('SYNTHETIC_LOST_WRITE_REPLY');},
    }:target;
  }};
  let writeReplySends=0;
  const recovered=await observe(lostWriteReply,async()=>{
    writeReplySends++;return {status:1,request:'synthetic-write-reply-0001'};
  },manual);
  check(recovered.delivery==='provider-accepted'&&recovered.reason_code===undefined);
  check((await observe(watch,()=>assert.fail('duplicate send'),manual)).action==='already-attempted'&&writeReplySends===1);
  check(await collection('receipts').countDocuments()===1);
  await collection('receipts').deleteMany({});
  // Committed reservation, unknown audit append: never send or steal it on retry.
  await collection('reservations').updateOne({_id:MONITOR},{$set:{last_attempt:null}});
  await collection('notices').deleteMany({});
  const failingAudit={collection:name=>name==='notices'?{insertOne:async()=>{throw Error('SYNTHETIC_AUDIT_UNKNOWN');}}:watch.collection(name)};
  check((await observe(failingAudit,sender,manual)).action==='observer-state-unavailable');
  check((await observe(watch,sender,manual)).action==='already-attempted'&&sends===2);
  // Corrupted stored content cannot be accepted as healthy or trigger a sender.
  await collection('heartbeats').updateOne({_id:MONITOR},{$set:{'heartbeat.packet_sha256':'d'.repeat(64)}});
  check((await observe(watch,sender,manual)).action==='observer-state-unavailable'&&sends===2);
  await collection('heartbeats').deleteOne({_id:MONITOR});
  check((await ingest(ingress,packet,manual)).action==='heartbeat-refused');
  check((await observe(watch,sender,manual)).action==='observer-state-unavailable');
  check(await collection('heartbeats').countDocuments()===0&&sends===2);
  check((await db.collection('unrelated_fixture').findOne({_id:'preserve'})).value==='unchanged');
  const scoped=await open('watch');
  await assert.rejects(()=>scoped.db(DATABASE).collection('unrelated_fixture').findOne({}),e=>e.code===13);checks++;
  // Destructive resets below affect only this ephemeral fixture, never initializer code.
  for(const name of Object.values(COLLECTIONS))await db.collection(name).drop();
  const race=await Promise.all([initialize(db,proposal,{approved:true,planSha256:proposal.plan_sha256}),initialize(db,proposal,{approved:true,planSha256:proposal.plan_sha256})]);
  check(race.filter(x=>x.action==='initialized-disabled').length===1);
  check((await collection('registry').findOne({_id:MONITOR})).enabled===false);
  check(await collection('notices').countDocuments()===0&&await collection('receipts').countDocuments()===0);
  for(const name of Object.values(COLLECTIONS))await db.collection(name).drop();
  const uncertain={databaseName:db.databaseName,listCollections:db.listCollections.bind(db),createCollection:db.createCollection.bind(db),
    collection:name=>({insertOne:async(doc,opts)=>{await db.collection(name).insertOne(doc,opts);throw Error('LOST_SEED_ACK');}})};
  check((await initialize(uncertain,proposal,{approved:true,planSha256:proposal.plan_sha256})).action==='initialization-uncertain-manual-review');
  check((await collection('registry').findOne({_id:MONITOR})).enabled===false);
  check((await initialize(db,proposal,{approved:true,planSha256:proposal.plan_sha256})).action==='initialization-refused');
  check((await db.listCollections({name:{$in:Object.values(COLLECTIONS)}}).toArray()).length===1);
  // Exercise the concrete disabled proposal, never real runtime enablement.
  await collection('registry').drop();
  const candidate=require('./observer-production-initialization-plan.json');
  check((await initializeCompass(shellDb,candidate,{approved:true,planSha256:candidate.plan_sha256})).action==='initialized-disabled');
  const candidateSeed=await collection('registry').findOne({_id:MONITOR});
  check(candidateSeed.binding_sha256===candidate.binding_sha256&&candidateSeed.enabled===false&&candidateSeed.scope==='production');
  check((await observe(watch,sender,manual)).action==='observer-disabled'&&sends===2);
  console.log(JSON.stringify({schema_version:1,result:'passed',database:'ephemeral-loopback-only',checks,authenticated_roles:2,parallel_observers:6,synthetic_sender_calls:sends+writeReplySends,real_provider_calls:0,cloud_connections:0,model_calls:0,production_changes:0}));
}finally{
  await Promise.allSettled(clients.map(c=>c.close()));
  if(proc.exitCode===null&&proc.pid){proc.kill('SIGTERM');await Promise.race([new Promise(r=>proc.once('exit',r)),delay(10000).then(()=>{if(proc.exitCode===null)proc.kill('SIGKILL');})]);}
  await rm(dir,{recursive:true,force:true});
}
