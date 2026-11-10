'use strict';
// Injected MongoClient only. No connection, credential, schedule or automatic retry.
const {MONITOR,ISSUES,packet,hash,boundedSend}=require('./external-observer-protocol.cjs');
const DATABASE='ai_os_development_observer';
const wc={w:'majority',j:true,wtimeoutMS:3000};
const ro={readConcern:{level:'majority'},maxTimeMS:3000};
const seconds=d=>d instanceof Date?d.getTime()/1000:NaN;
function mongoPort(client){
  if(client.options.retryWrites!==false||client.options.retryReads!==false
      ||!Number.isInteger(client.options.serverSelectionTimeoutMS)||client.options.serverSelectionTimeoutMS<1||client.options.serverSelectionTimeoutMS>5000
      ||!Number.isInteger(client.options.socketTimeoutMS)||client.options.socketTimeoutMS<1||client.options.socketTimeoutMS>10000)throw Error('Bounded no-retry MongoClient required');
  const db=client.db(DATABASE);
  return {collection:name=>db.collection(name)};
}
async function registry(store){
  const r=await store.collection('registry').aggregate([{$match:{_id:MONITOR}},{$set:{observer_now:'$$NOW'}}],ro).next();
  if(!r||!Number.isFinite(seconds(r.observer_now))||!Number.isFinite(seconds(r.observe_since))
      ||r.observe_since>r.observer_now||!['production','manual-test'].includes(r.scope)
      ||!/^[a-f0-9]{64}$/.test(r.binding_sha256))throw Error('Reviewed Mongo registry required');
  return r;
}
const armed=(r,manual)=>(r.scope==='manual-test'&&manual===true)||(r.scope==='production'&&r.enabled===true
  &&r.ingress_verified===true&&r.external_host_verified===true&&r.fallback_verified===true);
function state(doc,r){
  if(!doc||doc._id!==MONITOR||doc.binding_sha256!==r.binding_sha256||!Number.isSafeInteger(doc.revision)||doc.revision<0)
    throw Error('Mongo state missing or mismatched; no automatic recreation');
}
function heartbeat(h,r){
  const p=packet(h.packet,seconds(h.received_at),r.binding_sha256);
  if(hash(p)!==h.packet_sha256)throw Error('Stored Mongo heartbeat mismatch');
  return p;
}
async function ingest(store,input,{allowManualTest=false}={}){
  try{
    const r=await registry(store);if(!armed(r,allowManualTest))return {action:'ingress-disabled'};
    const p=packet(input,seconds(r.observer_now),r.binding_sha256),digest=hash(p),collection=store.collection('heartbeats');
    const doc=await collection.findOne({_id:MONITOR},ro);state(doc,r);
    if(doc.heartbeat){
      const old=heartbeat(doc.heartbeat,r);
      if(p.sequence<old.sequence)return {action:'old-sequence-refused'};
      if(p.sequence===old.sequence)return {action:digest===doc.heartbeat.packet_sha256?'duplicate-no-refresh':'sequence-conflict'};
      if(p.cycle_id===old.cycle_id||p.cycle_finished_at<=old.cycle_finished_at)return {action:'cycle-replay-refused'};
    }
    if(p.cycle_finished_at<seconds(r.observe_since))return {action:'before-reviewed-baseline'};
    const written=await collection.updateOne({_id:MONITOR,revision:doc.revision,binding_sha256:r.binding_sha256},
      [{$set:{revision:{$add:['$revision',1]},heartbeat:{packet:{$literal:p},packet_sha256:{$literal:digest},received_at:'$$NOW'}}}],
      {writeConcern:wc,maxTimeMS:3000});
    return {action:written.acknowledged===true&&written.modifiedCount===1?'heartbeat-recorded':'heartbeat-conflict',sequence:p.sequence};
  }catch{return {action:'heartbeat-refused',healthy:false};}
}
async function observe(store,send,{allowManualTest=false,timeoutMs=10000}={}){
  let grant;
  try{
    const r=await registry(store);if(!armed(r,allowManualTest))return {action:'observer-disabled'};
    const now=seconds(r.observer_now),doc=await store.collection('heartbeats').findOne({_id:MONITOR},ro);state(doc,r);
    const issues=new Set();
    if(!doc.heartbeat){
      if(now-seconds(r.observe_since)<=180)return {action:'awaiting-first-heartbeat',healthy:false};
      issues.add('heartbeat-missing');
    }else{
      const p=heartbeat(doc.heartbeat,r),received=seconds(doc.heartbeat.received_at);
      if(received>now+5)return {action:'observer-clock-untrusted',healthy:false};
      if(now-Math.min(received,p.cycle_finished_at)>180)issues.add('heartbeat-stale');
      for(const reason of p.issues)issues.add(reason);
    }
    if(!issues.size)return {action:'no-alert',heartbeat_fresh:true,human_receipt_verified:false};
    const reasons=[...issues].sort(),id=hash({binding:r.binding_sha256,reasons,window:Math.floor(now/1800)});
    const reservations=store.collection('reservations'),previous=await reservations.findOne({_id:MONITOR},ro);state(previous,r);
    if(previous.last_attempt){
      const at=seconds(previous.last_attempt.at);
      if(!Number.isFinite(at)||at>now)return {action:'observer-clock-untrusted',healthy:false};
      if(previous.last_attempt.notice_id===id)return {action:'already-attempted',issues:reasons};
      if(now-at<1800)return {action:'cooldown',issues:reasons};
    }
    // One-document CAS is the durable grant. It is never upserted or leased/stolen.
    const claim=await reservations.updateOne({_id:MONITOR,revision:previous.revision,binding_sha256:r.binding_sha256},
      [{$set:{revision:{$add:['$revision',1]},last_attempt:{notice_id:{$literal:id},at:'$$NOW'}}}],
      {writeConcern:wc,maxTimeMS:3000});
    if(claim.acknowledged!==true||claim.modifiedCount!==1)return {action:'reservation-conflict',issues:reasons};
    const confirmed=await reservations.findOne({_id:MONITOR,'last_attempt.notice_id':id},ro);
    state(confirmed,r);
    if(confirmed.revision!==previous.revision+1||!confirmed.last_attempt
        ||confirmed.last_attempt.notice_id!==id||!Number.isFinite(seconds(confirmed.last_attempt.at)))throw Error('Unknown reservation write');
    // Separate append-only audit: failure here leaves the CAS grant, never sends.
    const audit=await store.collection('notices').insertOne({_id:id,monitor_id:MONITOR,binding_sha256:r.binding_sha256,
      attempted_at:confirmed.last_attempt.at,issues:reasons},{writeConcern:wc,maxTimeMS:3000});
    if(audit.acknowledged!==true)throw Error('Unknown notice write');
    grant={notice_id:id,route_id:'n8n-pushover-owner',message:'Zewnętrzna kontrola monitora: '+reasons.map(x=>ISSUES[x]).join('; ')+'.',
      url:'https://n8n.smartsoft.biz.pl',automatic_retry:false};
  }catch{return {action:'observer-state-unavailable',healthy:false};}
  let delivery='unknown';
  try{
    const receipt=await boundedSend(send,grant,timeoutMs);
    if(receipt?.status===1&&typeof receipt.request==='string'&&/^[A-Za-z0-9-]{8,100}$/.test(receipt.request)){
      const clock=await registry(store);
      const ack=await store.collection('receipts').insertOne({_id:grant.notice_id,provider_status:1,request:receipt.request,
        acknowledged_at:clock.observer_now},{writeConcern:wc,maxTimeMS:3000});
      if(ack.acknowledged===true)delivery='provider-accepted';
    }
  }catch{/* Unknown delivery or acknowledgement never retries the grant. */}
  return {action:'attempted-once',delivery,human_receipt_verified:false,production_acceptance:false};
}
module.exports={DATABASE,mongoPort,ingest,observe};
