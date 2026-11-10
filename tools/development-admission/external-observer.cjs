'use strict';
// Prepared database/sender ports only. No connections, listener, timer or credentials.
const {MONITOR,ISSUES,packet,hash,boundedSend}=require('./external-observer-protocol.cjs');
const seconds=x=>x instanceof Date?x.getTime()/1000:Number(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const date=x=>new Date(x*1000).toISOString();
function stored(row,r) {
  const received=seconds(row.received_at),p=packet(row.packet,received,r.binding_sha256);
  if(hash(p)!==row.packet_sha256||p.sequence!==Number(row.sequence)||p.cycle_id!==row.cycle_id
      ||Math.abs(p.cycle_finished_at-seconds(row.cycle_finished_at))>0.001
      ||Math.abs(p.sent_at-seconds(row.sent_at))>0.001)throw Error('Stored heartbeat mismatch');
  return p;
}

// Caller injects an already authorized pg Pool. This does not create a DB connection.
function postgresPort(pool) {
  return {transaction:async fn=>{
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SET LOCAL statement_timeout='3s'");
      const result=await fn(client);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }};
}
async function registry(client) {
  // Separate transaction lock avoids granting runtime UPDATE on activation flags.
  await client.query('SELECT pg_advisory_xact_lock(1684368752,1)');
  const {rows}=await client.query('SELECT *,EXTRACT(EPOCH FROM clock_timestamp())::float8 AS observer_now FROM development_observer_registry WHERE monitor_id=$1',[MONITOR]);
  if(rows.length!==1)throw Error('Reviewed observer registry required');
  const r=rows[0];
  if(!finite(r.observer_now)||!finite(seconds(r.observe_since))||seconds(r.observe_since)>r.observer_now)throw Error('Untrusted observer clock');
  return r;
}
function armed(r,manual) {
  return (r.scope==='manual-test'&&manual===true)||(r.scope==='production'&&r.enabled===true
    &&r.ingress_verified===true&&r.external_host_verified===true&&r.fallback_verified===true);
}

async function ingest(db,input,{allowManualTest=false}={}) {
  try{return await db.transaction(async client=>{
    const r=await registry(client);
    if(!armed(r,allowManualTest))return {action:'ingress-disabled'};
    const p=packet(input,r.observer_now,r.binding_sha256),digest=hash(p);
    const old=(await client.query('SELECT * FROM development_observer_latest WHERE monitor_id=$1',[MONITOR])).rows[0];
    if(old) {
      const previousPacket=stored(old,r);
      const previous=Number(old.sequence);
      if(p.sequence<previous)return {action:'old-sequence-refused'};
      if(p.sequence===previous)return {action:digest===old.packet_sha256?'duplicate-no-refresh':'sequence-conflict'};
      if(p.cycle_id===old.cycle_id||p.cycle_finished_at<=previousPacket.cycle_finished_at)return {action:'cycle-replay-refused'};
    }
    if(p.cycle_finished_at<seconds(r.observe_since))return {action:'before-reviewed-baseline'};
    await client.query(`INSERT INTO development_observer_latest
      (monitor_id,sequence,cycle_id,cycle_finished_at,sent_at,received_at,packet_sha256,packet)
      VALUES ($1,$2,$3,$4,$5,clock_timestamp(),$6,$7::jsonb)
      ON CONFLICT (monitor_id) DO UPDATE SET sequence=EXCLUDED.sequence,cycle_id=EXCLUDED.cycle_id,
      cycle_finished_at=EXCLUDED.cycle_finished_at,sent_at=EXCLUDED.sent_at,
      received_at=EXCLUDED.received_at,packet_sha256=EXCLUDED.packet_sha256,packet=EXCLUDED.packet`,
      [MONITOR,p.sequence,p.cycle_id,date(p.cycle_finished_at),date(p.sent_at),digest,JSON.stringify(p)]);
    return {action:'heartbeat-recorded',sequence:p.sequence};
  });}catch{return {action:'heartbeat-refused',healthy:false};}
}


async function observe(db,send,{allowManualTest=false,timeoutMs=10000}={}) {
  let grant;
  try{grant=await db.transaction(async client=>{
    const r=await registry(client);
    if(!armed(r,allowManualTest))return {action:'observer-disabled'};
    const now=r.observer_now,latest=(await client.query('SELECT * FROM development_observer_latest WHERE monitor_id=$1',[MONITOR])).rows[0];
    const issues=new Set();
    if(!latest) {
      if(now-seconds(r.observe_since)<=180)return {action:'awaiting-first-heartbeat',healthy:false};
      issues.add('heartbeat-missing');
    }else {
      const verified=stored(latest,r);
      const received=seconds(latest.received_at),finished=seconds(latest.cycle_finished_at);
      if(!finite(received)||!finite(finished)||received>now+5)return {action:'observer-clock-untrusted',healthy:false};
      // Receipt of a replay or a future source timestamp cannot extend freshness.
      if(now-Math.min(received,finished)>180)issues.add('heartbeat-stale');
      for(const issue of verified.issues) {
        if(!Object.hasOwn(ISSUES,issue)||issue==='clock-invalid')throw Error('Invalid stored heartbeat');
        issues.add(issue);
      }
    }
    if(!issues.size)return {action:'no-alert',heartbeat_fresh:true,human_receipt_verified:false};
    const reasons=[...issues].sort(),id=hash({binding:r.binding_sha256,reasons,window:Math.floor(now/1800)});
    if((await client.query('SELECT 1 FROM development_observer_notices WHERE notice_id=$1',[id])).rows.length)return {action:'already-attempted',issues:reasons};
    const last=(await client.query('SELECT MAX(attempted_at) AS last FROM development_observer_notices WHERE monitor_id=$1',[MONITOR])).rows[0].last;
    if(last!==null) {
      if(seconds(last)>now)return {action:'observer-clock-untrusted',healthy:false};
      if(now-seconds(last)<1800)return {action:'cooldown',issues:reasons};
    }
    await client.query("INSERT INTO development_observer_notices (notice_id,monitor_id,status) VALUES ($1,$2,'intent')",[id,MONITOR]);
    return {action:'send-once',notice_id:id,issues:reasons,
      route_id:'n8n-pushover-owner',message:'Zewnętrzna kontrola monitora: '+reasons.map(x=>ISSUES[x]).join('; ')+'.',
      url:'https://n8n.smartsoft.biz.pl',automatic_retry:false};
  });}catch{return {action:'observer-state-unavailable',healthy:false};}
  if(grant.action!=='send-once')return grant;
  let delivery='unknown';
  try {
    const receipt=await boundedSend(send,grant,timeoutMs);
    if(receipt&&receipt.status===1&&typeof receipt.request==='string'&&/^[A-Za-z0-9-]{8,100}$/.test(receipt.request)) {
      await db.transaction(async client=>{
        const updated=await client.query("UPDATE development_observer_notices SET status='accepted',request_id=$1 WHERE notice_id=$2 AND status='intent'",[receipt.request,grant.notice_id]);
        if(updated.rowCount!==1)throw Error('Unknown acknowledgement intent');
      });delivery='provider-accepted';
    }
  }catch{/* Intent survives lost reply, deadline and acknowledgement failure. */}
  return {action:'attempted-once',delivery,human_receipt_verified:false,production_acceptance:false};
}
module.exports={MONITOR,ISSUES,packet,postgresPort,ingest,observe,boundedSend};
